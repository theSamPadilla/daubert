# Case Role Enforcement — Owner vs Guest Across the App

**Status:** Future work. Not blocking single-user mode, but blocks any real multi-user collaboration where a guest should be read-only.

**Context:** The `case_members` table carries a `role: 'owner' | 'guest'` column, but only the data-room module enforces it. Every other mutating route treats *any* membership as full write access. That means the role primitive is **misnamed today**: in practice it's a "data-room writer" flag, not a tenant-level permission.

This plan inventories the gap, calls out the architectural decision (rename vs. tighten), and sketches the deep fix.

---

## Atomized Changes

Direction summary, not implementation diff. Each option below is a self-contained sub-plan that would get its own atomized table when promoted to active work.

| # | Option | User-facing impact | Dev impact |
|---|---|---|---|
| 1 | Tighten role gates across all mutating routes (recommended) | Guests become read-only across the case (cases, investigations, traces, productions, AI chat that mutates). Owners unchanged. | Service-layer `requireOwner` calls on every mutating method, mirroring the data-room pattern. ~12 files, no schema change. |
| 2 | Add finer-grained roles (`viewer / contributor / admin`) | Per-user differentiation between "can edit graph but not delete case" vs "can administer members." | Migration adds new role values. Every gate site picks the right minimum role. Bigger blast radius; only worth it if the user has a 3-tier use case in mind. |
| 3 | Status quo + rename `role` → `data_room_role` | Nothing changes for users. Removes the false promise of a tenant-level role. | Migration to rename column + entity. Honest naming, zero new safety. Only useful as a holding pattern. |

**Recommendation:** Option 1. The two-role primitive is fine; the bug is that we only wired one of two intended check sites. Option 2 is over-engineering for a personal investigation tool. Option 3 is honest but doesn't fix the actual safety gap.

---

## Inventory: where role checks are missing

Every route below currently accepts **any** case member. A guest can do all of these today.

### `:caseId`-scoped routes (use `CaseMemberGuard`, role available on `req.caseMembership`)

| Module | Route | Method | Today | Should be |
|---|---|---|---|---|
| cases | `/cases/:caseId` | PATCH | any member | owner |
| cases | `/cases/:caseId` | DELETE | any member | owner |
| investigations | `/cases/:caseId/investigations` | POST | any member | owner |
| productions | `/cases/:caseId/productions` | POST | any member | owner |
| data-room | `/cases/:caseId/data-room/*` | (writes) | owner ✓ | unchanged |

These are easy: the controller already has `req.caseMembership.role`. Add `DataRoomService.requireOwner(req.caseMembership?.role)` (or, better, lift `requireOwner` out of `DataRoomService` into a shared helper — it's not data-room-specific).

### `:investigationId` / `:traceId` / `:productionId`-scoped routes (no `CaseMemberGuard`, use service-layer `assertAccess`)

| Module | Route | Method | Today | Should be |
|---|---|---|---|---|
| investigations | `/investigations/:id` | PATCH/DELETE | any member | owner |
| traces | `/investigations/:id/traces` | POST | any member | owner |
| traces | `/traces/:id` | PATCH/DELETE | any member | owner |
| traces | `/traces/:traceId/{nodes,edges,groups,bundles}/...` | PATCH/DELETE | any member | owner |
| traces | `/traces/:id/import-transactions` | POST | any member | owner |
| productions | `/productions/:id` | PATCH/DELETE | any member | owner |

These are harder. The controllers don't carry the `caseId` in the URL — the service resolves it from the resource and calls `CaseAccessService.assertAccess(principal, caseId)`. To gate by role, `assertAccess` needs to return the membership (it already does for users) AND callers need to pick "any member" vs "owner-only" per call site.

**Proposed shape:**

```ts
// CaseAccessService — already returns CaseMemberEntity | null
const membership = await this.caseAccess.assertAccess(principal, caseId);
this.caseAccess.requireOwner(membership);  // new helper, no-op for scripts
```

`requireOwner` short-circuits for `principal.kind === 'script'` because script tokens are owner-issued (see "Open questions" below) and for `null` (already covered by `assertAccess`).

### AI chat — biggest gap

`/conversations/:id/chat` lets the agent mutate everything on the case (via `update_production`, `import_transactions`, eventually drive writes, plus `run_script` which mints a full-access script token at `script-execution.service.ts:98`). Today any member of the case can drive the agent.

A guest with chat access can therefore mutate everything indirectly even if we lock down the HTTP routes. **Conclusion: gating chat itself is mandatory**, not a follow-up. Either:

- **(a)** Block guests from the chat endpoint entirely (simplest; matches "guests are read-only").
- **(b)** Allow guests to chat but pass a `read_only_agent` flag into `streamChat` that filters `AGENT_TOOLS` to non-mutating tools and refuses `run_script`.

Recommend (a) for v1. (b) is a separate plan; needs a second tool registry and prompt variant.

---

## Open questions

1. **Script principal authority.** Script tokens today carry only `caseId`, not `userId` or `role`. They're minted inside `script-execution.service.ts` during agent runs. If chat is owner-only (option (a) above), then by transitivity script tokens are owner-equivalent and `requireOwner` should no-op for them. If we ever issue script tokens outside the agent path (e.g. user-driven scripting), this assumption breaks and we need to embed the issuer's role in the token. Document explicitly in `script-token.service.ts` once the chat gate lands.

2. **Naming of `requireOwner`.** It currently lives on `DataRoomService` as a static. Move it to `CaseAccessService` (or a new `case-access` shared module) so the same helper enforces role across all sites. `DataRoomService.requireOwner` becomes a re-export for backward compat or just a call-site change.

3. **Read-only is genuinely read-only?** Need to confirm: can a guest *read* a trace's nodes/edges? Today yes, via `GET /traces/:id`. That's the intended semantic — guests can see the case. Worth asserting explicitly so we don't accidentally lock reads later.

4. **Member admin.** Adding/removing members and changing roles is gated by `admin.guard.ts` (tenant admin), not by case-owner. That's correct for now (single-tenant admin = the user). If we ever want case-owners to invite guests without going through the admin UI, that's a separate plan.

---

## Files (rough estimate, Option 1)

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/auth/case-access.service.ts` | Modify | Add `requireOwner(membership)` helper that no-ops for script principals and throws `ForbiddenException('write_requires_owner')` for guests. |
| 2 | `backend/src/modules/auth/case-access.service.spec.ts` | Create | Cover owner / guest / script / null. |
| 3 | `backend/src/modules/cases/cases.controller.ts` | Modify | Add `requireOwner(req.caseMembership)` on PATCH and DELETE. |
| 4 | `backend/src/modules/investigations/investigations.controller.ts` | Modify | Add gate on POST `/cases/:caseId/investigations`; pass through to service for `:id` routes. |
| 5 | `backend/src/modules/investigations/investigations.service.ts` | Modify | Capture membership from `assertAccess`, call `requireOwner` on update/remove. |
| 6 | `backend/src/modules/traces/traces.service.ts` | Modify | Same pattern for create/update/remove + node/edge/group/bundle mutations + import. |
| 7 | `backend/src/modules/productions/productions.controller.ts` | Modify | Gate POST `/cases/:caseId/productions`. |
| 8 | `backend/src/modules/productions/productions.service.ts` | Modify | Gate update/remove. |
| 9 | `backend/src/modules/data-room/data-room.service.ts` | Modify | Replace `static requireOwner` with delegation to `CaseAccessService` (or remove and update controller imports). |
| 10 | `backend/src/modules/ai/conversations.controller.ts` | Modify | Add owner check on `/conversations/:id/chat`. Resolve case from the conversation, look up membership, throw on guest. |
| 11 | `backend/src/modules/ai/conversations.service.ts` | Modify | Optionally surface the case role on `findOne` so the controller doesn't need a second query. |
| 12 | `backend/src/modules/ai/services/script-execution.service.ts` | Modify | Comment block clarifying the owner-equivalent invariant for script tokens. |
| 13 | `backend/src/modules/{cases,investigations,traces,productions}/*.spec.ts` | Modify | Add guest-rejection tests for each gated route. |
| 14 | `frontend/src/app/cases/[caseId]/...` | Modify (later) | Hide write affordances for guests. Backend is the source of truth; frontend is just polish. |

No DB migration. No schema change. No contract change (errors are existing `403 ForbiddenException`).

---

## Trade-offs

**Pros**
- Closes the actual safety gap: a guest cannot delete the case, drop investigations, mutate the graph, or drive the agent into mutating the data room.
- Centralises role enforcement on `CaseAccessService` — one place to audit, one place to test.
- No data migration. Pure code change, low rollback cost.

**Cons / risks**
- The `:id`-shaped service-layer plumbing means the gate sits in services, not controllers. That's harder to spot at a glance than a `@UseGuards` decorator. Mitigate with consistent comment: "// owner-only mutation".
- AI chat being owner-only is a real product decision. If the user later wants guests to chat-as-read-only, that's plan (b) above and is non-trivial — second tool registry, second prompt, second test surface.
- Script-token-as-owner is an implicit assumption; needs a comment so a future change doesn't quietly break it.

---

## Why this matters

The visible bug is "guest can do too much." The architectural bug underneath it is that **the role column is wired in only one place**, so reading the schema gives a misleading picture of what the system actually enforces. Either we make the name match reality (Option 3 — honest but not safer) or we make the behavior match the name (Option 1 — recommended). Patching individual endpoints case-by-case as bugs are reported would leave the system in the worst of both worlds: a `role` field that *sometimes* matters, where the rule depends on which controller you happen to be in.
