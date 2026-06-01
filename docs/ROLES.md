# Roles & Permissions

Daubert has two independent role namespaces:

| Layer | Property of | Roles | Source of truth |
|---|---|---|---|
| **Org role** | the user | `admin` > `member` > `guest` | `users.org_role` column |
| **Case role** | the (user, case) pair | `owner` > `editor` > `viewer` | `case_members.role` column |

They never collide because they answer different questions: "Can this user create new cases?" (org role) vs "Can this user mutate this specific case?" (case role).

## Org-level roles

| Role | Intent |
|---|---|
| `admin` | Platform operator. Can do everything `member` can, plus the `/admin/*` surface (manage users, cross-user case ops, etc.). Default for new `@incite.ventures` accounts. |
| `member` | Can create their own cases via `POST /cases` and the dashboard "+" tile. Default tier for trusted collaborators promoted by an admin. |
| `guest` | Cannot create cases. Can be invited into cases by an owner and act there per their case-level role. Default for all other new signups. |

### Hierarchy

Used by the `@RequireOrgRole(minRole)` guard:

```ts
const ORG_ROLE_HIERARCHY = { guest: 0, member: 1, admin: 2 };
```

A route declared `@RequireOrgRole('member')` admits both `member` and `admin`.

### Initial role assignment

User shells are created in two places:

1. `AdminUsersService.createWithOptionalMembership` (admin panel) — assigns `admin` if the email domain is `@incite.ventures`, otherwise `guest`.
2. `scripts/add-member.ts` (CLI) — assigns `member` explicitly, regardless of email domain.

Once a shell exists, admin status is read off the `users.org_role` column, NOT the email domain. `ADMIN_EMAIL_DOMAIN` is consulted ONLY during shell creation.

### Promotion

Today, `guest → member` happens via the CLI:

```bash
npm run scripts:add-member -- --email user@example.com
```

Behavior:
- Existing admin: no-op (admin > member; preserve).
- Existing member: no-op.
- Existing guest: promoted to member.
- No user: created as a member shell. They'll be linked to Firebase on first sign-in.

There is no in-app admin UI for org-role changes yet (out of scope).

## Case-level roles

Daubert cases are multi-member. Every membership has exactly one role. This document is the source of truth for what each role can do and how the backend enforces it.

### Roles

| Role | Intent |
|------|--------|
| `owner` | Governs the case: members, settings, deletion. Also does all editor work. |
| `editor` | Trusted collaborator: does the investigative work but cannot govern the case. |
| `viewer` | Read-only access. Can use the AI in a read-only mode. Cannot see other members. |

Role hierarchy (used by the access guard): `owner > editor > viewer`. A route that requires `editor` is satisfied by owner or editor; a route that requires `viewer` is satisfied by any member.

## Capability matrix

| Capability | Owner | Editor | Viewer |
|---|:---:|:---:|:---:|
| View case, investigations, traces, data room, productions | yes | yes | yes |
| AI chat — full tools (read + write) | yes | yes | no |
| AI chat — read-only tools | yes | yes | yes |
| See member list | yes | yes | no |
| Create / edit / delete investigations | yes | yes | no |
| Create / edit / delete traces | yes | yes | no |
| Manage data room (upload, link, delete) | yes | yes | no |
| Manage productions | yes | yes | no |
| Edit case fields (name, dates, links) | yes | no | no |
| Add / remove members, change member roles | yes | no | no |
| Generate / revoke invite links | yes | no | no |
| Delete case | yes | no | no |
| Leave the case (self-remove) | yes (unless last owner) | yes | yes |

## Invariants

1. **A case always has at least one owner.** The system refuses any operation that would leave the case with zero owners — including the last owner downgrading themselves to editor/viewer, removing themselves, or being removed by another owner. The error is explicit: "transfer ownership before leaving."
2. **A user has at most one membership per case.** Enforced by the `(user_id, case_id)` unique constraint on `case_members`.
3. **Viewers never see member data.** Backend handlers strip the `members` field from responses when the requester's role is `viewer`. The AI chat surface gets the same treatment — no member-listing tool is exposed to a viewer's tool registry.
4. **AI tool exposure is gated at the registry, not the tool.** When the AI endpoint builds the tool set for a request, it reads the caller's role and includes only tools that role can use. Each tool's handler also re-checks the caller's role as defense in depth, but the registry filter is the primary boundary.

## Backend enforcement

A single guard, `@RequireRole(minRole)`, replaces the old `CaseMemberGuard`. It reads `:caseId` from the route, looks up the requesting user's `CaseMemberEntity`, and:

- 403s if there is no membership row;
- 403s if the membership's role is below `minRole` in the hierarchy;
- attaches the membership to `req.caseMembership` so handlers can branch on role when shaping responses.

```ts
@RequireRole('owner')   // owner only
@RequireRole('editor')  // owner or editor
@RequireRole('viewer')  // any member (replaces old CaseMemberGuard semantics)
```

Script-token requests (`AccessPrincipal` of kind `'script'`) never have `req.user`, so they bypass this guard entirely and use `CaseAccessService.assertAccess(principal, caseId)` at the service layer. Scripts have no role — they have a token scoped to a single case.

### Route audit (target state)

| Method + path | Required role |
|---|---|
| `GET /cases` | (auth only — lists the caller's memberships) |
| `GET /cases/:caseId` | `viewer` |
| `PATCH /cases/:caseId` | `owner` |
| `DELETE /cases/:caseId` | `owner` |
| `GET /cases/:caseId/members` | `editor` (viewers blocked) |
| `POST /cases/:caseId/members` (invite-link accept) | (token-gated, not role-gated) |
| `PATCH /cases/:caseId/members/:userId` | `owner` |
| `DELETE /cases/:caseId/members/:userId` | `owner` (admin-style removal of another member) |
| `POST /cases/:caseId/members/me/leave` | any member (self-remove); refused if caller is the last owner |
| `POST /cases/:caseId/invites` (generate link) | `owner` |
| `DELETE /cases/:caseId/invites/:inviteId` | `owner` |
| Investigation / trace / data-room / production mutations | `editor` |
| Investigation / trace / data-room / production reads | `viewer` |
| AI chat | `viewer` minimum; tool set is filtered by role inside the handler |

The admin module's `/admin/cases/*` endpoints (gated by `IsAdminGuard` via email domain) remain as an admin override for cross-user case operations. They are not part of the role system; they exist to let admins act on cases they are not members of.

## Frontend implications

The viewer's role for the current case is exposed through `useCaseContext()` (added alongside this work). UI surfaces that mutate must check role before rendering action chrome:

- Owner-only chrome: case settings (name/dates/links editor), member management, invite-link generator, delete case.
- Editor-or-higher chrome: every "new" / "edit" / "delete" button on investigations, traces, data-room, productions.
- Viewer chrome: read-only views only. No member list. AI chat input remains, but the system prompt and tool registry sent from the backend reflect the read-only constraint.

The role badge already shown on the case-grid card (`/`) stays as-is.

## Data model

`case_members.role` is a string column with three valid values: `owner`, `editor`, `viewer`. Default is `viewer` (was `guest`). Rename and default change land in a single migration:

1. Rename existing `'guest'` rows to `'viewer'`.
2. Change column default to `'viewer'`.
3. No enum type change is needed (the column is `varchar`); the new value `'editor'` is accepted immediately by existing rows that adopt it later.

Generated through `./migrations.sh --dev --generate RenameGuestToViewer`, applied to prod via `./migrations.sh --prod --run` by the user.

## Invitations

Owners add members through email-gated invite links. There is no email delivery — the owner copies the link and sends it out-of-band (Slack, email, whatever they use). The link is single-use, expires in 14 days, and only the recipient's exact email address can accept.

### Invite shape

| Field | Required | Notes |
|---|---|---|
| `caseId` | yes | The case being joined. |
| `role` | yes | `editor` or `viewer`. Owners cannot be added by invite — promotion to owner is an explicit owner action after the user is a member. |
| `email` | yes | Gates sign-in. Only this email can accept. |
| `message` | no | Free text shown to the invitee on the welcome page. |
| `code` | yes | URL-safe, unguessable (nanoid, ~16 chars). Indexed unique. |
| `expiresAt` | yes | Now + 14 days. |
| `createdByUserId` | yes | Used to show "X invited you" on the welcome page. |
| `usedAt`, `usedByUserId` | nullable | Set on successful accept. |

The invitee's name is **not** stored on the invite — it is derived from the Firebase user profile after sign-in.

### Invariants

1. **Single-use.** Once `usedAt` is set, the code is dead. Subsequent visits to `/invite/<code>` show "this invite has already been used" and offer a link to the case if the viewer's signed-in email matches `usedByUserId`'s email.
2. **Email-bound.** The accept endpoint refuses if `firebaseUser.email !== invite.email`, regardless of case-insensitive match — emails are normalized to lowercase at both write (invite creation) and read (Firebase token) time.
3. **Expiry is hard.** Expired invites cannot be accepted and cannot be extended. Owner regenerates if needed.
4. **No owner invites.** `role` is restricted to `editor` or `viewer` at the DTO layer. Promoting an existing member to owner happens via the members panel.
5. **Idempotent re-acceptance is disallowed.** If the signed-in user is already a member of the case, the invite is not consumed; the welcome page redirects them to the case with a "you're already a member" notice. Existing role wins — invites never change an existing member's role.

### Flow

1. **Owner creates invite** in case settings → enters email, picks role, optional message → server returns `{ code, url }`. Owner copies and sends.
2. **Invitee opens `/invite/<code>`** (public route, no auth required). Welcome page renders inviter name, case name, role, message, and the gated email. "Sign in with Google" button uses `loginHint=invite.email` to pre-select the right account.
3. **Firebase auth completes** → frontend posts to `POST /invites/<code>/accept` with the Firebase ID token.
4. **Server validates:** invite exists, not used, not expired, `firebaseUser.email === invite.email`. If any check fails, return a typed error and the welcome page renders the appropriate message ("expired", "already used", "wrong account", etc.).
5. **On success:** create `case_members` row, set `invite.usedAt` + `usedByUserId` in the same transaction, redirect to `/cases/<caseId>`.

### Owner-side management

In the case settings panel, owners see:
- Pending invites (email, role, created date, expires date, "copy link", "revoke")
- Used invites are not listed — the resulting member appears in the members list instead.
- Revoke deletes the row outright (no soft-delete; the code becomes invalid).

### Routes

| Method + path | Auth | Notes |
|---|---|---|
| `POST /cases/:caseId/invites` | `@RequireRole('owner')` | Body: `{ email, role, message? }`. Returns `{ code, url, expiresAt }`. |
| `GET /cases/:caseId/invites` | `@RequireRole('owner')` | Lists pending (unused, unexpired) invites for the case. |
| `DELETE /cases/:caseId/invites/:inviteId` | `@RequireRole('owner')` | Revoke. |
| `GET /invites/:code` | public | Returns inviter name, case name, role, message, email, status (`pending` / `used` / `expired` / `revoked`). No `caseId` leaked until accept succeeds. |
| `POST /invites/:code/accept` | Firebase token in header | Server-side email match check. Creates membership + marks invite used in one transaction. |

### Data model

New table `case_invites`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `case_id` | uuid | FK → `cases.id`, cascade delete |
| `email` | varchar (lowercased) | Indexed |
| `role` | varchar | `'editor'` or `'viewer'` — never `'owner'` |
| `code` | varchar | Unique index |
| `message` | text | nullable |
| `created_by_user_id` | uuid | FK → `users.id` |
| `expires_at` | timestamptz | |
| `used_at` | timestamptz | nullable |
| `used_by_user_id` | uuid | nullable, FK → `users.id` |
| `created_at`, `updated_at` | timestamptz | from `BaseEntity` |

No partial unique index on `(case_id, email)` — owners may legitimately need to regenerate after a typo or a lost link. Stale invites for the same email are harmless because of the single-use + expiry guarantees.
