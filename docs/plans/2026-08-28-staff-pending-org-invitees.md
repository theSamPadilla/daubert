# Staff Pending Org Invitees onto Cases

**Goal:** Let a case owner add someone who has been invited to the org but hasn't signed up yet. The seat is granted now against their existing shell user row, and it lights up the moment they complete signup. Along the way, close the cross-org hole in `POST /cases/:caseId/members` that this change would otherwise make more load-bearing.

## Summary

- **What & why:** Today the case settings picker is fed by `GET /orgs/:org/members`, which returns accepted org memberships only. A pending org invitee (`joe@courtyard.io` in the reported case) is invisible to it, so you cannot staff a case until they accept. Nothing in the data model requires this: `OrgInvitesService.create` already provisions a real `users` row for the invited email (a "shell" user with `firebaseUid: null`), `case_members` points at `user_id`, and `AuthGuard` links the Firebase UID to that shell row by email on first sign-in. `addMemberByEmail` already resolves shell users and would work today. The gap is entirely in what the picker can see.
- **Key product decisions:**
  - The roster the case picker reads becomes **accepted org members + pending org invites**. Pending people are selectable and badged `org invite pending` in the picker, and their case member row is badged the same way until they sign up.
  - The two invite systems stay separate. "External invites" remains the path for people outside the org; its copy is corrected to say "outside your organization" rather than "with no account", which is what actually distinguishes it now.
  - A pre-granted case seat **survives** org invite expiry or revocation. The seat is a real grant against a real user row, and revoking an org invite revokes org access, not case staffing. Revoke-and-reissue is a normal flow and silently dropping staffing would be the worse surprise. The seat is inert until someone proves control of that email, which is the same trust model every invite already relies on.
- **Load-bearing engineering decisions:**
  - New endpoint `GET /orgs/{org}/roster` rather than widening `GET /orgs/{org}/members`. The members endpoint backs the org settings members table, which must not grow pending rows inline (they have their own section there). Roster answers a different question: "who can I staff onto a case".
  - The roster payload **never includes the invite `code`**. `GET /orgs/{org}/invites` is admin-only precisely because codes are secrets; roster is `@RequireOrgRole('member')` because a non-admin case owner needs it. Leaking codes through it would be a privilege escalation.
  - `addMemberByEmail` gains an org scope check. The target email must belong to a member of the case's org **or** hold a live pending org invite to it. Anything else throws `NotFoundException`, not `ForbiddenException` — `NewCaseModal` catches 404 and falls back to creating an external case invite, which is exactly the right outcome for an outsider's email.
  - The candidate/implicit-admin partition, currently duplicated between the case settings page and `NewCaseModal` with divergent shapes (one keys by `userId`, the other by email), moves into one tested pure helper `frontend/src/lib/roster.ts`. Pending invitees have no reliable `userId` guarantee, so the helper keys on a `key` field (`userId` when known, else `email:<addr>`).
- **No DB migration.** No schema change: shell users, `case_members.user_id`, and the `linked` flag all exist already.
- **Opus-tagged tasks:** Task 3 (cross-org scope check on `addMemberByEmail`) — it is a security boundary and its error *type* is load-bearing for an existing fallback path.

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task. **Never commit** — leave all changes in the working tree; run `git status` at the end of each task. Do not add Co-Authored-By trailers to anything.
>
> **Context:** `npm run gen` regenerates `api-types.ts` in both packages from `contracts/` and must be run after any contract change; never hand-edit generated files. Tests: `npm run test --prefix backend` / `npm run test --prefix frontend`. 13 backend e2e failures (`byoa-isolation`, `script-role-enforcement`) are pre-existing environment limits — expected.
>
> **Copy rules (project-wide):** no emojis (use `react-icons/fa6`), and **no em dashes in user-facing copy**. Several strings this plan touches currently contain em dashes; rewrite them without.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `contracts/schemas/organizations.yaml` | Modify | `OrganizationRoster` + `OrgRosterPendingInvite` schemas |
| 2 | `contracts/paths/organizations.yaml` | Modify | `GET /orgs/{org}/roster` |
| 3 | `contracts/openapi.yaml` | Modify | Wire the new path and schemas |
| 4 | `backend/src/modules/organizations/organizations.service.ts` | Modify | `getRoster()` returns members + live pending invites, deduped, no codes |
| 5 | `backend/src/modules/organizations/organizations.controller.ts` | Modify | `GET roster`, `@RequireOrgRole('member')` |
| 6 | `backend/src/modules/organizations/organizations.service.spec.ts` | Modify | Roster specs (pending included, used/expired excluded, dedupe, no code leak) |
| 7 | `backend/src/modules/cases/cases.service.ts` | Modify | Case owners can add pending org invitees; can no longer add users from other orgs |
| 8 | `backend/src/modules/cases/cases.module.ts` | Modify | Register `OrganizationInviteEntity` for the scope check |
| 9 | `backend/src/modules/cases/cases.service.spec.ts` | Modify | Specs for the four `addMemberByEmail` outcomes |
| 10 | `frontend/src/lib/api-client.ts` | Modify | `getOrgRoster(slug)` + response types |
| 11 | `frontend/src/lib/roster.ts` | Create | One tested partition of the roster into selectable candidates vs implicit admins |
| 12 | `frontend/src/lib/roster.test.ts` | Create | Unit tests for that partition |
| 13 | `frontend/src/app/cases/[caseId]/settings/page.tsx` | Modify | Pending invitees appear in the picker; pending members badged; copy corrected |
| 14 | `frontend/src/components/Cases/NewCaseModal.tsx` | Modify | Same picker behaviour when staffing a brand new case |

## Execution rules

- TDD per task: failing test first, implement, green.
- After the contract change: `npm run gen`, then confirm both generated `api-types.ts` files updated.
- Behaviour not named in a task must stay byte-identical. `git diff` discipline per task.
- No commits. `git status` at the end of every task.

---

## Task 1: Contracts — roster endpoint and schemas

**Implementer:** sonnet
**Files:** `contracts/schemas/organizations.yaml`, `contracts/paths/organizations.yaml`, `contracts/openapi.yaml`

Add to `contracts/schemas/organizations.yaml`:

```yaml
OrgRosterPendingInvite:
  type: object
  description: >
    Someone invited to the organization who has not accepted yet. A shell user
    row already exists for the email, so they can be staffed onto a case now;
    the grant activates when they complete signup. The invite code is
    deliberately NOT included here - this schema is readable by any org member,
    while codes are admin-only.
  required: [id, email, role, createdAt, expiresAt]
  properties:
    id:
      type: string
      format: uuid
      description: Organization invite id
    email:
      type: string
      format: email
    name:
      type: string
      nullable: true
      description: Display name if one was supplied on the invite, else null
    role:
      $ref: '#/OrgInviteRole'
    userId:
      type: string
      format: uuid
      nullable: true
      description: Shell user id backing this email, when one exists
    createdAt:
      type: string
      format: date-time
    expiresAt:
      type: string
      format: date-time

OrganizationRoster:
  type: object
  description: Everyone who can be staffed onto a case in this organization.
  required: [members, pendingInvites]
  properties:
    members:
      type: array
      items:
        $ref: '#/OrganizationMember'
    pendingInvites:
      type: array
      items:
        $ref: '#/OrgRosterPendingInvite'
```

Add `GET /orgs/{org}/roster` to `contracts/paths/organizations.yaml`, modelled on the existing `/orgs/{org}/members` entry (same `org` path parameter, same `403`/`404` error responses), `operationId: getOrganizationRoster`, `200` returning `OrganizationRoster`.

Wire both into `contracts/openapi.yaml` alongside the existing organizations refs.

Run `npm run gen`.

**Done when:** `components['schemas']['OrganizationRoster']` resolves in both `frontend/src/generated/api-types.ts` and the backend copy.

---

## Task 2: Backend — `GET /orgs/:org/roster`

**Implementer:** sonnet
**Files:** `backend/src/modules/organizations/organizations.service.ts`, `organizations.controller.ts`, `organizations.service.spec.ts`

Inject `@InjectRepository(OrganizationInviteEntity)` into `OrganizationsService` (the entity is already registered in `OrganizationsModule`).

Add:

```ts
/**
 * Everyone who can be staffed onto a case in this org: accepted members plus
 * people with a live org invite. Pending invitees already have a shell user
 * row (created by OrgInvitesService.create), so a case_members row can be
 * written against them now and activates on signup.
 *
 * The invite `code` is never returned - this endpoint is readable by any org
 * member, while codes are admin-only secrets.
 */
async getRoster(orgId: string): Promise<{ members: ...; pendingInvites: ... }>
```

Behaviour:

1. `members` is exactly the existing `listMembers(orgId)` output. Reuse it, do not reimplement.
2. Pending invites: `usedAt IS NULL AND expiresAt > NOW()` for the org, newest first.
3. Drop any invite whose lowercased email matches an accepted member's email (stale invite for someone who joined another way).
4. There is no unique constraint on `(organization_id, email)`, so collapse duplicate emails keeping the newest invite.
5. Resolve `userId` by looking the email up in `users`; leave `null` if absent.
6. `name`: the shell user's `name` when it is not just a placeholder copy of the email, else `null`.

Controller:

```ts
@RequireOrgRole('member')
@Get('roster')
getRoster(@Req() req: any) {
  return this.service.getRoster(req.organization.id);
}
```

Place it above the `members` routes; guests stay excluded from enumerating the org, matching `GET members` today.

**Tests** (`organizations.service.spec.ts`): pending invite appears; used invite excluded; expired invite excluded; invite whose email matches an accepted member excluded; two invites for one email collapse to the newest; no `code` field on any returned object.

---

## Task 3: Backend — scope `addMemberByEmail` to the case's org

**Implementer:** opus
**Files:** `backend/src/modules/cases/cases.service.ts`, `cases.module.ts`, `cases.service.spec.ts`

**Pre-existing bug this closes:** `POST /cases/:caseId/members` is `@RequireRole('owner')` on the case, but `addMemberByEmail` only does `usersService.findByEmail` with no check that the target belongs to the case's org. A case owner in org A can grant a case seat to any known email in org B by guessing it, and that user then sees the case in `findAllForUser`. Cross-org isolation is a hard requirement, and this change makes the endpoint more central, so fix it here.

Register `OrganizationInviteEntity` in `CasesModule` and inject its repo into `CasesService`.

Rewrite `addMemberByEmail`:

```ts
/**
 * Add someone to a case by email. The target must belong to the case's org:
 * either an accepted organization_members row, or a live (unused, unexpired)
 * organization_invites row. Pending invitees already have a shell user row, so
 * the case_members grant is written now and activates when they sign up.
 *
 * Anyone else - unknown email, or a user who belongs to a different org -
 * raises NotFoundException on purpose, NOT ForbiddenException: NewCaseModal
 * catches 404 and falls back to creating an external case invite, which is the
 * correct path for an outsider.
 */
```

Order of operations: fetch the case (for `orgId`), resolve the user by email (404 if none), then require an org membership **or** a live org invite for that email in `caseEntity.orgId` (404 if neither), then delegate to `addMember`.

`addMember(caseId, userId, role)` is unchanged and stays the entry point for `InvitesService.accept`, which is how external invitees get their row without an org membership. Do not route that through the new check.

**Tests** (`cases.service.spec.ts`): accepted org member of the case's org succeeds; pending org invitee of the case's org succeeds; user who exists but belongs to another org throws `NotFoundException`; unknown email throws `NotFoundException`; a used or expired org invite does not qualify.

---

## Task 4: Frontend — api client and the shared roster partition

**Implementer:** sonnet
**Files:** `frontend/src/lib/api-client.ts`, `frontend/src/lib/roster.ts` (create), `frontend/src/lib/roster.test.ts` (create)

`api-client.ts`, in the Organizations block next to `listOrgMembers`:

```ts
getOrgRoster: (slug: string) =>
  request<components['schemas']['OrganizationRoster']>(`/orgs/${slug}/roster`),
```

Export `OrganizationRoster` / `OrgRosterPendingInvite` aliases alongside the existing `OrganizationMember` usage.

`frontend/src/lib/roster.ts` — one pure function replacing the partition logic currently duplicated (and subtly divergent) in the settings page and `NewCaseModal`:

```ts
export interface StaffingCandidate {
  key: string;            // userId when known, else `email:${lowercased email}`
  userId: string | null;
  email: string;
  name: string | null;
  pending: boolean;       // org invite not yet accepted
}

export interface StaffingRoster {
  candidates: StaffingCandidate[];      // selectable in the picker
  implicitAdmins: StaffingCandidate[];  // shown disabled, with a reason
}

export function buildStaffingRoster(
  roster: OrganizationRoster,
  opts: { excludeUserIds?: Iterable<string>; excludeEmails?: Iterable<string> },
): StaffingRoster
```

Rules:

- Org role `admin` (accepted **or** pending) goes to `implicitAdmins`. Admins hold implicit `owner` on every case via `orgRoleToImplicitCaseRole`, and an explicit `case_members` row takes precedence, so adding one as viewer would silently downgrade them. Keep the existing rationale comment.
- Everyone else is a candidate.
- Exclusions apply by `userId` and by lowercased email, so a caller can pass either.
- Dedupe across the two lists by lowercased email; an accepted member wins over a pending invite for the same address.
- Sort accepted before pending, each alphabetically by name then email, so the picker is stable.

**Tests** (`roster.test.ts`): admin accepted and admin pending both land in `implicitAdmins`; pending non-admin is a selectable candidate with `pending: true`; existing case members are excluded by either id or email; member wins over a duplicate pending invite; ordering is accepted-then-pending.

---

## Task 5: Frontend — case settings members section

**Implementer:** sonnet
**File:** `frontend/src/app/cases/[caseId]/settings/page.tsx`

In `MembersSection`:

1. Replace the `apiClient.listOrgMembers(orgSlug)` effect with `apiClient.getOrgRoster(orgSlug)`, holding `OrganizationRoster | null`. Keep the existing `.catch(() => set empty)` behaviour so a case owner who is only an org guest still renders (roster is `member`-gated, same as members is today).
2. Replace the inline `orgAdmins` / `candidates` computation with `buildStaffingRoster(roster, { excludeUserIds: members.map(m => m.userId), excludeEmails: members.map(m => m.user?.email) })`.
3. Picker `<option>` values switch from `userId` to `candidate.key`; `handleAddFromOrg` looks the candidate up by key and posts `{ email: candidate.email, role: pickedRole }`. The endpoint call is unchanged.
4. Option labels:
   - candidate, accepted: `Name (email)` (unchanged)
   - candidate, pending: `Name (email) - org invite pending`
   - implicit admin, accepted: `Name - org admin, already has access` (unchanged)
   - implicit admin, pending: `Name - org admin invite pending, will have access`
5. Member rows: when `m.user?.linked === false`, render a small muted `invite pending` marker next to the email, matching the approved layout:

   ```
   Joe                      [ Editor v ]  (trash)
   joe@courtyard.io   · invite pending
   ```

   Role and remove controls stay fully enabled for these rows.
6. Copy, no em dashes:
   - Section description, replacing "Give someone who already has an account access to this case. They get it immediately — no invite to send or accept.":
     > Give someone in your organization access to this case. If they have an account, they get it immediately. If their org invite is still pending, the seat is saved and they land on this case as soon as they sign up.
   - External invites callout, replacing "Use this only for someone with no account — outside counsel, ...":
     > For people outside your organization. Outside counsel, a retained expert, a co-defendant's team. They get a link, create an account, and land on this case only. To add someone who is already in your organization, or who you have invited but who has not signed up yet, use **Add from your organization** above.

---

## Task 6: Frontend — new case modal

**Implementer:** sonnet
**File:** `frontend/src/components/Cases/NewCaseModal.tsx`

Same switch: `getOrgRoster` instead of `listOrgMembers`, and `buildStaffingRoster` instead of the local `orgAdmins` / `orgCandidates` partition. This file stages members by email before the case exists, so pass `excludeEmails: staged` plus `excludeUserIds: [user.id]` and stage `candidate.email`. Mirror the Task 5 option labels and the disabled-admin string so the two pickers read identically.

Leave the `handleSubmit` 404 fallback to `createInvite` exactly as it is. After Task 3 it becomes strictly more correct: an email outside the org now reliably 404s and falls through to an external invite link instead of silently granting a cross-org seat.

---

## Verification

- `npm run test --prefix backend` and `npm run test --prefix frontend` green (the 13 known e2e failures aside).
- Manual: with `joe@courtyard.io` holding a pending org invite in `demo`, open a case's settings. Joe appears in the picker as `Joe (joe@courtyard.io) - org invite pending`, adds as Editor, and shows in the members list with the `invite pending` marker. Accepting the org invite as Joe lands him on that case at Editor, not the implicit role.
