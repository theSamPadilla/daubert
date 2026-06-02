# Roles & Permissions

Daubert has three independent role namespaces:

| Layer | Property of | Roles | Source of truth |
|---|---|---|---|
| **Superadmin** | the user (platform-level) | `is_super_admin: boolean` | `users.is_super_admin` column |
| **Org role** | the `(user, org)` pair | `admin` > `member` > `guest` | `organization_members.role` column |
| **Case role** | the `(user, case)` pair | `owner` > `editor` > `viewer` | `case_members.role` column |

The three answer different questions:
- "Is this person an Incite operator who can administer the platform itself?" → superadmin
- "What can this user do inside organization X?" → org role
- "What can this user do inside case Y?" → case role

A user can be all three (e.g., an Incite engineer who is also an admin of the Incite org and owner of a specific case), independent of any pair.

## Superadmin

The platform-level flag. There is no hierarchy — `is_super_admin` is binary. Superadmins are Incite staff. They:

- Can create new organizations and assign their first admin.
- Can soft-delete, restore, and purge organizations.
- Can manage labeled entities (the platform-global wallet label list consumed by the AI tools).
- Can list every user on the platform and toggle the superadmin flag on others.
- **Cannot** read case contents, investigations, traces, AI chat, data room, productions, or org-internal membership rosters for orgs they do not personally belong to. The superadmin panel surfaces aggregate metadata only (counts, names, slugs, timestamps).

### Initial assignment

Superadmin is set at user-shell creation by `SuperadminUsersService.createUserShell`. If the email's domain matches `ADMIN_EMAIL_DOMAIN` (`incite.ventures`), the shell is created with `is_super_admin = true`. Otherwise `false`. Once a user exists, superadmin status is read off the column — `ADMIN_EMAIL_DOMAIN` is consulted only during shell creation.

A superadmin can flip another user's flag via `PATCH /superadmin/users/:id/super-admin`.

### Guard

`@RequireSuperAdmin()` decorator + `SuperAdminGuard`. Reads `req.user.isSuperAdmin`. 403s otherwise.

## Org-level roles

Per-org. Stored on `organization_members.role`. Every membership has exactly one role.

| Role | Intent |
|---|---|
| `admin` | Governs the org: members, invites, settings, slug. Also has **implicit owner-equivalent access to every case in the org** (see [Org admin → case access](#org-admin--case-access)). |
| `member` | Can create new cases in the org via `POST /cases` with this `orgId`. Cannot manage org-level settings or other members. |
| `guest` | Cannot create cases. Can be invited into specific cases by their owner and act there per their case-level role. |

### Hierarchy

Used by the `@RequireOrgRole(minRole)` guard:

```ts
const ORG_ROLE_HIERARCHY = { guest: 0, member: 1, admin: 2 };
```

A route declared `@RequireOrgRole('member')` admits both `member` and `admin`.

### Guard

`@RequireOrgRole(minRole)` reads `:org` from the route (the org slug), resolves it to an `OrganizationEntity` (refusing soft-deleted orgs with a 404), looks up the requester's `organization_members` row, and:

- 404s if the org slug doesn't resolve to an active (non-soft-deleted) org;
- 403s if there is no membership row;
- 403s if the membership's role is below `minRole`.

On success, attaches `req.organization` (resolved entity) and `req.orgMembership` so handlers can read the role without re-querying.

### Initial role assignment

Org membership is created in three places:

1. **At org creation.** `POST /superadmin/orgs` accepts `{ name, slug?, firstAdminEmail }`. The first admin gets `role: 'admin'` automatically. If the email doesn't match an existing user, a shell is created (`firebaseUid: null`) and they become admin pending sign-in. The new user's `is_super_admin` is NOT changed by this operation.
2. **At org-invite accept.** `POST /org-invites/:code/accept` creates an `organization_members` row with the role embedded in the invite.
3. **By an existing org admin.** `POST /orgs/:org/members` (direct-add by email) and `PATCH /orgs/:org/members/:userId` (change role).

### Org admin → case access

An org admin has **implicit owner-equivalent access to every case in their org**, regardless of whether they hold a `case_members` row for that case. This is enforced in `RoleGuard`: after resolving the case, the guard checks for an org-admin membership for `(user.id, cases.organization_id)`. If present, it synthesizes a `req.caseMembership` with `role: 'owner'` and `source: 'org-admin-implicit'` and returns true without checking `case_members`. The synthetic shape lets every handler that reads `req.caseMembership.role` behave identically to a real owner — no per-handler branching.

Practical consequences:
- An org admin can edit, govern, and delete any case in their org from day one, without needing to be invited or to self-promote.
- The org admin does NOT appear in the case's `members` list (only real `case_members` rows do). This is a known UX gap; the panel is the source of truth for explicit membership.
- A case-only collaborator (no `organization_members` row in the host org) is unaffected. They see only the case they were invited to.

### Promotion

Org-internal promotion (`member → admin`, `guest → member`, etc.) happens via `PATCH /orgs/:org/members/:userId` by an existing org admin. There is no CLI for this.

## Case-level roles

Per-`(user, case)`. Stored on `case_members.role`. Every membership has exactly one role.

| Role | Intent |
|------|--------|
| `owner` | Governs the case: members, settings, deletion. Also does all editor work. |
| `editor` | Trusted collaborator: does the investigative work but cannot govern the case. |
| `viewer` | Read-only access. Can use the AI in a read-only mode. Cannot see other members. |

Role hierarchy (used by the access guard): `owner > editor > viewer`. A route that requires `editor` is satisfied by owner or editor; a route that requires `viewer` is satisfied by any member.

## Capability matrix

The superadmin column shows what a superadmin can do *as superadmin*, i.e., on platform routes. Inside an org or case they do NOT belong to, they have no access. Inside an org they DO belong to, their effective rights are the union of their org role and (if applicable) their case role plus whatever superadmin powers apply at the platform level.

| Capability | Superadmin | Org admin | Org member | Org guest | Case owner | Case editor | Case viewer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Create new orgs | yes | no | no | no | — | — | — |
| Soft-delete / restore / purge orgs | yes | no | no | no | — | — | — |
| Edit own org (name, slug) | no¹ | yes | no | no | — | — | — |
| Manage org members & invites | no¹ | yes | no | no | — | — | — |
| Create new cases (in an org you belong to) | no¹ | yes | yes | no | — | — | — |
| Manage labeled entities (platform-global) | yes | no | no | no | — | — | — |
| Toggle `is_super_admin` on other users | yes | no | no | no | — | — | — |
| View case, investigations, traces, data room, productions | no² | yes³ | no⁴ | no⁴ | yes | yes | yes |
| AI chat — read-only tools (incl. `execute_script` for blockchain & loopback reads) | no² | yes³ | no⁴ | no⁴ | yes | yes | yes |
| AI chat — mutating tools (productions, traces, labels) | no² | yes³ | no⁴ | no⁴ | yes | yes | no |
| See member list | no² | yes³ | no⁴ | no⁴ | yes | yes | no |
| Create / edit / delete investigations | no² | yes³ | no⁴ | no⁴ | yes | yes | no |
| Create / edit / delete traces | no² | yes³ | no⁴ | no⁴ | yes | yes | no |
| Manage data room (upload, link, delete) | no² | yes³ | no⁴ | no⁴ | yes | yes | no |
| Manage productions | no² | yes³ | no⁴ | no⁴ | yes | yes | no |
| Edit case fields (name, summary) | no² | yes³ | no⁴ | no⁴ | yes | no | no |
| Add / remove members, change member roles | no² | yes³ | no⁴ | no⁴ | yes | no | no |
| Generate / revoke invite links | no² | yes³ | no⁴ | no⁴ | yes | no | no |
| Delete case | no² | yes³ | no⁴ | no⁴ | yes | no | no |
| Leave the case (self-remove) | — | n/a (implicit) | — | — | yes (unless last owner) | yes | yes |

¹ Superadmin powers are about platform operations, not per-org content; org self-management is the org admin's job.
² Superadmin has no special access to case contents in orgs they're not a member of.
³ Org admin gets implicit owner-equivalent access to every case in their org (see [Org admin → case access](#org-admin--case-access)).
⁴ Org members and guests are NOT case members by default. They access cases through explicit `case_members` rows (added by a case owner) or through case invites.

## Invariants

1. **An org always has at least one admin.** The system refuses any operation that would leave the org with zero admins — including the last admin downgrading themselves to member/guest, removing themselves, or being removed by another admin. Error: "transfer admin role before leaving."
2. **A case always has at least one owner.** Same shape as the org invariant. Error: "transfer ownership before leaving." Note: org admins do NOT count toward the owner count — they hold *implicit* owner access but are not in `case_members`. The invariant tracks the explicit `case_members` rows.
3. **A user has at most one membership per org** (unique `(user_id, organization_id)`) and **at most one membership per case** (unique `(user_id, case_id)`).
4. **Soft-deleted orgs disappear from every read path.** `GET /orgs/:org`, `OrgRoleGuard` resolution, `findAllForUser`'s org-admin branch, `/auth/me`'s orgs list — all filter by `deleted_at IS NULL`. Members of a soft-deleted org get 404 on org-scoped routes until restored.
5. **Case membership is independent of org membership.** A case-only collaborator (e.g., an external lawyer) can be a member of a case without any `organization_members` row in the host org. They see only the case they were invited to: their `/cases` listing returns only `case_members` rows; they have no access to org-scoped routes; they don't appear in any org member directory.
6. **Viewers never see member data.** Backend handlers strip the `members` field from responses when the requester's role is `viewer`. The AI chat surface gets the same treatment — no member-listing tool is exposed to a viewer's tool registry.
7. **AI tool exposure is gated at the registry, not the tool.** When the AI endpoint builds the tool set for a request, it reads the caller's role and includes only tools that role can use. Each tool's handler also re-checks the caller's role as defense in depth, but the registry filter is the primary boundary.

## Backend enforcement

Three guards stack atop the shared `AuthGuard` (which resolves the Firebase token → `req.user` and/or script tokens → `req.principal`):

- `@RequireSuperAdmin()` — `SuperAdminGuard`. Checks `req.user.isSuperAdmin`. 403s otherwise.
- `@RequireOrgRole(minRole)` — `OrgRoleGuard`. Resolves `:org` slug → org → membership. Filters out soft-deleted orgs. 404/403 as described above.
- `@RequireRole(minRole)` — `RoleGuard`. Reads `:caseId` from the route, short-circuits with implicit `owner` for org admins of the case's host org, else looks up the requesting user's `case_members` row.

```ts
@RequireRole('owner')   // owner only (or org admin of case's org)
@RequireRole('editor')  // owner or editor (or org admin)
@RequireRole('viewer')  // any case member (or org admin)
```

Script-token requests (`AccessPrincipal` of kind `'script'`) never have `req.user`, so they bypass both `OrgRoleGuard` and `RoleGuard` entirely and use `CaseAccessService.assertRole(principal, caseId, minRole)` at the service layer. Scripts carry the initiator's case role inside the signed token; a script initiated by a viewer is admitted on viewer-or-lower routes and rejected on editor/owner routes, identical to the user-principal path.

### Route audit (target state)

#### Platform (superadmin-gated)

| Method + path | Required role |
|---|---|
| `GET /superadmin/orgs` | superadmin |
| `GET /superadmin/orgs/trash` | superadmin |
| `POST /superadmin/orgs` | superadmin (body: `{ name, slug?, firstAdminEmail }`) |
| `DELETE /superadmin/orgs/:id` | superadmin (soft delete) |
| `POST /superadmin/orgs/:id/restore` | superadmin |
| `POST /superadmin/orgs/:id/purge` | superadmin (only if `deleted_at < NOW() - 30 days`) |
| `GET /superadmin/users` | superadmin |
| `POST /superadmin/users` | superadmin (body: `{ email, name }` — creates a shell) |
| `DELETE /superadmin/users/:id` | superadmin |
| `PATCH /superadmin/users/:id/super-admin` | superadmin (body: `{ value: boolean }`) |
| `GET /superadmin/cases` | superadmin (aggregate metadata only) |
| `POST /superadmin/labeled-entities` | superadmin |
| `PATCH /superadmin/labeled-entities/:id` | superadmin |
| `DELETE /superadmin/labeled-entities/:id` | superadmin |

#### Per-org (org-role-gated)

URL param `:org` is the slug.

| Method + path | Required org role |
|---|---|
| `GET /orgs/:org` | `member` |
| `PATCH /orgs/:org` | `admin` (body: `{ name?, slug? }`) |
| `GET /orgs/:org/members` | `member` |
| `POST /orgs/:org/members` | `admin` (direct-add by email) |
| `PATCH /orgs/:org/members/:userId` | `admin` |
| `DELETE /orgs/:org/members/:userId` | `admin` |
| `POST /orgs/:org/members/me/leave` | `guest` (any member; refused if last admin) |
| `POST /orgs/:org/invites` | `admin` (body: `{ email, role: member|guest, message? }`) |
| `GET /orgs/:org/invites` | `admin` |
| `DELETE /orgs/:org/invites/:inviteId` | `admin` |
| `GET /org-invites/:code` | public |
| `POST /org-invites/:code/accept` | auth (Firebase token); email match check |

#### Cases (auth + case-role-gated)

| Method + path | Required role |
|---|---|
| `GET /cases` | (auth only — lists the caller's accessible cases: explicit `case_members` rows + org-admin-implicit cases) |
| `POST /cases` | (body includes `orgId`; service-layer check refuses if caller is not at least `member` in that org) |
| `GET /cases/:caseId` | `viewer` |
| `PATCH /cases/:caseId` | `owner` |
| `DELETE /cases/:caseId` | `owner` |
| `GET /cases/:caseId/members` | `editor` (viewers blocked) |
| `POST /cases/:caseId/members` | `owner` (direct-add an existing platform user by email) |
| `PATCH /cases/:caseId/members/:userId` | `owner` |
| `DELETE /cases/:caseId/members/:userId` | `owner` |
| `POST /cases/:caseId/members/me/leave` | any member; refused if caller is the last owner |
| `POST /cases/:caseId/invites` | `owner` |
| `GET /cases/:caseId/invites` | `owner` |
| `DELETE /cases/:caseId/invites/:inviteId` | `owner` |
| `GET /invites/:code` | public |
| `POST /invites/:code/accept` | auth (Firebase token); email match check |
| Investigation / trace / data-room / production mutations | `editor` |
| Investigation / trace / data-room / production reads | `viewer` |
| AI chat | `viewer` minimum; tool set is filtered by role inside the handler |

## Frontend implications

- **Active-org context.** `OrgContext` (in `frontend/src/contexts/OrgContext.tsx`) exposes `orgs[]` (from `/auth/me`) and the active org slug. URL routes use the slug (`/orgs/:orgSlug/settings`), and the home page's case list is filtered by active org.
- **Org switcher.** Top-nav `OrgSwitcher` lists every org the user belongs to. Returns `null` (no switcher rendered) for case-only collaborators with `orgs.length === 0`.
- **Org settings.** `/orgs/[orgSlug]/settings` — three sections (info, members, invites). Members + invites sections gate admin-only chrome.
- **Case settings.** `/cases/[caseId]/settings` — owner-only chrome for case fields, member management, invite generation, delete. Org admins viewing a case they're not a member of see the same owner chrome (per implicit-owner access).
- **Superadmin panel.** `/superadmin/*` — gated by `SuperAdminGuard` (`user.isSuperAdmin === true`). Aggregate-only views of orgs (with delete/restore/purge), users (with super-admin toggle), cases (read-only telemetry), and labeled entities (CRUD).
- **Case-only collaborators** see a stripped home: no `OrgSwitcher`, no "+ New case" tile, no Superadmin link in `UserMenu`. Their case list shows only the case(s) they were invited to.

## Data model

### `users.is_super_admin`
Boolean, default `false`. Replaces the legacy `users.org_role` column (which conflated platform-staff status with the implicit single-org role).

### `organizations`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `name` | varchar | Display name |
| `slug` | varchar | Unique. URL-addressable identifier (lowercase, hyphens, regex `^[a-z0-9-]+$`). |
| `deleted_at` | timestamptz | Nullable. NULL = active. NOT NULL = soft-deleted. |
| `created_at`, `updated_at` | timestamptz | from `BaseEntity` |

### `organization_members`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `users.id`, cascade |
| `organization_id` | uuid | FK → `organizations.id`, cascade |
| `role` | varchar | `admin`, `member`, `guest`. Default `guest`. |
| `created_at`, `updated_at` | timestamptz | |
| | | Unique constraint on `(user_id, organization_id)`. |

### `organization_invites`
Mirror of `case_invites`. See `backend/src/database/entities/organization-invite.entity.ts`. Role is `member|guest` (admin invites are rejected at the DTO layer).

### `cases.organization_id`
UUID, NOT NULL, FK → `organizations.id`, cascade-delete. Every case belongs to exactly one org.

### `case_members.role`
Unchanged. String column, three valid values: `owner`, `editor`, `viewer`.

## Migration from the pre-org model

A single migration (`OrganizationsAndSuperadmin`) carries the working tree from the single-implicit-org world to the multi-org world. On prod, ordered, idempotent steps:

1. Create `organizations`, `organization_members`, `organization_invites` tables.
2. Add `users.is_super_admin` column (default `false`).
3. Add `cases.organization_id` column (nullable initially).
4. Seed an "Incite" organization with slug `incite`.
5. Backfill `organization_members` from `users.org_role` 1:1 — every existing user becomes a member of the Incite org with their existing role mapped (`admin → admin`, `member → member`, `guest → guest`).
6. Promote `@incite.ventures` users to `is_super_admin = true`.
7. Backfill `cases.organization_id` to the Incite org for every existing case.
8. `ALTER TABLE cases ALTER COLUMN organization_id SET NOT NULL` + FK constraint.
9. Drop the legacy `users.org_role` column.

Every step is guarded against re-run (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, WHERE NOT EXISTS, ON CONFLICT DO NOTHING, EXCEPTION WHEN duplicate_object).

Dev does not need the migration applied — `synchronize: true` creates the new tables/columns from the entity files at backend start. A fresh dev DB has no users or cases to backfill; an Incite org is created manually via the superadmin UI.

## Invitations

There are two invitation surfaces, structurally identical, semantically scoped to different layers.

### Case invites

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `case_id` | uuid | FK → `cases.id`, cascade |
| `email` | varchar (lowercased) | Indexed |
| `role` | varchar | `editor` or `viewer` — never `owner` |
| `code` | varchar | Unique index, nanoid ~16 chars |
| `message` | text | nullable |
| `created_by_user_id` | uuid | FK → `users.id` |
| `expires_at` | timestamptz | Now + 14 days |
| `used_at`, `used_by_user_id` | nullable | Set on successful accept |

### Org invites

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `organization_id` | uuid | FK → `organizations.id`, cascade |
| `email` | varchar (lowercased) | Indexed |
| `role` | varchar | `member` or `guest` — never `admin` |
| `code` | varchar | Unique index, nanoid ~16 chars |
| `message` | text | nullable |
| `created_by_user_id` | uuid | FK → `users.id` |
| `expires_at` | timestamptz | Now + 14 days |
| `used_at`, `used_by_user_id` | nullable | Set on successful accept |

### Shared invariants

1. **Single-use.** Once `used_at` is set, the code is dead. Re-visits to the welcome page show "already used."
2. **Email-bound.** The accept endpoint refuses if the Firebase user's email doesn't match the invite's email. Emails are normalized to lowercase at both write and read.
3. **Expiry is hard.** Expired invites cannot be accepted or extended. The inviter regenerates if needed.
4. **No top-tier invites.** Case invites cannot grant `owner`; org invites cannot grant `admin`. Both are restricted at the DTO layer. Promotion to the top tier is an explicit action by an existing top-tier holder.
5. **Idempotent re-acceptance is disallowed.** If the signed-in user is already a member, the invite is not consumed; the welcome page redirects them with an "already a member" notice. Existing role wins.

### Case-invite isolation

A case invite creates ONLY a `case_members` row. It does NOT create an `organization_members` row in the case's host org. The invitee (e.g., an external lawyer) is sandboxed to the case they were invited to and sees nothing else of the host org. This is a hard invariant of the accept flow — there is a regression test in `invites.service.spec.ts` asserting no `OrganizationMemberEntity` is created during case-invite accept.

### Flow (case invite)

1. **Owner creates invite** in case settings → enters email, picks role, optional message → server returns `{ code, url }`. Owner copies and sends.
2. **Invitee opens `/invite/<code>`** (public route). Welcome page renders inviter name, case name, role, message, and the gated email. "Sign in with Google" uses `login_hint = invite.email`.
3. **Firebase auth completes** → frontend POSTs `/invites/<code>/accept` with the Firebase ID token.
4. **Server validates** invite exists, not used, not expired, `firebaseUser.email === invite.email`. Typed errors render the appropriate welcome-page message.
5. **On success:** create `case_members` row, mark invite used, redirect to `/cases/<caseId>`.

### Flow (org invite)

Same shape, different surface: welcome page at `/org-invite/<code>`, lookup returns org slug + name (not case), accept creates `organization_members`, redirect to `/orgs/<orgSlug>/settings`.

### Owner / admin management

In the case settings panel, owners see pending invites (email, role, created, expires, copy link, revoke). Used invites are not listed — the resulting member appears in the members list instead. Same shape on the org settings page for org invites.
