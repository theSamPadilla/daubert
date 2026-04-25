# Auth, Access Control & Route Restructure

## Atomized Changes

| # | Change | What the user sees / can do | Key files |
|---|--------|-----------------------------|-----------|
| 1 | **Firebase client SDK init** | Nothing visible yet — wires up auth infrastructure | `frontend/src/lib/firebase.ts` |
| 2 | **Auth provider context** | App knows if user is logged in; unauthenticated users redirect to login | `AuthProvider.tsx` |
| 3 | **Login page** | User can sign in with Google OAuth. No signup — admin creates accounts via scripts. | `app/login/page.tsx` |
| 4 | **No-account rejection screen** | User who signs in without an account sees "No account found — contact your administrator" | `AuthProvider.tsx` or `app/login/page.tsx` |
| 5 | **User menu** | Logged-in user sees their name/avatar in header, can sign out | `UserMenu.tsx` |
| 6 | **API client sends auth token** | All API calls include the Firebase token — backend can verify identity | `api-client.ts` |
| 7 | **Backend Firebase Admin + auth guard** | Unauthenticated API calls rejected with 401; unknown users get 403 `NO_ACCOUNT`; /health stays open | `auth.module.ts`, `auth.guard.ts`, `firebase-admin.provider.ts` |
| 8 | **IsAdmin guard** | `@incite.ventures` users are admin. No endpoints use it yet — built for future use. | `admin.guard.ts` |
| 9 | **Email-match auto-link** | First login links pre-created user row to Firebase UID by email match | `users.service.ts`, `user.entity.ts` |
| 10 | **Admin scripts** | Admin creates users, cases, and manages membership via CLI scripts from repo root | `backend/scripts/create-user.ts`, `create-case.ts`, `add-to-case.ts`, etc. |
| 11 | **Case members data model** | Nothing visible yet — schema for who can access which case | `case-member.entity.ts`, `case.entity.ts` |
| 12 | **Case access guard** | Users can only see/edit cases they're a member of; others get 403 | `case-member.guard.ts`, `cases.service.ts`, `cases.controller.ts` |
| 15 | **Case selector home page** | After login, user sees a grid of their cases instead of jumping straight to a graph | `app/page.tsx`, `CaseSelector.tsx` |
| 16 | **Case workspace layout** | Selecting a case opens a workspace with sidebar nav (Investigations, Settings) | `app/cases/[caseId]/layout.tsx`, `CaseLayout.tsx` |
| 17 | **Graph workspace moves under case route** | Investigation graph is now at `/cases/:caseId/investigations?inv=<id>` — same UX, new URL | `app/cases/[caseId]/investigations/page.tsx`, `Sidebar.tsx` |
| 18 | **DB migration: schema expansion** | No user-facing change — adds firebaseUid column and case_members table, backfills ownership | Migration SQL |
| 19 | **DB migration: cleanup** | No user-facing change — drops legacy userId column from cases after auto-link confirmed | Migration SQL |

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
- `role` (enum: owner, guest)
- `createdAt`
- Unique constraint on `(userId, caseId)`

### Modified: `cases` table
- Remove `userId` column (single-owner model)
- Ownership expressed through `case_members` with `role: owner`

### Modified: `conversations` table
- Add `caseId` (FK -> cases, nullable initially, non-nullable after migration)
- Conversations become scoped to a case. `GET /conversations` returns only conversations for cases the user is a member of.
- `POST /conversations/:id/chat` no longer accepts ephemeral `caseId` in the request body — uses the conversation's stored `caseId` instead.

### Unchanged
- `investigations`, `traces`, `messages`, `script_runs` — all stay as-is, already scoped under cases via FKs

### Roles

**System-level admin:** Determined by email domain — any `@incite.ventures` user is admin. Implemented as an `IsAdmin` guard that checks the authenticated user's email. No DB flag needed. Admin actions at launch are CLI scripts only, but the guard is wired up from day one for future use (admin UI, restricted API endpoints, etc.).

**Case-level** (on the `case_members` table):

| Role | Create/edit investigations | View investigations | Delete case |
|------|---------------------------|-------------------- |-------------|
| owner | Yes | Yes | Yes |
| guest | No | Yes | No |

---

## Auth

### Firebase Auth (frontend)
- Google OAuth only (no email/password at launch — simplifies UX and avoids password management)
- Firebase SDK handles token refresh, session persistence
- Every API call includes `Authorization: Bearer <firebase-id-token>`

### Backend auth guard (NestJS)
- Global `AuthGuard` on all routes except `/health`
- Verifies Firebase ID token via `firebase-admin` SDK
- Extracts `firebaseUid`, looks up the `User` record
- If no user row exists for this `firebaseUid`, tries email-match auto-link (see below). If still no match, returns 403 `{ code: 'NO_ACCOUNT' }`.
- If user found, attaches `user` to the request object

### Admin guard
- `IsAdmin` guard layered on top of `AuthGuard`
- Resolves to true if the authenticated user's email ends with `@incite.ventures`
- No DB column — purely domain-based
- Not used by any endpoints at launch, but wired up and available for future admin routes

### Case access guard
- `CaseGuard` applied to all `/cases/:caseId/*` routes
- Checks `case_members` for the requesting user + case
- Rejects with 403 if not a member
- Optionally checks role for write operations
- **Conversations:** conversation endpoints (`/conversations/:id/*`) must also be case-scoped. On every conversation request, look up the conversation's `caseId` and verify the user is a member of that case. Having a valid auth token alone is not enough — prevents cross-case data access via guessed/leaked conversation IDs.

### Account creation (admin scripts only)
- **No open signup. No invite links. No self-service.**
- Admin runs `scripts:create-user -- --email "analyst@example.com" --name "Jane Doe"` — creates the user row in the DB (no Firebase UID yet)
- Admin runs `scripts:add-to-case -- --email "analyst@example.com" --case-id <uuid> --role analyst` — assigns the user to a case
- Admin tells the person to go sign in at the app URL
- Person signs in with Google → backend finds no user by `firebaseUid` → falls back to email match → links the existing row → user sees their cases

### Email-match auto-link
- On first login, if `firebaseUid` lookup fails, backend checks if the Firebase token's email matches an existing user row's email
- If match found: sets `firebaseUid` on that row and returns it. All subsequent logins use the `firebaseUid` directly.
- If no match: returns 403 `NO_ACCOUNT`. The user has no pre-created account.
- This is the **only** path for linking Firebase to DB accounts. It works for both the existing Sam Padilla migration and any future admin-created users.

### No-account experience
- A user who signs into Google successfully but has no Daubert account sees: "No account found for [email]. Contact your administrator to get access."
- The frontend catches the `NO_ACCOUNT` error code from the auth guard and renders this message — no redirect loop, no blank screen

---

## Route Structure

### Unauthenticated
```
/login          — Google OAuth sign-in (no signup — admin creates accounts)
```

### Authenticated
```
/                               — case selector (grid of cases the user belongs to)
/cases/:caseId/investigations   — list of investigations for this case
/cases/:caseId/investigations?inv=<id>  — graph workspace (current page.tsx logic)
/cases/:caseId/settings         — case settings (future — not in this phase)
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
RootLayout (layout.tsx) — wraps everything in AuthProvider
  ├── /login — skips auth check, full-page Google OAuth
  └── All other routes — AuthProvider redirects to /login if no session,
                          shows rejection message if NO_ACCOUNT,
                          renders children if valid account
       ├── / — case selector (read-only grid, no create button — admin creates cases)
       └── /cases/:caseId/ — case workspace
            ├── CaseLayout — sidebar nav (Investigations, future sections)
            └── /investigations — investigation list or graph workspace
```

---

## Frontend Changes

### New components
- `LoginPage` — Google OAuth sign-in, no-account rejection message
- `CaseSelector` — read-only grid/list of cases the user belongs to (no create button — admin-only)
- `CaseLayout` — sidebar with section nav (replaces current case-tree sidebar)
- `AuthProvider` — React context wrapping Firebase auth state + account verification
- `UserMenu` — dropdown in header (profile, sign out)

### Migration of current page.tsx
- The graph workspace logic (1,200+ lines) moves to `/cases/:caseId/investigations/page.tsx`
- The sidebar narrows to investigations + traces for the active case (no more case tree — case is already selected via URL)
- AI chat panel stays attached to the investigations page
- **Remove all case/investigation creation UI from the frontend:**
  - Strip "New case..." input and "+" button from `Sidebar.tsx`
  - Strip "Add investigation" button and inline creation form from `Sidebar.tsx`
  - Case creation is admin scripts only (`scripts:create-case`)
  - Investigation creation stays in the API but is gated by case role (owner only)

### Auth context
- `AuthProvider` is a React context provider component that wraps the app in root `layout.tsx`
- It manages Firebase auth state, calls `GET /auth/me` to verify the account exists, and exposes `{ user, loading, error, signOut }`
- `AuthenticatedLayout` in the layout tree is **not** a separate component — it's the behavior of `AuthProvider`: if no Firebase session, redirect to `/login`; if Firebase session but `NO_ACCOUNT` from `/auth/me`, render the rejection message in-place; if valid account, render children
- `/login` page lives outside the auth check (no `AuthProvider` redirect on that route)
- `api-client.ts` updated to include `Authorization` header from Firebase token

---

## Backend Changes

### New modules
- `AuthModule` — Firebase Admin SDK init, `AuthGuard`, `IsAdmin` guard, token verification, email-match auto-link

### Modified modules
- `UsersModule` — remove `SEED_USER` and `getDefaultUser()`, add `findByFirebaseUid()` (no auto-create)
- `CasesModule` — remove `userId` queries, add `CaseGuard`, scope all queries through `case_members`. Case creation removed from API (script-only).
- All modules that take `userId` from `getDefaultUser()` now take it from the authenticated request

### New API endpoints
```
GET    /auth/me                    — get current user from Firebase token (403 NO_ACCOUNT if not found)
```

### Admin scripts (no API — CLI only, following eidon-sym-api pattern)

Standalone ts-node scripts in `backend/scripts/`, run via `npm run scripts:<name>` **from the repo root** (root `package.json` proxies into backend). Each script connects directly to the database, supports `--dry-run`, and prints colored output.

```
npm run scripts:migrate-to-auth      # one-time migration (dry-run by default, --execute to run)
npm run scripts:create-user          -- --email "analyst@example.com" --name "Jane Doe"
npm run scripts:create-case          -- --name "Case Name" --owner-email "sam@incite.ventures"
npm run scripts:add-to-case          -- --email "analyst@example.com" --case-id <uuid> --role guest
npm run scripts:list-users           -- [--case-id <uuid>]
npm run scripts:remove-member        -- --email "user@example.com" --case-id <uuid>
npm run scripts:change-role          -- --email "user@example.com" --case-id <uuid> --role guest
```

Root `package.json` wires these through:
```json
"scripts:create-user": "npm run scripts:create-user --prefix backend",
"scripts:create-case": "npm run scripts:create-case --prefix backend",
...
```

### Migration (3 phases)

The migration preserves all existing data (cases, investigations, traces, conversations, etc.) and transitions the single hardcoded user to real Firebase auth. No data loss, no manual UID copying.

**Phase 1: Schema changes (TypeORM `synchronize: true` handles table/column creation in dev)**
- Add `firebaseUid` column to `users` table — **nullable** initially
- Add `caseId` column to `conversations` table — **nullable** initially
- Create `case_members` table (userId, caseId, role, createdAt)
- Keep `userId` on `cases` for now (will drop in phase 3)

TypeORM creates the schema automatically, but it does **not** backfill data. That's what the migration script does.

**Phase 2: Run `scripts:migrate-to-auth` (a standalone ts-node script, not a TypeORM migration)**

This is the critical script. It runs against the live database, supports `--dry-run`, and handles the entire data consolidation in a single transaction. Steps:

1. **Identify the Geffen case** — look up the case named "Geffen" by name (fail if not found)
2. **Identify Sam's user row** — look up the user by email `sam@incite.ventures` (or the existing email). Update it to `sam@incite.ventures` if needed.
3. **Backfill `case_members`** — for every case, insert a `case_members` row: `(userId=Sam, caseId, role='owner')`
4. **Move all investigations to Geffen** — `UPDATE investigations SET "caseId" = <geffen_id>` for any investigation not already in Geffen
5. **Scope all conversations to Geffen** — `UPDATE conversations SET "caseId" = <geffen_id>` (all existing conversations belong to the single working case)
6. **Delete empty cases** — any case that now has 0 investigations (everything was moved to Geffen) gets deleted. The Geffen case and its `case_members` row survive.
7. **Print summary** — how many investigations moved, conversations scoped, cases deleted, case_members created

```
npm run scripts:migrate-to-auth                  # dry-run by default
npm run scripts:migrate-to-auth -- --execute     # actually run it
```

At this point: all data lives under the Geffen case, Sam is the owner, conversations are scoped, and the app still works with the old code (new columns exist but nothing reads them yet).

**Phase 3: Deploy new code**
- Auth guard on all API routes — rejects unknown users with 403 `NO_ACCOUNT`
- First login by Sam: look up by `firebaseUid`, not found, fall back to email match on `sam@incite.ventures`, link the row
- New users created only via `scripts:create-user`, then sign in with Google to auto-link
- All API calls now go through AuthGuard + CaseGuard
- The old `getDefaultUser()` and `SEED_USER` are removed
- Cases scoped through `case_members` instead of `cases.userId`
- Conversations scoped through their `caseId` FK — `GET /conversations` filtered by user's case membership
- Case creation removed from API (admin scripts only)

**Phase 4: Cleanup (run after confirming auto-link worked)**
- Verify Sam's user row has a `firebaseUid` set (confirm auto-link succeeded)
- Make `firebaseUid` column non-nullable with a unique constraint
- Make `conversations.caseId` non-nullable
- Drop `userId` column from `cases` table
- Remove any remaining references to the old single-user model

**Rollback plan:** If anything goes wrong after phase 2, the old `userId` column on `cases` is still intact. Revert to the old code and everything works as before. The backup at `../misc/daubert-20260424-133327.dump` is the last resort.

---

## What This Doesn't Include (deferred)

- **Organizations** — no org table, no bulk team management, no billing. Cases are self-contained. Add orgs when billing matters.
- **Open signup** — deliberately omitted. All account creation is via admin scripts. Self-service signup may never ship — this is an investigation tool, not a SaaS product.
- **Self-service case creation** — only admins create cases. Users work within cases they're invited to.
- **Reports, documents** — routes reserved but not built.
- **Granular permissions** — two case-level roles at launch (owner/guest). Future: split guest into analyst (read-write) and viewer (read-only), add per-investigation or per-trace permissions.
- **Audit log** — who did what when. Useful for legal/compliance but not launch-critical.
- **Admin UI** — admin actions (create case, create user, manage membership) are scripts only at launch. Admin dashboard deferred.
