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
│  │   │  2. Enforce https-only (http for loopback)   │       │
│  │   │  3. Block redirects (redirect: 'error')      │       │
│  │   │  4. Inject API keys by domain (Etherscan/    │       │
│  │   │     Tronscan)                                │       │
│  │   │  5. Inject X-Script-Token on loopback        │       │
│  │   │     (HMAC, case-scoped, 60s TTL)             │       │
│  │   │  6. Make real fetch()                        │       │
│  │   │  7. Redact API key values from body+errors   │       │
│  │   │  8. Return { ok, status, body } to isolate   │       │
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
| Fetch non-HTTPS | Only `https://` allowed (exception: `http://localhost` when loopback is enabled — default in dev, opt-in in prod via `SCRIPT_ALLOW_LOOPBACK`) |
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

**Echo defense — `redactSecrets`:** Etherscan V2 only accepts the API key as `?apikey=` in the URL (header auth 401s — verified empirically). The URL containing the key could leak back to scripts via:
- Response bodies that echo the request URL (some Etherscan errors do this)
- Fetch exception messages that include the URL (DNS errors, redirects, network failures)

The bridge runs every response body and every error message through a `redactSecrets()` pass that replaces literal `ETHERSCAN_API_KEY` and `TRONSCAN_API_KEY` values with `<REDACTED>` before returning to the isolate. Cheap and reliable — no legitimate use case needs the raw key in a script-visible string.

## Local API Access

Scripts can call the local Daubert backend to read and mutate investigation data — read traces, import transactions, edit nodes/edges/groups — without that data ever entering the LLM context.

**How auth works:** Before each script run, `ScriptExecutionService` signs an HMAC token scoped to the conversation's `caseId` (per-process random key, 60s TTL, base64url-encoded). The fetch bridge injects this as `X-Script-Token: <token>` on every request to `localhost`/`127.0.0.1`. The script code never sees the token.

The global `AuthGuard` accepts either `X-Script-Token` (script path) or `Authorization: Bearer ...` (Firebase user path). Script-path requests get an `AccessPrincipal` of `{ kind: 'script', caseId }` attached to the request. They do **not** get `req.user` — this is intentional, so guards that read `req.user` (`IsAdminGuard`, `CaseMemberGuard`) automatically reject scripts.

**Cross-case enforcement:** Every case-scoped service method calls `caseAccess.assertAccess(principal, resource.caseId)`. For a script principal, this checks `principal.caseId === resource.caseId` — a script can only touch resources within the case it was signed for.

**What scripts can reach:** the existing trace/investigation/production endpoints (`/traces/:id`, `/traces/:id/import-transactions`, `/traces/:id/edges/:edgeId`, etc.). Conversations, admin routes, and case-administration routes (`/cases/:caseId/...` guarded by `CaseMemberGuard`) reject scripts.

**Loopback gating:** `LOOPBACK_DOMAINS = ['localhost', '127.0.0.1']` is enabled by default in dev. In production, requires `SCRIPT_ALLOW_LOOPBACK=true`. When disabled, scripts cannot reach the local API at all.

## Domain Allowlist

Only these domains can be reached via `fetch()`:

**Etherscan (EVM chains):**
`api.etherscan.io`, `api-sepolia.etherscan.io`, `api-goerli.etherscan.io`, `api-holesky.etherscan.io`, `api.arbiscan.io`, `api.basescan.org`, `api-optimistic.etherscan.io`, `api.polygonscan.com`, `api.bscscan.com`, `api.snowtrace.io`, `api.ftmscan.com`

**Tron:**
`apilist.tronscanapi.com`, `api.trongrid.io`, `api.shasta.trongrid.io`

**Loopback (dev by default, opt-in for prod):**
`localhost`, `127.0.0.1` — enabled by default when `NODE_ENV !== 'production'`. In production, requires `SCRIPT_ALLOW_LOOPBACK=true`. When the flag is off, scripts cannot reach the local backend at all. See "Local API Access" above for what the loopback path exposes.

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

### API key exfiltration
**Attack:** Script tries to learn `ETHERSCAN_API_KEY` or `TRONSCAN_API_KEY` so it can use them outside Daubert's quota — e.g. by triggering an Etherscan error response that echoes the request URL (which contains `?apikey=...`), then reading `response.body`.

**Mitigations:**
1. The script's `process.env` does not contain the keys. They live only in the host process and the bridge.
2. The bridge runs every response body and every fetch error message through `redactSecrets()`, replacing literal key values with `<REDACTED>` before returning to the isolate.
3. Etherscan V2 only accepts the key as a query string, so the bridge cannot move it to a header (verified empirically). Keys still ride in the URL on the wire — the redaction is what closes the echo path.

**Accepted residual:** the key is in the URL of an outbound HTTPS request. An attacker who can read Etherscan's request logs (operator of Etherscan, not us) sees the key. Out of scope for this layer; mitigated by using free-tier keys with bounded quota and rotating on suspicion. Long-term: see `docs/plans/2026-04-27-blockchain-api-key-hardening.md`.

### Cross-case write via stolen script token
**Attack:** Script token leaks (memory dump, copy-paste in logs) and is replayed against another case's resources.

**Mitigations:**
1. Token is HMAC'd with a per-process random key (`crypto.randomBytes(32)`). Backend restart invalidates every token ever issued.
2. Token TTL is 60 seconds. Replay window is small.
3. Token encodes the `caseId` it was issued for. `assertAccess({ kind: 'script', caseId }, resource.caseId)` rejects when they differ.
4. Token is scoped to localhost only — the bridge injects it on `localhost`/`127.0.0.1` and nowhere else. Outbound to Etherscan/Tronscan does not include it.

### Admin endpoint reachability via script token
**Attack:** Script tries `fetch('${API_URL}/admin/cases')` to escalate to admin operations.

**Mitigations:**
1. `IsAdminGuard` reads `req.user`. Script tokens never set `req.user` — only `req.principal = { kind: 'script', ... }`. Admin routes 403.
2. `CaseMemberGuard` (used on `/cases/:caseId/...` routes) also reads `req.user` — script tokens are rejected there too.
3. Conversations endpoints have an explicit `requireUser(req)` check that throws on script principals.

The script-callable surface is bounded to: trace/investigation/production endpoints that use the principal-based service-layer `assertAccess(principal, caseId)`.

### SSRF (Server-Side Request Forgery)
**Attack:** Script fetches `http://169.254.169.254/latest/meta-data/` (cloud metadata) or internal services.

**Mitigations:**
1. `169.254.169.254` is not in the allowlist → blocked
2. Loopback is gated by `SCRIPT_ALLOW_LOOPBACK=true` in production. When off, scripts cannot reach localhost services at all.
3. All non-allowlisted domains return 403

**Loopback caveat:** When loopback is enabled, scripts can reach *any* service listening on localhost — not just the Daubert backend. On Cloud Run this is benign (one-process container, no other localhost services), but on a multi-tenant or multi-process host, an enabled loopback flag could let scripts probe sidecars, admin ports, or metadata proxies. Off by default in production for that reason.

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
| `SCRIPT_ALLOW_LOOPBACK` | env var | `true` enables `localhost`/`127.0.0.1` in production. Off in production by default. |
| `TOKEN_TTL_MS` | 60,000 | `script-token.service.ts` — HMAC token lifetime |
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
