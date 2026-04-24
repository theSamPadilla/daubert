# Auth, Access Control & Route Restructure

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/auth/auth.module.ts` | Create | Firebase Admin SDK init, exports AuthGuard |
| 2 | `backend/src/modules/auth/auth.guard.ts` | Create | Global guard: verify Firebase ID token, attach user to request |
| 3 | `backend/src/modules/auth/firebase-admin.provider.ts` | Create | Initialize firebase-admin with service account config |
| 4 | `backend/src/modules/case-members/case-members.module.ts` | Create | Module for case membership CRUD |
| 5 | `backend/src/modules/case-members/case-members.service.ts` | Create | Invite, list, update role, remove members |
| 6 | `backend/src/modules/case-members/case-members.controller.ts` | Create | REST endpoints for /cases/:id/members |
| 7 | `backend/src/modules/case-members/case-member.guard.ts` | Create | Per-route guard: check case membership + role |
| 8 | `backend/src/database/entities/case-member.entity.ts` | Create | CaseMember entity (userId, caseId, role) |
| 9 | `backend/src/database/entities/user.entity.ts` | Modify | Add firebaseUid column, remove seed logic dependency |
| 10 | `backend/src/database/entities/case.entity.ts` | Modify | Drop userId column, add members relation |
| 11 | `backend/src/modules/users/users.service.ts` | Modify | Remove SEED_USER/getDefaultUser, add findByFirebaseUid/findOrCreate |
| 12 | `backend/src/modules/users/users.controller.ts` | Modify | /users/me reads from auth context instead of returning hardcoded user |
| 13 | `backend/src/modules/cases/cases.service.ts` | Modify | Scope queries through case_members, remove userId filter |
| 14 | `backend/src/modules/cases/cases.controller.ts` | Modify | Apply CaseGuard, create auto-adds owner membership |
| 15 | `backend/src/app.module.ts` | Modify | Register AuthModule, CaseMembersModule; apply global AuthGuard |
| 16 | `backend/src/main.ts` | Modify | Keep /health exempt from auth |
| 17 | `frontend/src/app/login/page.tsx` | Create | Login page (email/password + Google OAuth) |
| 18 | `frontend/src/app/signup/page.tsx` | Create | Registration page |
| 19 | `frontend/src/app/invite/[token]/page.tsx` | Create | Accept case invitation |
| 20 | `frontend/src/app/page.tsx` | Modify | Becomes case selector (grid of user's cases) |
| 21 | `frontend/src/app/cases/[caseId]/layout.tsx` | Create | Case workspace layout with sidebar nav |
| 22 | `frontend/src/app/cases/[caseId]/investigations/page.tsx` | Create | Graph workspace (current page.tsx logic moves here) |
| 23 | `frontend/src/app/cases/[caseId]/settings/page.tsx` | Create | Case settings, member management |
| 24 | `frontend/src/components/AuthProvider.tsx` | Create | React context wrapping Firebase auth state |
| 25 | `frontend/src/components/CaseSelector.tsx` | Create | Grid/list of cases with create button |
| 26 | `frontend/src/components/CaseLayout.tsx` | Create | Sidebar nav for case workspace sections |
| 27 | `frontend/src/components/MemberManager.tsx` | Create | Invite by email, list/edit/remove members |
| 28 | `frontend/src/components/UserMenu.tsx` | Create | Header dropdown (profile, sign out) |
| 29 | `frontend/src/components/Sidebar.tsx` | Modify | Remove case tree (case selected via URL), keep investigation/trace list |
| 30 | `frontend/src/lib/api-client.ts` | Modify | Add Authorization header from Firebase token, add member endpoints |
| 31 | `frontend/src/lib/firebase.ts` | Create | Firebase client SDK init |

## Overview

Replace the hardcoded single-user setup with Firebase Auth, case-level access control, and a multi-page route structure. No organizations at launch — cases are the collaboration boundary. Orgs layer on later for billing/seat management.

---

## Data Model Changes

### New: `users` table (replaces current seed-only user)
- `id` (UUID, PK)
- `firebaseUid` (string, unique) — links to Firebase Auth
- `name`, `email`, `avatarUrl`
- `createdAt`, `updatedAt`

### New: `case_members` join table
- `id` (UUID, PK)
- `userId` (FK -> users)
- `caseId` (FK -> cases)
- `role` (enum: `owner`, `analyst`, `viewer`)
- `createdAt`
- Unique constraint on `(userId, caseId)`

### Modified: `cases` table
- Remove `userId` column (single-owner model)
- Ownership expressed through `case_members` with `role: owner`

### Unchanged
- `investigations`, `traces`, `conversations`, `messages`, `script_runs` — all stay as-is, still scoped under cases

### Roles

| Role | Create/edit investigations | View investigations | Manage members | Delete case |
|------|---------------------------|-------------------- |----------------|-------------|
| owner | Yes | Yes | Yes | Yes |
| analyst | Yes | Yes | No | No |
| viewer | No | Yes | No | No |

---

## Auth

### Firebase Auth (frontend)
- Email/password sign-up and login
- Google OAuth as secondary provider
- Firebase SDK handles token refresh, session persistence
- Every API call includes `Authorization: Bearer <firebase-id-token>`

### Backend auth guard (NestJS)
- Global `AuthGuard` on all routes except `/health` and `/auth/...`
- Verifies Firebase ID token via `firebase-admin` SDK
- Extracts `firebaseUid`, looks up (or auto-creates) the `User` record
- Attaches `user` to the request object

### Case access guard
- `CaseGuard` applied to all `/cases/:caseId/*` routes
- Checks `case_members` for the requesting user + case
- Rejects with 403 if not a member
- Optionally checks role for write operations

### Auto-provisioning
- First login auto-creates the `users` row from Firebase profile (name, email)
- No invite-only gate at launch — anyone can sign up and create cases
- Being invited to a case (by email) creates a pending invite; accepted on login/signup

---

## Route Structure

### Unauthenticated
```
/login          — email/password + Google OAuth
/signup         — registration
/invite/:token  — accept a case invitation
```

### Authenticated
```
/                               — case selector (grid of cases the user belongs to)
/cases/:caseId/investigations   — list of investigations for this case
/cases/:caseId/investigations?inv=<id>  — graph workspace (current page.tsx logic)
/cases/:caseId/settings         — case settings, member management, invites
```

### Future (not in this phase)
```
/cases/:caseId/reports          — report drafting and export
/cases/:caseId/documents        — uploaded documents, references
/settings                       — user profile, account settings
/admin                          — org management, billing (when orgs ship)
```

### Layout structure
```
RootLayout (layout.tsx)
  ├── /login, /signup — no shell, full-page auth forms
  └── AuthenticatedLayout (checks Firebase session)
       ├── / — case selector, minimal header with user menu
       └── /cases/:caseId/ — case workspace
            ├── CaseLayout — sidebar nav (Investigations, Settings, future sections)
            ├── /investigations — investigation list or graph workspace
            └── /settings — member management
```

---

## Frontend Changes

### New components
- `LoginPage`, `SignupPage` — Firebase Auth UI
- `CaseSelector` — grid/list of cases, create new case button
- `CaseLayout` — sidebar with section nav (replaces current case-tree sidebar)
- `MemberManager` — invite by email, list members, change roles, remove
- `AuthProvider` — React context wrapping Firebase auth state
- `UserMenu` — dropdown in header (profile, sign out)

### Migration of current page.tsx
- The graph workspace logic (1,200+ lines) moves to `/cases/:caseId/investigations/page.tsx`
- The sidebar narrows to investigations + traces for the active case (no more case tree — case is already selected via URL)
- AI chat panel stays attached to the investigations page

### Auth context
- `AuthProvider` wraps the app, exposes `user`, `loading`, `signOut`
- `api-client.ts` updated to include `Authorization` header from Firebase token
- Unauthenticated users redirected to `/login`

---

## Backend Changes

### New modules
- `AuthModule` — Firebase Admin SDK init, `AuthGuard`, token verification
- `CaseMembersModule` — CRUD for case membership, invite flow

### Modified modules
- `UsersModule` — remove `SEED_USER` and `getDefaultUser()`, add `findByFirebaseUid()` and `findOrCreate()`
- `CasesModule` — remove `userId` queries, add `CaseGuard`, scope all queries through `case_members`
- All modules that take `userId` from `getDefaultUser()` now take it from the authenticated request

### New endpoints
```
POST   /auth/me                    — get or create user from Firebase token
POST   /cases/:id/members          — invite user (owner only)
GET    /cases/:id/members          — list members
PATCH  /cases/:id/members/:userId  — change role (owner only)
DELETE /cases/:id/members/:userId  — remove member (owner only)
```

### Migration
- Existing data: the hardcoded Sam Padilla user becomes a real user linked to a Firebase account
- Existing cases get a `case_members` row with `role: owner` for that user
- `userId` column on `cases` dropped after migration

---

## What This Doesn't Include (deferred)

- **Organizations** — no org table, no bulk team management, no billing. Cases are self-contained. Add orgs when billing matters.
- **Reports, documents** — routes reserved but not built
- **Granular permissions** — three roles (owner/analyst/viewer) cover launch. Fine-grained permissions (per-investigation, per-trace) can come later.
- **Audit log** — who did what when. Useful for legal/compliance but not launch-critical.
