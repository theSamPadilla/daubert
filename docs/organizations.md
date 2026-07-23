# Organizations

Daubert is multi-tenant. Every case lives inside exactly one **organization**, and a user's reach through the app is determined by their org-level and case-level roles. This doc walks through the org model end-to-end: entities, roles, the rules that connect them, and the invite/access flows.

> Related docs:
> - Entity tables and columns — [`data-model.md`](./data-model.md)
> - Role matrix and per-route gates — [`ROLES.md`](./ROLES.md)
> - Module map and HTTP endpoints — [`architecture.md`](./architecture.md)

## Mental model

```
User ──┐                    ┌── Organization (slug, deletedAt) ──┐
       │                    │                                   │
       └─ OrganizationMember┘                                   │
          (admin / member / guest)                              │
                                                                │
                                                       Case (orgId) ──┐
                                                                      │
User ──┐                                                              │
       └─ CaseMember ◄────────────────────────────────────────────────┘
          (owner / editor / viewer)
```

Two memberships, two role scales, one rule that binds them: **every case belongs to an org, but case members don't have to be org members**. Org admins, on the other hand, automatically reach every case in their org.

## Entities

| Entity | Purpose |
|--------|---------|
| `organizations` | The tenant. Owns cases. Soft-deletable via `deleted_at`. |
| `organization_members` | (user, org) join with role ∈ {`admin`, `member`, `guest`}. |
| `organization_invites` | Pending org invitations (email + code + role). |
| `cases` | Required `organization_id` FK + `summary` + legacy `user_id`. |
| `case_members` | (user, case) join with role ∈ {`owner`, `editor`, `viewer`}. |
| `case_invites` | Pending case invitations (email + code + role). |

See `data-model.md` for column-level detail.

## Roles

### Organization roles

| Role | What it means |
|------|---------------|
| `admin` | Full org control — settings, members, invites. **Implicit owner access to every case in the org**, including cases they were never explicitly added to. |
| `member` | Active org member — can create cases inside the org and be invited to cases. |
| `guest` | Reserved for org-level invites that don't carry case-level access. Cannot create cases. |

### Case roles

| Role | What it means |
|------|---------------|
| `owner` | Full case control — settings, members, invites, deletion. |
| `editor` | Read + write everything inside the case (graph, productions, conversations). Cannot manage membership or delete the case. |
| `viewer` | Read-only across the case. Cannot mutate. |

Org admins resolve to a synthetic `owner` membership for any case in their org without an explicit row in `case_members` (see `CaseAccessService.tryOrgAdminImplicit`).

## Invariants enforced in code

These are not stylistic preferences — they're guard rails enforced by services and tests.

1. **Every case belongs to exactly one org.** `case.organization_id` is `NOT NULL`.
2. **Only org members or higher can create a case.** Guests get `403` from `createWithOwner`. Non-members get `403`. (`cases.service.ts`)
3. **Case creation atomically adds the creator as `owner`.** One transaction creates the case and the `case_members` row. (`cases.service.ts`)
4. **Org admins have implicit case access.** Read paths (`findAllForUser`, `assertAccess`, `assertRole`) layer an "org admin → synthetic owner" fallback on top of explicit `case_members` rows. Implicit access requires the org to be active — soft-deleted orgs do not grant it.
5. **Case invite acceptance does not create an org membership.** A user can be a case member without ever joining the host org. (Regression test: `invites.service.spec.ts` — "case invite accept does NOT create an organization_members row".)
6. **The last admin cannot be demoted, removed, or leave.** `assertNotLastAdminOperation` runs inside a pessimistic-locked transaction so concurrent demote/remove operations cannot both succeed.
7. **Slugs are globally unique, including across trashed orgs.** Renaming an org checks soft-deleted rows too because the DB unique index does not filter by `deleted_at`.
8. **Cross-case access via script tokens is rejected.** A signed script token carries one `caseId` and one role; `assertAccess` rejects any request whose resource lives in a different case. See [`exec-environment.md`](./exec-environment.md).

## Auth surface

| Decorator | Guard | Reads from | Used on |
|-----------|-------|-----------|---------|
| `@RequireSuperAdmin()` | `SuperAdminGuard` | `req.user.isSuperAdmin` | `/superadmin/*` |
| `@RequireOrgRole(role)` | `OrgRoleGuard` | `req.user` + org membership at `:org` param | `/orgs/:org/*` |
| `@RequireRole(role)` | `RoleGuard` | `req.user` + case membership at `:caseId` param | `/cases/:caseId/*` and everything beneath a case |

Scripts always carry `req.principal = { kind: 'script', caseId, role }` and **no `req.user`** — every guard above therefore rejects them. The script-callable surface is service-layer endpoints that call `CaseAccessService.assertAccess` / `assertRole` directly with the principal. See [`exec-environment.md`](./exec-environment.md) for the full sandbox story.

## Lifecycles

### Creating an organization

Today, orgs are created by superadmins via `POST /superadmin/orgs`. There is no self-serve org signup; the platform is invite-driven.

### Joining an organization

```
Admin                       Invitee
  │                            │
  ├─ POST /orgs/:org/invites  ─►  (email, role, optional message)
  │                            │
  │      ┌─ link with code ───►│
  │      │                     │
  │      │                     ├─ GET /org-invites/:code  (preview, @Public)
  │      │                     │
  │      │                     ├─ sign in with the invited email
  │      │                     │
  │      │                     └─ POST /org-invites/:code/accept
  │                                    │
  │                                    ├─ transaction: create OrganizationMember
  │                                    │              + mark invite usedAt/usedByUserId
  │                                    │
  │      ◄── { orgSlug, alreadyMember } ──┘
```

Rules:
- Invite email must match the Firebase email of the accepter (`ForbiddenException` otherwise).
- Soft-deleted orgs reject acceptance (`GoneException`).
- Re-accepting an already-used invite throws `GoneException`.
- If the user is already a member, accept short-circuits with `alreadyMember: true` and the invite is left unused.

### Creating a case

`POST /cases` with `{ name, orgId, summary? }`. The service verifies the caller is an active member of `orgId` and not a `guest`, then creates the case + the `owner` case_members row in one transaction.

### Joining a case

Case invites mirror org invites — same email + code + role flow, but produce only a `case_members` row. They never auto-create an org membership. A user can therefore be a case viewer in an org they otherwise have no relationship to.

```
Owner                        Invitee
  │                             │
  ├─ POST /cases/:caseId/invites ─► (email, role ∈ {editor, viewer}, message)
  │                             │
  │      ┌─ link with code ────►│
  │      │                      │
  │      │                      ├─ GET /invites/:code (preview, @Public)
  │      │                      │
  │      │                      ├─ sign in with the invited email
  │      │                      │
  │      │                      └─ POST /invites/:code/accept
  │                                     │
  │      ◄── { caseId, alreadyMember } ─┘
```

Case invites cannot grant `owner` — only `editor` or `viewer` (see `CaseInviteEntity.role`).

### Removing access

| Action | Constraint |
|--------|------------|
| Remove an org member | Cannot remove the last admin. |
| Demote an org admin | Cannot demote the last admin. |
| Leave an org as the last admin | Blocked — promote someone else first. |
| Remove yourself from a case | `POST /cases/:caseId/members/me/leave`. No last-owner check today; future work. |
| Delete a case | Cascades through investigations, traces, productions, case_members, case_invites, and the data room connection. |
| Soft-delete an org (superadmin) | Marks `deletedAt`. Strips implicit case access and rejects new joins. Restorable via `POST /superadmin/orgs/:id/restore`. Hard delete is `POST /superadmin/orgs/:id/purge`. |

## The org workspace

Beyond membership and settings, the org is a working surface: assets shared by every case in the organization live at `/orgs/[orgSlug]/*` in a tabbed workspace.

| Tab | Who | What lives there |
|-----|-----|------------------|
| Declarations | member+ | **Declarants** (reusable expert profiles with credentials and qualifications paragraphs, optionally linked to a member account, creatable by manual entry or Sonnet extraction from an uploaded CV / prior declaration) and the **declaration library** (reusable boilerplate blocks any case can insert into a declaration). |
| Files | member+ | Index of all org-level files. Today that is declarant source files (CVs, prior declarations) stored via the `StorageProvider` at `org/<orgId>/<fileId>`. |
| Cases | admin | Admin view across the org's cases. |
| Settings | member+ (admin to mutate) | Org profile, members, invites. |

Entry points: the org name in the global header links straight to the workspace (the chevron beside it opens the org switcher), the home page shows an org strip above the cases grid with quick links, and each row in the switcher dropdown carries an open-workspace button. The workspace lands on the Declarations tab; `/orgs/[orgSlug]` redirects there.

See [`declarations.md`](./declarations.md) for the full declarants / library / formats story.

## Reading list

- New to the codebase? Start with [`architecture.md`](./architecture.md) for the module map, then this doc.
- Want the column-level entity reference? [`data-model.md`](./data-model.md).
- Want the per-route capability matrix? [`ROLES.md`](./ROLES.md).
- Want to understand how scripts respect this auth model? [`exec-environment.md`](./exec-environment.md).
