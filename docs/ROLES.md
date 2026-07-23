# Roles & Permissions

Daubert has three independent role namespaces:

| Layer | Property of | Roles | Source of truth |
|---|---|---|---|
| **Superadmin** | the user (platform-level) | `is_super_admin: boolean` | `users.is_super_admin` column |
| **Org role** | the `(user, org)` pair | `admin` > `member` > `guest` | `organization_members.role` column |
| **Case role** | the `(user, case)` pair | `owner` > `editor` > `viewer` | `case_members.role` column |

The three answer different questions:
- "Is this person an Incite operator who can administer the platform itself?" -> superadmin
- "What can this user do inside organization X?" -> org role
- "What can this user do inside case Y?" -> case role

A user can be all three (e.g., an Incite engineer who is also an admin of the Incite org and owner of a specific case), independent of any pair.

## Superadmin

The platform-level flag. There is no hierarchy -- `is_super_admin` is binary. Superadmins are Incite staff. They:

- Can create new organizations and assign their first admin.
- Can soft-delete, restore, and purge organizations.
- Can manage labeled entities (the platform-global wallet label list consumed by the AI tools).
- Can list every user on the platform and toggle the superadmin flag on others.
- Can read the token-usage dashboards (aggregate LLM metering across orgs/users/cases/conversations).
- **Cannot** read case contents, investigations, traces, AI chat, data room, productions, or org-internal membership rosters for orgs they do not personally belong to. The superadmin panel surfaces aggregate metadata only (counts, names, slugs, timestamps).

### Initial assignment

Superadmin is set at user-shell creation by `SuperadminUsersService.createUserShell`. If the email's domain matches `ADMIN_EMAIL_DOMAIN` (`incite.ventures`), the shell is created with `is_super_admin = true`. Otherwise `false`. Once a user exists, superadmin status is read off the column -- `ADMIN_EMAIL_DOMAIN` is consulted only during shell creation.

A superadmin can flip another user's flag via `PATCH /superadmin/users/:id/super-admin`.

### Guard

`@RequireSuperAdmin()` decorator + `SuperAdminGuard`. Reads `req.user.isSuperAdmin`. 403s otherwise.

## Org-level roles

Per-org. Stored on `organization_members.role`. Every membership has exactly one role.

| Role | Intent |
|---|---|
| `admin` | Governs the org: members, invites, settings, slug. Also has **implicit owner-equivalent access to every case in the org** (see [Org role -> implicit case access](#org-role---implicit-case-access)). |
| `member` | Can create new cases in the org via `POST /cases` with this `orgId`. Has **implicit editor access to every case in the org**. Cannot manage org-level settings or other members. |
| `guest` | Cannot create cases. Sees the org's cases as ghosted tiles on the home page (discovery surface) but needs an explicit `case_members` row (owner-added or invite) to open one. |

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
2. **At org-invite accept.** `POST /org-invites/:code/accept` creates an `organization_members` row with the role embedded in the invite. Invites can carry any org role, including `admin` (the old member/guest restriction was deliberately lifted).
3. **By an existing org admin.** `POST /orgs/:org/members` (direct-add by email) and `PATCH /orgs/:org/members/:userId` (change role).

### Org role -> implicit case access

Org membership derives a default case role for every case in the org (`orgRoleToImplicitCaseRole` in `backend/src/modules/auth/case-access.service.ts`):

| Org role | Implicit case role |
|---|---|
| `admin` | `owner` |
| `member` | `editor` |
| `guest` | none (explicit `case_members` row required) |

The **explicit `case_members` row wins over the implicit role** -- an admin can downgrade a member to viewer on a specific case, or grant a guest editor access. The implicit role is the fallback when no explicit row exists.

There is exactly one resolution authority: `CaseAccessService.assertAccess` / `assertRole`. The route-level `RoleGuard` (on `:caseId` routes such as `GET /cases/:caseId`) delegates to it with a user principal, and the service-layer paths (id-scoped routes like `/investigations/:id`, `/traces/:id`, `/productions/:id`, plus script and MCP principals) call it directly -- both apply the same explicit-row-first, then implicit `admin -> owner` / `member -> editor` mapping.

Practical consequences:
- An org admin can edit, govern, and delete any case in their org from day one, without needing to be invited or to self-promote.
- An org member collaborates as editor on every org case and sees all org cases in `GET /cases` with `role: 'editor'`.
- Neither implicit role appears in the case's `members` list (only real `case_members` rows do). The membership panel is the source of truth for explicit membership.
- A case-only collaborator (no `organization_members` row in the host org) is unaffected. They see only the case they were invited to.

### Promotion

Org-internal promotion (`member -> admin`, `guest -> member`, etc.) happens via `PATCH /orgs/:org/members/:userId` by an existing org admin, or by accepting an `admin`-role org invite. There is no CLI for this.

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
| Create new orgs | yes | no | no | no | -- | -- | -- |
| Soft-delete / restore / purge orgs | yes | no | no | no | -- | -- | -- |
| Edit own org (name, slug) | no¹ | yes | no | no | -- | -- | -- |
| Manage org members & invites | no¹ | yes | no | no | -- | -- | -- |
| Create new cases (in an org you belong to) | no¹ | yes | yes | no | -- | -- | -- |
| Manage labeled entities (platform-global) | yes | no | no | no | -- | -- | -- |
| Token-usage dashboards | yes | no | no | no | -- | -- | -- |
| Toggle `is_super_admin` on other users | yes | no | no | no | -- | -- | -- |
| Manage org declarants & declaration library | no¹ | yes | yes⁶ | no | -- | -- | -- |
| View case, investigations, traces, data room, productions | no² | yes³ | yes⁵ | no⁴ | yes | yes | yes |
| AI chat -- read-only tools (incl. `execute_script` for blockchain & loopback reads) | no² | yes³ | yes⁵ | no⁴ | yes | yes | yes |
| AI chat -- mutating tools (productions, traces, labels) | no² | yes³ | yes⁵ | no⁴ | yes | yes | no |
| See member list | no² | yes³ | yes⁵ | no⁴ | yes | yes | no |
| Create / edit / delete investigations | no² | yes³ | yes⁵ | no⁴ | yes | yes | no |
| Create / edit / delete traces | no² | yes³ | yes⁵ | no⁴ | yes | yes | no |
| Manage data room (upload, folders, delete, import) | no² | yes³ | yes⁵ | no⁴ | yes | yes | no |
| Manage productions | no² | yes³ | yes⁵ | no⁴ | yes | yes | no |
| Edit case fields (name, summary) | no² | yes³ | no | no⁴ | yes | no | no |
| Add / remove members, change member roles | no² | yes³ | no | no⁴ | yes | no | no |
| Generate / revoke invite links | no² | yes³ | no | no⁴ | yes | no | no |
| Delete case | no² | yes³ | no | no⁴ | yes | no | no |
| Leave the case (self-remove) | -- | n/a (implicit) | n/a (implicit) | -- | yes (unless last owner) | yes | yes |

¹ Superadmin powers are about platform operations, not per-org content; org self-management is the org admin's job.
² Superadmin has no special access to case contents in orgs they're not a member of.
³ Org admin gets implicit owner-equivalent access to every case in their org (see [Org role -> implicit case access](#org-role---implicit-case-access)).
⁴ Org guests are NOT case members by default. They access cases through explicit `case_members` rows (added by a case owner) or through case invites; org cases render as ghosted tiles until then.
⁵ Org members get implicit editor access to every case in their org; explicit `case_members` rows override (including downgrades to viewer). See [Org role -> implicit case access](#org-role---implicit-case-access).
⁶ Declarants have a service-level self-ownership rule: an org member may create declarants and edit/delete only declarants whose `userId` links to themselves; org admins may edit/delete any declarant in the org.

## Invariants

1. **An org always has at least one admin.** The system refuses any operation that would leave the org with zero admins -- including the last admin downgrading themselves to member/guest, removing themselves, or being removed by another admin. Errors: "Cannot change role: this organization must have at least one admin. Promote another member first." / "Cannot remove member: ... Transfer admin role first."
2. **A case always has at least one owner.** Same shape as the org invariant. Errors: "Cannot change role: this case must have at least one owner. Promote another member first." (same copy for removal). Note: org admins do NOT count toward the owner count -- they hold *implicit* owner access but are not in `case_members`. The invariant tracks the explicit `case_members` rows.
3. **A user has at most one membership per org** (unique `(user_id, organization_id)`) and **at most one membership per case** (unique `(user_id, case_id)`).
4. **Soft-deleted orgs disappear from every read path.** `GET /orgs/:org`, `OrgRoleGuard` resolution, `findAllForUser`'s org branch, `/auth/me`'s orgs list, and the implicit case-role derivation all filter by `deleted_at IS NULL`. Members of a soft-deleted org get 404 on org-scoped routes until restored.
5. **Case membership is independent of org membership.** A case-only collaborator (e.g., an external lawyer) can be a member of a case without any `organization_members` row in the host org. They see only the case they were invited to: their `/cases` listing returns only `case_members` rows; they have no access to org-scoped routes; they don't appear in any org member directory. Explicit case memberships are honored even after the user leaves the host org.
6. **Viewers never see member data.** Backend handlers strip the `members` field from responses when the requester's role is `viewer`. The AI chat surface gets the same treatment -- no member-listing tool is exposed to a viewer's tool registry.
7. **AI tool exposure is gated at the registry, not the tool.** When the AI endpoint builds the tool set for a request, it reads the caller's role and includes only tools that role can use (`READ_ONLY_AGENT_TOOLS` for viewers, the full `AGENT_TOOLS` for editors/owners). Each tool's handler also re-checks the caller's role as defense in depth, but the registry filter is the primary boundary.
8. **MCP sessions are org-bound.** Every OAuth session is bound to exactly one `(owner, organization)` pair at consent time. `CaseAccessService.assertAccess` enforces the cross-org gate: an MCP call can never touch a case outside the session's org, regardless of the owner's other memberships.

## Backend enforcement

Requests carry one of three principals (see `backend/src/modules/auth/access-principal.ts`):

```ts
type AccessPrincipal =
  | { kind: 'user'; userId: string }                                           // Firebase token
  | { kind: 'script'; caseId: string; role: CaseRole }                         // signed script token
  | { kind: 'mcp'; userId: string; organizationId: string; sessionId: string } // OAuth session
```

Three guards stack atop the shared `AuthGuard` (which resolves the Firebase token -> `req.user` and/or script tokens -> `req.principal`):

- `@RequireSuperAdmin()` -- `SuperAdminGuard`. Checks `req.user.isSuperAdmin`. 403s otherwise.
- `@RequireOrgRole(minRole)` -- `OrgRoleGuard`. Resolves `:org` slug -> org -> membership. Filters out soft-deleted orgs. 404/403 as described above.
- `@RequireRole(minRole)` -- `RoleGuard`. Reads `:caseId` from the route, 404s if the case does not exist, then delegates to `CaseAccessService.assertRole` with the user principal (explicit `case_members` row first, then the implicit org role).

```ts
@RequireRole('owner')   // owner only (explicit or org-admin implicit)
@RequireRole('editor')  // owner or editor (explicit or implicit)
@RequireRole('viewer')  // any case member (explicit or implicit)
```

Routes addressed by a non-case id (`/investigations/:id`, `/traces/:id`, `/productions/:id`, `/conversations/:id`, ...) carry no guard decorator and enforce access in the service layer via `CaseAccessService.assertAccess` / `assertRole`, which applies the full explicit-then-implicit resolution (admin -> owner, member -> editor).

Script-token requests (`AccessPrincipal` of kind `'script'`) never have `req.user`, so they bypass both `OrgRoleGuard` and `RoleGuard` entirely and use `CaseAccessService.assertRole(principal, caseId, minRole)` at the service layer. Scripts carry the initiator's case role inside the signed token; a script initiated by a viewer is admitted on viewer-or-lower routes and rejected on editor/owner routes, identical to the user-principal path.

MCP requests (`AccessPrincipal` of kind `'mcp'`) hit the single `@Public()` `/mcp` endpoint and are authenticated by `McpAuthHelper`: bearer token -> `oauth_session` hash lookup (401 on miss/expiry/revocation), then a per-call eligibility recheck of the `(userId, organizationId)` membership (401 if absent or `guest`), then a per-session throttle (60 calls/60s). Inside tool handlers, `CaseAccessService` applies the cross-org gate first (the case must belong to the session's org), then resolves the user's effective role exactly like a user principal. The MCP principal is an org-bound session, not a Firebase user: `req.user` is never set on this path.

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
| `POST /superadmin/users` | superadmin (body: `{ email, name }` -- creates a shell) |
| `DELETE /superadmin/users/:id` | superadmin |
| `PATCH /superadmin/users/:id/super-admin` | superadmin (body: `{ value: boolean }`) |
| `GET /superadmin/cases` | superadmin (aggregate metadata only) |
| `POST /superadmin/labeled-entities` | superadmin |
| `PATCH /superadmin/labeled-entities/:id` | superadmin |
| `DELETE /superadmin/labeled-entities/:id` | superadmin |
| `GET /superadmin/token-usage/overview` | superadmin (`days` query: 7/30/90) |
| `GET /superadmin/token-usage/by-org` | superadmin (`days`, `limit`) |
| `GET /superadmin/token-usage/by-user` | superadmin (`days`, `limit`) |
| `GET /superadmin/token-usage/by-case` | superadmin (`days`, `limit`) |
| `GET /superadmin/token-usage/by-conversation` | superadmin (`days`, `limit`) |
| `GET /superadmin/token-usage/org-model-matrix` | superadmin (`days`) |
| `GET /superadmin/token-usage/cache-effectiveness` | superadmin (`days`) |

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
| `POST /orgs/:org/invites` | `admin` (body: `{ email, role: admin\|member\|guest, name?, message? }`) |
| `GET /orgs/:org/invites` | `admin` |
| `DELETE /orgs/:org/invites/:inviteId` | `admin` |
| `GET /org-invites/:code` | public |
| `POST /org-invites/:code/accept` | auth (Firebase token); email match check |
| `GET /orgs/:org/declarants` | `member` |
| `POST /orgs/:org/declarants` | `member` (non-admins may only set `userId` to themselves or leave it null) |
| `PATCH /orgs/:org/declarants/:declarantId` | `member` + service check: admin OR `declarant.userId === requester.userId` |
| `DELETE /orgs/:org/declarants/:declarantId` | `member` + same self-ownership check |
| `POST /orgs/:org/declarants/extract` | `member` (multipart PDF, max 10MB; AI-extracts a declarant draft, persists nothing) |
| `GET /orgs/:org/declarants/:declarantId/files` | `member` (read; no ownership check) |
| `POST /orgs/:org/declarants/:declarantId/files` | `member` + self-ownership check (multipart, max 50MB; kind `cv` or `prior_declaration`) |
| `GET /orgs/:org/declarants/:declarantId/files/:fileId/download` | `member` (read; no ownership check) |
| `DELETE /orgs/:org/declarants/:declarantId/files/:fileId` | `member` + self-ownership check |
| `GET /orgs/:org/files` | `member` (all declarant files across the org, with declarant attribution) |
| `GET /orgs/:org/declaration-library` | `member` |
| `POST /orgs/:org/declaration-library` | `member` |
| `PATCH /orgs/:org/declaration-library/:blockId` | `member` |
| `DELETE /orgs/:org/declaration-library/:blockId` | `member` |

The declarant self-ownership rule lives in `DeclarantsService.loadOwned` (`backend/src/modules/declarants/declarants.service.ts`): the org-scoped lookup runs first (cross-org ids 404 without leaking existence), then `isAdmin = requester.orgRole === 'admin'; isOwner = declarant.userId != null && declarant.userId === requester.userId; if (!isAdmin && !isOwner) throw ForbiddenException('You can only modify your own declarant profile')`.

#### Cases (auth + case-role-gated)

| Method + path | Required role |
|---|---|
| `GET /cases` | (auth only -- lists explicit `case_members` cases plus every case in the caller's orgs, with implicit roles applied; guest-org cases come back without a role and render ghosted) |
| `POST /cases` | (body includes `orgId`; service-layer check refuses if caller is not at least `member` in that org) |
| `GET /cases/:caseId` | `viewer` |
| `PATCH /cases/:caseId` | `owner` |
| `DELETE /cases/:caseId` | `owner` |
| `GET /cases/:caseId/members` | `editor` (viewers blocked) |
| `POST /cases/:caseId/members` | `owner` (direct-add an existing platform user by email) |
| `PATCH /cases/:caseId/members/:userId` | `owner` |
| `DELETE /cases/:caseId/members/:userId` | `owner` |
| `POST /cases/:caseId/members/me/leave` | any member; refused if caller is the last owner |
| `POST /cases/:caseId/invites` | `owner` (body: `{ email, role: owner\|editor\|viewer, name?, message? }`) |
| `GET /cases/:caseId/invites` | `owner` |
| `DELETE /cases/:caseId/invites/:inviteId` | `owner` |
| `GET /invites/:code` | public |
| `POST /invites/:code/accept` | auth (Firebase token); email match check |
| `GET /cases/:caseId/investigations` | `viewer` |
| `POST /cases/:caseId/investigations` | `editor` |
| `GET/PATCH/DELETE /investigations/:id`, `POST /investigations/:id/duplicate` | service-layer: `viewer` for reads, `editor` for mutations |
| `GET /investigations/:id/script-runs` | service-layer `viewer` |
| `POST /investigations/:id/search-between` | service-layer `viewer` (advanced search across the investigation's traces; read-only) |
| `POST /script-runs/:id/rerun` | service-layer `editor` |
| Trace routes (`/investigations/:investigationId/traces`, `/traces/:id`, nodes/edges/groups/bundles subroutes, `/traces/:id/import-transactions`) | service-layer: `viewer` for reads, `editor` for mutations |
| `GET /cases/:caseId/productions` | `viewer` (optional `type` filter: report/chart/chronology/declaration) |
| `POST /cases/:caseId/productions` | `editor` |
| `GET/PATCH/DELETE /productions/:id` | service-layer: `viewer` for reads, `editor` for mutations |
| `GET /cases/:caseId/data-room/files` | `viewer` |
| `GET /cases/:caseId/data-room/files/:fileId/download` | `viewer` |
| `GET /cases/:caseId/data-room/contents` | `viewer` (folder listing + breadcrumb; `folderId` query) |
| `POST /cases/:caseId/data-room/files` | `editor` (streamed upload, 50MB cap, optional `folderId`) |
| `DELETE /cases/:caseId/data-room/files/:fileId` | `editor` |
| `POST /cases/:caseId/data-room/folders` | `editor` |
| `DELETE /cases/:caseId/data-room/folders/:folderId` | `editor` (recursive cascade) |
| `PATCH /cases/:caseId/data-room/files/:fileId/move` | `editor` |
| `PATCH /cases/:caseId/data-room/folders/:folderId/move` | `editor` (cycle-checked) |
| `POST /cases/:caseId/data-room/import/google-drive` | `editor` (body: `{ accessToken, fileIds, folderId? }`) |
| `POST /cases/:caseId/data-room/export/google-drive` | `viewer` (export is a read; logged as `export` in the access log) |
| `POST /cases/:caseId/conversations` | `viewer` (class-level guard; conversations are per-user) |
| `GET /cases/:caseId/conversations` | `viewer` (caller's own conversations only) |
| `GET /conversations/:id/messages` | user principal + service-layer case access; must be the conversation's owner |
| `DELETE /conversations/:id` | same |
| `POST /conversations/:id/chat` | same; `viewer` minimum, tool set filtered by role inside the handler |
| `GET /declaration-formats` | auth only (static app-wide format registry, no org/case scoping) |
| `GET /productions/:id/declaration-preview` | auth + the same service-layer case-access check as `GET /productions/:id` |
| `POST /exports/productions/:id` | auth + service-layer case access on the production (formats: pdf/png/docx/csv per type) |
| `POST /exports/graph` | auth only (renders a caller-supplied image to PDF) |
| `POST /exports/exhibit` | auth + service-layer case access per referenced item |

#### MCP, OAuth, and account endpoints

| Method + path | Auth |
|---|---|
| `POST /mcp` | public route + `McpIpThrottlerGuard`; OAuth bearer token validated per call by `McpAuthHelper` (session lookup, membership recheck with `guest` rejected, 60 calls/60s per session). Principal: org-bound MCP session, not a Firebase user. |
| `GET /oauth/authorize` | public; manual Firebase verification (browser redirect to `/login` or 401 JSON) |
| `POST /oauth/authorize/preview` | public; manual Firebase verification (returns eligible orgs for the consent picker) |
| `POST /oauth/authorize/complete` | public; manual Firebase verification; caller must be `admin` or `member` of the chosen org (guests refused) |
| `POST /oauth/authorize/deny` | public; manual Firebase verification |
| `POST /oauth/token` | public (PKCE S256 code exchange or refresh rotation) |
| `POST /oauth/revoke` | public (RFC 7009; always 200 to prevent token enumeration) |
| `POST /oauth/register` | public + `McpIpThrottlerGuard` (RFC 7591 dynamic client registration, PKCE-only clients) |
| `GET /.well-known/oauth-authorization-server` | public (RFC 8414 discovery) |
| `GET /.well-known/oauth-protected-resource` | public (RFC 9728 discovery) |
| `POST /me/oauth/start-connect` | auth (Firebase) -- returns MCP server URL + per-surface setup instructions |
| `GET /me/oauth-sessions` | auth -- caller's live sessions (id, org, surface label, last used) |
| `POST /me/oauth-sessions/:id/revoke` | auth -- per-device disconnect; ownership checked; idempotent |
| `GET /me/agent-actions` | auth -- caller's recent agent audit-log rows (newest first, capped at 50) |

#### Auth and public utility

| Method + path | Auth |
|---|---|
| `GET /auth/me` | auth (profile + org memberships) |
| `PATCH /auth/me` | auth (body: `{ name }`) |
| `POST /auth/email/otp/send` | public, throttled 3/60s |
| `POST /auth/email/otp/verify` | public, throttled 10/60s |
| `GET /external/trace` | public + website-key guard + IP throttle 10/60s (marketing-site demo endpoint) |
| `GET /labeled-entities`, `GET /labeled-entities/lookup`, `GET /labeled-entities/:id` | auth (read-only registry; writes are superadmin-only) |
| `POST /blockchain/fetch-history`, `POST /blockchain/get-transaction`, `POST /blockchain/get-address-info` | auth (provider proxy, no case scoping) |

## Frontend implications

- **Active-org context.** `OrgContext` (in `frontend/src/contexts/OrgContext.tsx`) exposes `orgs[]` (from `/auth/me`) and the active org slug. URL routes use the slug (`/orgs/:orgSlug/settings`), and the home page's case list is filtered by active org.
- **Org switcher.** Top-nav `OrgSwitcher` lists every org the user belongs to. Returns `null` (no switcher rendered) for case-only collaborators with `orgs.length === 0`.
- **Ghosted tiles.** `GET /cases` returns org-guest cases without a `role`; the home page renders them locked with an "ask an admin" hint (discovery surface, no access).
- **Org settings.** `/orgs/[orgSlug]/settings` -- sections for info, members, and invites. Members + invites sections gate admin-only chrome.
- **Case settings.** `/cases/[caseId]/settings` -- owner-only chrome for case fields, member management, invite generation, delete. Org admins viewing a case they're not a member of see the same owner chrome (per implicit-owner access).
- **Case onboarding wizard.** Shown on the investigations page only when the case has zero investigations, the wizard was not dismissed, and the viewer's role is owner or editor (`canMutate`). **Viewers never see the wizard.** Its optional engagement context step writes a markdown block onto `cases.summary` only when the summary is empty.
- **Superadmin panel.** `/superadmin/*` -- gated by `SuperAdminGuard` (`user.isSuperAdmin === true`). Aggregate-only views of orgs (with delete/restore/purge), users (with super-admin toggle), cases (read-only telemetry), labeled entities (CRUD), and token usage.
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
| `user_id` | uuid | FK -> `users.id`, cascade |
| `organization_id` | uuid | FK -> `organizations.id`, cascade |
| `role` | varchar | `admin`, `member`, `guest`. Default `guest`. |
| `created_at`, `updated_at` | timestamptz | |
| | | Unique constraint on `(user_id, organization_id)`. |

### `organization_invites`
Mirror of `case_invites`. See `backend/src/database/entities/organization-invite.entity.ts`. Role is `admin|member|guest` (admin invites are accepted; the DTO allows all three).

### `cases.organization_id`
UUID, NOT NULL, FK -> `organizations.id`, cascade-delete. Every case belongs to exactly one org.

### `case_members.role`
Unchanged. String column, three valid values: `owner`, `editor`, `viewer`.

## Migration from the pre-org model

A single migration (`OrganizationsAndSuperadmin`) carries the working tree from the single-implicit-org world to the multi-org world. On prod, ordered, idempotent steps:

1. Create `organizations`, `organization_members`, `organization_invites` tables.
2. Add `users.is_super_admin` column (default `false`).
3. Add `cases.organization_id` column (nullable initially).
4. Seed an "Incite" organization with slug `incite`.
5. Backfill `organization_members` from `users.org_role` 1:1 -- every existing user becomes a member of the Incite org with their existing role mapped (`admin -> admin`, `member -> member`, `guest -> guest`).
6. Promote `@incite.ventures` users to `is_super_admin = true`.
7. Backfill `cases.organization_id` to the Incite org for every existing case.
8. `ALTER TABLE cases ALTER COLUMN organization_id SET NOT NULL` + FK constraint.
9. Drop the legacy `users.org_role` column.

Every step is guarded against re-run (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, WHERE NOT EXISTS, ON CONFLICT DO NOTHING, EXCEPTION WHEN duplicate_object).

Dev does not need the migration applied -- `synchronize: true` creates the new tables/columns from the entity files at backend start. A fresh dev DB has no users or cases to backfill; an Incite org is created manually via the superadmin UI.

## Invitations

There are two invitation surfaces, structurally identical, semantically scoped to different layers.

### Case invites

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `case_id` | uuid | FK -> `cases.id`, cascade |
| `email` | varchar (lowercased) | Indexed |
| `role` | varchar | `owner`, `editor`, or `viewer` (owner invites allowed) |
| `code` | varchar | Unique index, nanoid ~16 chars |
| `message` | text | nullable |
| `created_by_user_id` | uuid | FK -> `users.id` |
| `expires_at` | timestamptz | Now + 14 days |
| `used_at`, `used_by_user_id` | nullable | Set on successful accept |

### Org invites

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `organization_id` | uuid | FK -> `organizations.id`, cascade |
| `email` | varchar (lowercased) | Indexed |
| `role` | varchar | `admin`, `member`, or `guest` (admin invites allowed) |
| `code` | varchar | Unique index, nanoid ~16 chars |
| `message` | text | nullable |
| `created_by_user_id` | uuid | FK -> `users.id` |
| `expires_at` | timestamptz | Now + 14 days |
| `used_at`, `used_by_user_id` | nullable | Set on successful accept |

Invite creation also accepts an optional `name` for the invitee. It seeds the shell user's display name (or fixes a placeholder name on an unclaimed shell) so the future member does not show up as a raw email address.

### Shared invariants

1. **Single-use.** Once `used_at` is set, the code is dead. Re-visits to the welcome page show "already used."
2. **Email-bound.** The accept endpoint refuses if the Firebase user's email doesn't match the invite's email. Emails are normalized to lowercase at both write and read.
3. **Expiry is hard.** Expired invites cannot be accepted or extended. The inviter regenerates if needed.
4. **Top-tier invites are allowed.** Case invites can grant `owner` and org invites can grant `admin` (the DTOs accept the full role set). The last-owner / last-admin invariants above still guarantee the org or case is never left without a top-tier holder.
5. **Idempotent re-acceptance is disallowed.** If the signed-in user is already a member, the invite is not consumed; the welcome page redirects them with an "already a member" notice. Existing role wins.

### Case-invite isolation

A case invite creates ONLY a `case_members` row. It does NOT create an `organization_members` row in the case's host org. The invitee (e.g., an external lawyer) is sandboxed to the case they were invited to and sees nothing else of the host org. This is a hard invariant of the accept flow -- there is a regression test in `invites.service.spec.ts` asserting no `OrganizationMemberEntity` is created during case-invite accept.

### Flow (case invite)

1. **Owner creates invite** in case settings -> enters email, picks role, optional name and message -> server returns `{ code, url }`. Owner copies and sends.
2. **Invitee opens `/invite/<code>`** (public route). Welcome page renders inviter name, case name, role, message, and the gated email. "Sign in with Google" uses `login_hint = invite.email`.
3. **Firebase auth completes** -> frontend POSTs `/invites/<code>/accept` with the Firebase ID token.
4. **Server validates** invite exists, not used, not expired, `firebaseUser.email === invite.email`. Typed errors render the appropriate welcome-page message.
5. **On success:** create `case_members` row, mark invite used, redirect to `/cases/<caseId>`.

### Flow (org invite)

Same shape, different surface: welcome page at `/org-invite/<code>`, lookup returns org slug + name (not case), accept creates `organization_members`, redirect to `/orgs/<orgSlug>/settings`.

### Owner / admin management

In the case settings panel, owners see pending invites (email, role, created, expires, copy link, revoke). Used invites are not listed -- the resulting member appears in the members list instead. Same shape on the org settings page for org invites.
