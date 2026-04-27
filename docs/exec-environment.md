# Script Execution Environment

Agent-generated JavaScript runs in an **isolated-vm V8 sandbox** — a separate V8 isolate with zero access to Node.js APIs. This document describes what the sandbox allows, what it blocks, and the security strategy.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  NestJS Backend (Host Process)                              │
│                                                             │
│  ScriptExecutionService                                     │
│  ├── acquireSlot()          ← concurrency semaphore (max 2) │
│  ├── new ivm.Isolate()      ← 128MB memory limit            │
│  ├── context.eval(code)     ← 30s CPU + 30s wall-clock      │
│  │                                                          │
│  │   ┌──────────────────────────────────────────────┐       │
│  │   │  V8 Isolate (sandbox)                        │       │
│  │   │                                              │       │
│  │   │  Available:                                  │       │
│  │   │    fetch()       → bridged to host            │       │
│  │   │    console.log() → captured to output buffer  │       │
│  │   │    process.env   → { API_URL } (frozen)       │       │
│  │   │    JSON, Math, Array, Promise, etc.           │       │
│  │   │                                              │       │
│  │   │  NOT available:                              │       │
│  │   │    fs, child_process, net, os, http           │       │
│  │   │    require(), import()                        │       │
│  │   │    Buffer, process (beyond env)               │       │
│  │   │    Any Node.js API                            │       │
│  │   └──────────────────────────────────────────────┘       │
│  │                          │                               │
│  │                    fetch bridge                           │
│  │                          │                               │
│  │   ┌──────────────────────▼───────────────────────┐       │
│  │   │  Host-side fetch handler                     │       │
│  │   │  1. Validate URL against domain allowlist    │       │
│  │   │  2. Enforce https-only (http for localhost)  │       │
│  │   │  3. Inject API keys by domain                │       │
│  │   │  4. Block redirects (redirect: 'error')      │       │
│  │   │  5. Make real fetch()                        │       │
│  │   │  6. Return { ok, status, body } to isolate   │       │
│  │   └──────────────────────────────────────────────┘       │
│  │                                                          │
│  ├── isolate.dispose()      ← immediate cleanup             │
│  └── releaseSlot()          ← free semaphore                │
└─────────────────────────────────────────────────────────────┘
```

## What the sandbox sees

| Global | Type | Notes |
|--------|------|-------|
| `fetch(url, opts)` | Async function | Bridged to host. Domain-whitelisted. API keys injected automatically. |
| `console.log/error/warn/info` | Functions | Captured to output buffer (100KB max). |
| `process.env` | Frozen object | Contains only `API_URL`. No API keys, no system vars. |
| `JSON`, `Math`, `Array`, `Object`, `Promise`, `Map`, `Set`, etc. | Standard JS | V8 built-ins only. |

## What the sandbox CANNOT do

| Capability | Why it's blocked |
|-----------|-----------------|
| Read/write files | `fs` module doesn't exist in the isolate |
| Spawn processes | `child_process` doesn't exist |
| Open network connections | `net`, `http`, `https` don't exist; only the bridged `fetch()` |
| Access system info | `os` module doesn't exist |
| Import Node modules | `require()` and `import()` don't exist |
| See API keys | Keys are injected by the host-side fetch bridge, never exposed to the isolate |
| See other env vars | `DATABASE_URL`, `ANTHROPIC_API_KEY`, Firebase creds, OAuth secrets — none exist |
| Follow redirects | `redirect: 'error'` forced on all requests |
| Fetch non-HTTPS | Only `https://` allowed (exception: `http://localhost` in dev) |
| Fetch arbitrary domains | Domain allowlist enforced at the bridge |
| Run longer than 30s | Both CPU timeout (via `eval()`) and wall-clock timeout (via `Promise.race`) |
| Use more than 128MB | V8 isolate memory limit |
| Run more than 2 at once | Semaphore caps concurrent isolates |
| Mutate `process.env` | Object is `Object.freeze()`d; `'use strict'` makes mutation throw |

## API Key Protection

API keys are **never** exposed to agent code. The host-side fetch bridge injects them transparently based on the request domain:

| Domain pattern | Key injected | Method |
|---------------|-------------|--------|
| `*.etherscan.io`, `*.etherscan.com`, `*.arbiscan.io`, `*.basescan.org`, `*.polygonscan.com`, `*.bscscan.com`, `*.snowtrace.io`, `*.ftmscan.com` | `ETHERSCAN_API_KEY` | `?apikey=` query param |
| `*.tronscanapi.com`, `*.trongrid.io` | `TRONSCAN_API_KEY` | `TRON-PRO-API-KEY` header |

Scripts call URLs without keys:
```js
// The script writes this:
const res = await fetch('https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address=0x...');

// The bridge actually sends:
// https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address=0x...&apikey=REAL_KEY
```

A prompt injection attack that tricks the agent into writing `console.log(JSON.stringify(process.env))` would output:
```json
{"API_URL":"https://api.daubert.app"}
```

No keys. `API_URL` is the public backend URL, not sensitive.

## Domain Allowlist

Only these domains can be reached via `fetch()`:

**Etherscan (EVM chains):**
`api.etherscan.io`, `api-sepolia.etherscan.io`, `api-goerli.etherscan.io`, `api-holesky.etherscan.io`, `api.arbiscan.io`, `api.basescan.org`, `api-optimistic.etherscan.io`, `api.polygonscan.com`, `api.bscscan.com`, `api.snowtrace.io`, `api.ftmscan.com`

**Tron:**
`apilist.tronscanapi.com`, `api.trongrid.io`, `api.shasta.trongrid.io`

**Loopback (dev only):**
`localhost`, `127.0.0.1` — removed in production (`NODE_ENV=production`)

**Extensible:** Set `SCRIPT_ALLOWED_DOMAINS` env var (comma-separated) to add domains without code changes.

## Threat Model & Mitigations

### Prompt injection → malicious script
**Attack:** User uploads a PDF containing hidden instructions that trick the agent into writing a data-exfiltration script.

**Mitigations:**
1. No `fs`/`child_process`/`net` — can't access the host
2. No API keys in env — nothing sensitive to exfiltrate
3. Domain allowlist — can't send data to attacker-controlled servers
4. `redirect: 'error'` — can't bypass allowlist via 302 redirect
5. `https`-only — can't downgrade to plaintext

### API key exfiltration via query string
**Attack:** Script sends API keys in a URL query string to an allowed domain that logs requests.

**Mitigation:** Keys are no longer in the sandbox. The bridge injects them — the script never sees the raw value. A script cannot construct a URL containing the key because it doesn't have it.

### SSRF (Server-Side Request Forgery)
**Attack:** Script fetches `http://169.254.169.254/latest/meta-data/` (cloud metadata) or internal services.

**Mitigations:**
1. `169.254.169.254` is not in the allowlist → blocked
2. `localhost`/`127.0.0.1` removed in production
3. All non-allowlisted domains return 403

**Accepted risk — DNS rebinding:** An allowed domain could theoretically rebind its DNS to an internal IP at fetch time. Full mitigation requires resolving hostname → IP and checking against a CIDR blocklist. Out of scope for v1; revisit before multi-tenant.

### Resource exhaustion
**Attack:** Script runs an infinite loop or allocates unbounded memory.

**Mitigations:**
1. 30s CPU timeout (V8 eval)
2. 30s wall-clock timeout (Promise.race — covers async stalls)
3. 128MB memory limit per isolate
4. Max 2 concurrent isolates (semaphore)
5. 100KB output cap

### Scheme attacks
**Attack:** `file:///etc/passwd` or `http://` downgrade.

**Mitigations:**
1. Only `https:` allowed (enforced at bridge)
2. `http:` only for loopback in dev, removed in production
3. `file:`, `data:`, `ftp:`, etc. → 403

## Configuration

| Setting | Value | Location |
|---------|-------|----------|
| `TIMEOUT_MS` | 30,000 | `script-execution.service.ts` |
| `MAX_OUTPUT_BYTES` | 100KB | `script-execution.service.ts` |
| `MEMORY_LIMIT_MB` | 128 | `script-execution.service.ts` |
| `MAX_CONCURRENT_ISOLATES` | 2 | `script-execution.service.ts` |
| `BASE_ALLOWED_DOMAINS` | 14 domains | `script-execution.service.ts` |
| `SCRIPT_ALLOWED_DOMAINS` | env var | Comma-separated, extends allowlist |
| `NODE_OPTIONS` | `--no-node-snapshot` | Required for isolated-vm on Node 20+ |

## Persistence

Every script execution is saved to `script_runs`:
- `name` — descriptive label
- `code` — the JavaScript source
- `output` — captured stdout/stderr (truncated)
- `status` — `success`, `error`, or `timeout`
- `durationMs` — wall-clock execution time
- `investigationId` — links to the parent investigation

Surfaced in the frontend sidebar Scripts panel and in the details panel with code + output tabs.
