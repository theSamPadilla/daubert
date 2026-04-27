# Blockchain API Key Hardening — Long-Term Options

**Status:** Future work. Not blocking. Two complementary directions documented for when the threat model changes (paid keys, multi-user, or observed abuse).

**Context:** Today the agent's script sandbox calls `api.etherscan.io` and `apilist.tronscanapi.com` directly. The fetch bridge injects shared, project-level API keys server-side; scripts never see the raw key string. As of 2026-04-27 we also redact key values from response bodies and fetch error messages (see `redactSecrets` in `script-execution.service.ts`).

The remaining accepted risk: a single shared key per provider, used by every script in every case. If it leaks (memory dump, future side channel, social engineering, accidental log capture), one rotation has to happen across the whole tool. And every case shares quota — one runaway script can starve every other case.

This document covers the two long-term mitigations in increasing order of effort.

---

## Atomized Changes

These are direction summaries, not implementation diffs. Each option below is a self-contained plan that would get its own atomized changes table when promoted to active work.

| # | Option | User-facing impact | Dev impact |
|---|---|---|---|
| 1 | Backend-side blockchain proxy | Scripts call `${API_URL}/blockchain/etherscan/...` instead of public Etherscan URLs. Same data, single chokepoint. | One new module + per-script-call latency tax (~10-30ms localhost roundtrip). |
| 2 | Per-case API key issuance + rotation | Each case has its own Etherscan/Tronscan key. Leaks blast-radius drops to one case. Keys rotate on schedule. | Keys move from env to DB (encrypted). New admin UI for issuance. Breaking change to bridge injection. |

---

## Option 1: Backend-side blockchain proxy

### Problem this solves

- Scripts can hit any path under `api.etherscan.io` today. We'd need to extend the allowlist if Etherscan adds endpoints; we can't observe per-script call patterns; rate-limiting must happen in the bridge, fragmented from other infra.
- The key still rides in URLs sent over the wire (Etherscan rejects header auth — verified 2026-04-27). Even with response-body redaction, an exception inside `node-fetch` could in principle log the URL.
- Every blockchain provider needs its own injection logic. Adding Polygon, Avalanche, etc. means updating the bridge. The bridge's job grows over time.

### Shape

A backend module that fronts every blockchain explorer:

```
GET ${API_URL}/blockchain/etherscan/v2/api?chainid=1&module=account&action=txlist&address=0x...
GET ${API_URL}/blockchain/tronscan/api/transaction?address=...
```

The proxy:
1. Validates the path against an explicit endpoint allowlist (not just domain — endpoint).
2. Adds the API key (still as `?apikey=` for Etherscan, header for Tronscan).
3. Calls the upstream provider.
4. Logs `[blockchain-proxy] script=<id> case=<id> provider=etherscan endpoint=txlist status=200 ms=120`.
5. Strips the key from the response body (defense in depth — `redactSecrets` already does this, but a second layer here means even if the bridge changes, the proxy still scrubs).
6. Optionally rate-limits per `(case, provider)` tuple.
7. Returns the upstream response verbatim minus the key.

The fetch bridge's allowlist becomes much narrower: only `localhost` (for the proxy) and direct API access removed. Scripts would lose the ability to hit Etherscan directly — they go through the proxy.

### Files (rough estimate)

| # | File | Action | Purpose |
|---|---|---|---|
| 1 | `backend/src/modules/blockchain-proxy/blockchain-proxy.module.ts` | Create | Module wiring |
| 2 | `backend/src/modules/blockchain-proxy/etherscan-proxy.controller.ts` | Create | Routes for Etherscan-family chains |
| 3 | `backend/src/modules/blockchain-proxy/tronscan-proxy.controller.ts` | Create | Routes for Tronscan/TronGrid |
| 4 | `backend/src/modules/blockchain-proxy/proxy.service.ts` | Create | Shared key injection, allowlist, redaction, logging |
| 5 | `backend/src/modules/blockchain-proxy/endpoint-allowlist.ts` | Create | Per-provider allowed endpoint patterns |
| 6 | `backend/src/modules/ai/services/script-execution.service.ts` | Modify | Drop external blockchain hosts from allowlist; only localhost remains |
| 7 | `backend/src/skills/etherscan-apis.md` | Modify | Update examples to use proxy paths |
| 8 | `backend/src/skills/tronscan-apis.md` | Modify | Same |
| 9 | `backend/src/skills/graph-mutations.md` | Modify | Update fetch examples to use proxy paths |
| 10 | `backend/src/app.module.ts` | Modify | Register `BlockchainProxyModule` |
| 11 | `backend/src/modules/blockchain-proxy/proxy.service.spec.ts` | Create | Unit tests for path validation, key injection, redaction |
| 12 | `backend/src/modules/blockchain-proxy/etherscan-proxy.controller.spec.ts` | Create | Integration test for whole flow |

### Auth model

The proxy controller uses the same dual-auth `AuthGuard` as everything else (Firebase Bearer or `X-Script-Token`). For script-token requests, the proxy logs the case ID for audit. The proxy does not enforce its own case-scoped rate limits unless we add them — the existing TTL/quota story is unchanged.

### Trade-offs

**Pros**
- One chokepoint for blockchain API observability.
- Endpoint-level allowlist (tighter than domain-level).
- Easy to add per-case rate limiting later.
- Easy to swap providers (e.g. self-host an indexer) — change the proxy, scripts unaffected.
- Skills and example code become Daubert-internal URLs, simpler to teach the agent.

**Cons**
- ~10-30ms localhost roundtrip per call. Most scripts make 1-50 calls, so 0.1-1.5s added latency. Probably fine.
- More code to maintain. The proxy will drift from upstream API changes if not actively kept in sync.
- Skills have to be rewritten.
- If the proxy is buggy, no fallback — scripts can't bypass it (and shouldn't).

### When to do it

- After paid Etherscan/Tronscan tier (loss-of-quota becomes a billing event, not just rate-limit).
- After adding a second user (per-case observability matters).
- If we observe sustained anomalies in script API patterns that the current `script_runs` log doesn't surface.

---

## Option 2: Per-case API key issuance + rotation

### Problem this solves

- One leaked key compromises every case's quota. Per-case keys bound the blast radius to a single case.
- Rotating the shared key is a tool-wide event (must update env, restart Cloud Run, all running scripts get the new key on next run). Per-case rotation is a single-case event.
- Auditability: today, Etherscan's logs show all our calls under one key. Per-case keys mean Etherscan-side abuse investigation can pinpoint the case.

### Shape

Etherscan accounts support up to 3 API keys each. To get more, we'd need separate Etherscan accounts (one per case is feasible at small scale; not at hundreds of cases without automation).

Tronscan/TronGrid have similar limits but lower documentation quality.

The architecture:

1. **Key storage moves to DB.** A new `case_api_keys` table with columns `(caseId, provider, ciphertext, iv, authTag, createdAt, rotatedAt)`. Encrypted at rest with a master key in env.
2. **Issuance UI/flow.** New admin endpoint `POST /admin/cases/:caseId/api-keys` that lets the operator paste in a per-case key. Or, if Etherscan adds programmatic key issuance someday, automate it.
3. **Bridge injection becomes case-scoped.** `script-execution.service.ts:injectApiKey` is no longer a static config lookup — it queries the DB for `(caseId, provider)` and falls back to the shared key if none is set.
4. **Rotation policy.** Cloud Scheduler (or a cron) flags keys older than N days. Operator rotates manually until automated issuance exists.
5. **Skills/prompts unchanged.** Scripts call the same URLs; the bridge just picks the right key.

### Files (rough estimate)

| # | File | Action | Purpose |
|---|---|---|---|
| 1 | `backend/src/database/entities/case-api-key.entity.ts` | Create | Table for encrypted per-case keys |
| 2 | `backend/src/database/migrations/00XX_case_api_keys.ts` | Create | DB migration |
| 3 | `backend/src/modules/case-api-keys/case-api-keys.module.ts` | Create | Module wiring |
| 4 | `backend/src/modules/case-api-keys/case-api-keys.service.ts` | Create | Encrypt, store, retrieve, decrypt |
| 5 | `backend/src/modules/admin/cases/admin-cases.controller.ts` | Modify | Add endpoints to set/rotate per-case keys |
| 6 | `backend/src/modules/ai/services/script-execution.service.ts` | Modify | `injectApiKey` becomes case-aware; takes `caseId` arg |
| 7 | `backend/src/modules/ai/ai.service.ts` | Modify | Pass `caseId` through to `injectApiKey` (already passed for token signing after the dual-auth plan) |
| 8 | `backend/src/config/env.validation.ts` | Modify | New `CASE_API_KEY_MASTER` env var (encryption master key) |
| 9 | `frontend/src/app/admin/cases/[id]/api-keys/page.tsx` | Create | Admin UI for issuance/rotation |
| 10 | Tests | Create | Encryption round-trip, fallback to shared key, controller auth |

### Auth model

The bridge already knows the `caseId` after the dual-auth plan ships (it's the script token's scope). It looks up `case_api_keys` for `(caseId, provider)`; if found, decrypts and uses; if not, falls back to `ETHERSCAN_API_KEY`/`TRONSCAN_API_KEY` from env. Backward-compatible — existing cases keep working until per-case keys are issued.

### Trade-offs

**Pros**
- Compromise of one case's key affects only that case.
- Per-case quota: a runaway script can't burn another case's allotment.
- Per-case audit trail at the provider's side (Etherscan can answer "show me all calls from key X" for one case).
- Rotation is per-case, not global.

**Cons**
- Provider-level limits. Etherscan = 3 keys per account; we'd need multiple accounts for >3 cases. Manual until programmatic issuance exists.
- DB schema work + encryption layer + admin UI. Real cost.
- Onboarding overhead: every new case needs key issuance before its first script run. Ergonomics matter.
- Master encryption key in env is the new single point of failure. If it leaks, all per-case keys are compromised. Mitigate with KMS.

### When to do it

- After moving to a multi-tenant model (more than one user with separate cases).
- If a single case's needs grow past the shared free-tier quota and we have to upgrade to paid keys.
- If Etherscan ever ships programmatic key issuance (would dramatically reduce ergonomics cost).

---

## Decision matrix

| If... | Then... |
|---|---|
| Single user, free-tier keys, current scale | Do nothing. `redactSecrets` is sufficient. |
| Single user, paid keys, one big case | Option 1 (proxy) — observability and per-call rate limiting matter, blast radius doesn't. |
| Multi-tenant, mixed scale | Option 2 (per-case keys) — blast radius matters. Probably also Option 1 alongside. |
| Observed abuse / anomalies | Option 1 first (faster to ship, gives visibility), then Option 2 if abuse is per-case. |

The two options are independent and complementary. Option 1 narrows the egress surface; Option 2 narrows the auth surface. They can ship in either order.

---

## Today's mitigations (already in place)

For reference, the bridge currently:

- Validates URL hostnames against an allowlist (`script-execution.service.ts:isAllowedUrl`).
- Forces `redirect: 'error'` to prevent allowed-domain → evil-domain hops.
- Injects API keys server-side; scripts never see raw key in their JavaScript context.
- **Redacts API keys from response bodies and fetch error messages** (added 2026-04-27).
- Caps script CPU/wall time at 30s.
- Caps output at 100KB.
- Enforces 128MB memory limit per isolate.
- Logs every script run to `script_runs` for post-hoc review.

What it does **not** do:
- Endpoint-level allowlist (only domain-level).
- Per-case rate limiting.
- Anomaly alerting on call patterns.
- Per-call structured logging beyond what the bridge already does.

The "future work" gaps above are what Option 1 and Option 2 would close.
