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
 * CIDR blocklist before connecting. Out of scope for v1; revisit before
 * multi-tenant use.
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

  // ---- API key injection ----

  /**
   * Inject API keys into outbound requests based on the target domain.
   * Scripts never see the raw keys — the bridge adds them transparently.
   */
  private injectApiKey(url: string, opts: Record<string, any>): string {
    const parsed = new URL(url);
    const host = parsed.hostname;

    // Etherscan V2 — all EVM chains use ?apikey= query param
    if (host.endsWith('.etherscan.io') || host.endsWith('.etherscan.com')
      || host.endsWith('.arbiscan.io') || host.endsWith('.basescan.org')
      || host.endsWith('.polygonscan.com') || host.endsWith('.bscscan.com')
      || host.endsWith('.snowtrace.io') || host.endsWith('.ftmscan.com')) {
      const key = this.configService.get<string>('ETHERSCAN_API_KEY');
      if (key && !parsed.searchParams.has('apikey')) {
        parsed.searchParams.set('apikey', key);
        return parsed.toString();
      }
    }

    // Tronscan + TronGrid — use TRON-PRO-API-KEY header
    if (host.endsWith('.tronscanapi.com') || host.endsWith('.trongrid.io')) {
      const key = this.configService.get<string>('TRONSCAN_API_KEY');
      if (key) {
        opts.headers = {
          ...(opts.headers || {}),
          'TRON-PRO-API-KEY': key,
        };
      }
    }

    return url;
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
    let wallClockTimer: ReturnType<typeof setTimeout>;
    const wallClockTimeout = new Promise<ScriptResult>((resolve) => {
      wallClockTimer = setTimeout(() => {
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

      // --- Inject process.env (read-only, no secrets) ---
      // API keys are NOT exposed — they're injected by the fetch bridge
      // based on the request domain. Scripts never see the raw keys.
      const envObj: Record<string, string> = {
        API_URL: this.configService.get<string>('API_URL') || 'http://localhost:8081',
      };

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

            // Inject API keys at the bridge level — scripts never see them.
            // Keys are appended to the URL or headers based on the domain.
            url = this.injectApiKey(url, opts);

            const res = await fetch(url, opts);
            const body = await res.text();
            return new ivm.ExternalCopy({
              ok: res.ok,
              status: res.status,
              body,
            }).copyInto();
          } catch (err: any) {
            const msg = err?.message ?? String(err);
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

      // Capture _fetchBridge in a local variable before deleting from
      // global — the fetch closure references it by name, so deleting
      // the global before invocation would cause "not defined" errors.
      await context.eval(`
        globalThis.fetch = (() => {
          const bridge = _fetchBridge;
          return async (url, opts = {}) => {
            const r = await bridge.apply(
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
        })();
        delete globalThis._fetchBridge;
      `);

      // --- Clean up injection helpers ---
      await context.eval(`delete globalThis._log;`);

      // --- Run agent code ---
      // 'use strict' is critical: without it, Object.freeze silently
      // no-ops on mutation attempts (sloppy mode). With it, assigning
      // to a frozen property throws TypeError.
      //
      // No try/catch in the harness — errors must propagate so the
      // outer .catch() can set status:'error'. The .catch() handler
      // preserves any partial console output alongside the error message.
      const harness = `
'use strict';
(async () => {
${code}
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

    try {
      return await Promise.race([execution, wallClockTimeout]);
    } finally {
      clearTimeout(wallClockTimer!);
    }
  }
}
