# Org-Level Roles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a three-tier org-level role on `UserEntity` (`admin` / `member` / `guest`), open self-serve case creation to members and admins through a "+" tile + modal on the cases dashboard, and ship a CLI script to promote any user to `member`.

**Architecture:** Org role is a new column on `users`, defaulting to `guest`. A new `@RequireOrgRole(minRole)` decorator + `OrgRoleGuard` replaces the old `IsAdminGuard` (which today reads the `@incite.ventures` email domain at request time). On user creation the email-domain check is preserved but moved to a single place — the Firebase user-creation path inside `AuthGuard` — so any new `@incite.ventures` signup is provisioned as `admin` and everyone else as `guest`. The existing case-level role system (`owner`/`editor`/`viewer` on `case_members`) is untouched.

**Tech Stack:** NestJS 10 + TypeORM + Postgres (backend), Next.js 14 App Router + Tailwind (frontend), Firebase Auth, OpenAPI 3 contracts.

**Spec context.** `docs/ROLES.md` documents the case-level role system. This plan introduces a parallel org-level system; see the "Conceptual model" note in this plan for how the two layer (different namespaces — org role describes the *user*, case role describes the *(user, case)* pair). Update `docs/ROLES.md` at the end with an Org Roles section.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|---|---|---|
| 1 | `backend/src/database/entities/user.entity.ts` | Modify | Adds `orgRole: 'admin' \| 'member' \| 'guest'` column, default `guest` |
| 2 | `backend/src/database/migrations/<ts>-AddUserOrgRole.ts` | Create | Adds column + backfills existing `@incite.ventures` users to `admin`, everyone else to `guest` |
| 3 | `backend/src/modules/admin/users/admin-users.service.ts` | Modify | `createWithOptionalMembership` computes `orgRole` from email domain (incite → admin, else guest) at shell-creation time. **`auth.guard.ts` is NOT modified** — it does not create users, only links existing shells to Firebase UIDs. |
| 4 | `backend/src/modules/users/users.service.ts` | Modify | New helper `setOrgRole(userId, role)` for the CLI script (widening `create()` is unnecessary — script writes via raw SQL through `db-connect`) |
| 5 | `backend/src/modules/auth/require-org-role.decorator.ts` | Create | `@RequireOrgRole(minRole)` + `ORG_ROLE_HIERARCHY` |
| 6 | `backend/src/modules/auth/org-role.guard.ts` | Create | Checks `req.user.orgRole` against the route's declared minimum |
| 7 | `backend/src/modules/auth/auth.module.ts` | Modify | Wire up new guard, drop `IsAdminGuard` export |
| 8 | `backend/src/modules/auth/admin.guard.ts` | Delete | Replaced by `OrgRoleGuard` + `@RequireOrgRole('admin')` |
| 9 | `backend/src/modules/auth/admin.constants.ts` | Modify | Constant kept; comment updated to clarify it only governs initial role assignment on user creation |
| 10 | `backend/src/modules/admin/admin.module.ts`, `admin/cases/admin-cases.controller.ts`, `admin/users/admin-users.controller.ts`, `admin/labeled-entities/...` | Modify | Replace `@UseGuards(IsAdminGuard)` with `@RequireOrgRole('admin')` everywhere |
| 11 | `backend/src/modules/cases/cases.controller.ts` | Modify | New `POST /cases` endpoint, `@RequireOrgRole('member')`, creates case with caller as owner. Reuses the **existing** `CreateCaseDto` at `cases/dto/create-case.dto.ts` and the **existing** `createWithOwner` service method. |
| 13 | `backend/src/modules/auth/auth.controller.ts` | Modify | `/auth/me` response now includes `orgRole` (it already returns `req.user`, so this is automatic once the column is on the entity) |
| 14 | `backend/scripts/add-member.ts` | Create | CLI: upserts a user as `member`. Existing user gets promoted (preserving `admin` if already higher). New user is created. |
| 15 | `backend/package.json` | Modify | Adds `scripts:add-member` script entry |
| 16 | `package.json` (root) | Modify | Adds `scripts:add-member` runner that delegates to backend |
| 17 | `contracts/schemas/admin.yaml` | Modify | Adds `OrgRole` enum, adds `orgRole` field to `AdminUser`. **There is no `users.yaml`** — the only User-shaped contract schema is `AdminUser`. The `/auth/me` response uses a hand-typed `User` interface in `api-client.ts` (not generated from OpenAPI) — widen that one too. |
| 18 | `contracts/paths/cases.yaml` | Verify only | The `POST /cases` operation **already exists** at lines 1–26 with operationId `createCase`. `CreateCaseRequest` already exists in `contracts/schemas/cases.yaml:51`. Confirm both, no edits expected. |
| 19 | `contracts/openapi.yaml` | Verify only | The `/cases` path is already registered. Confirm no edits needed. |
| 20 | `frontend/src/components/Auth/AuthProvider.tsx` | Modify | `DaubertUser` type widened with `orgRole`; exposed via `useAuth()` |
| 21 | `frontend/src/lib/api-client.ts` | Modify | Add `createCase(dto)` method; widen `User`/auth shapes to include `orgRole` |
| 22 | `frontend/src/components/Cases/NewCaseModal.tsx` | Create | "Create a new case" modal — name (required), start date (optional), links (repeating, optional) |
| 23 | `frontend/src/app/page.tsx` | Modify | Big "+" tile rendered as the first card on the grid for `orgRole === 'admin' \| 'member'`. Clicking opens `NewCaseModal`. Submit creates the case + navigates to it. |
| 24 | `frontend/src/lib/admin.ts` | Delete | Frontend `ADMIN_EMAIL_DOMAIN` constant no longer needed — gating uses `useAuth().user.orgRole === 'admin'` |
| 25 | `frontend/src/components/Auth/AdminGuard.tsx` | Modify | Replace email-domain check with `orgRole === 'admin'` |
| 26 | `frontend/src/components/Auth/UserMenu.tsx` | Modify | Replace email-domain check at line 14 (`isAdmin`) with `useAuth().user?.orgRole === 'admin'` |
| 27 | `frontend/src/app/admin/layout.tsx` | Modify | Same — gate on `orgRole`, not email domain |
| 28 | `docs/ROLES.md` | Modify | Add a top-level "Org-level roles" section; replace the existing line "Case creation is out of scope for this role system and remains admin-only for now" since this plan supersedes it. |

### What changes (UX and DX)

**For the user (UX):**
- Any signed-in `member` or `admin` sees a big "+ New case" tile at the top of their cases dashboard, opens a modal, fills in the case name, and lands in the new case.
- Guests see the same dashboard but no "+" tile — they can still open cases they've been invited to.
- Admins can promote a guest to `member` from the CLI in one line (e.g., `npm run scripts:add-member -- foo@bar.com`).
- The admin email-domain check is gone from the runtime path; admin status is now data, not derived from the auth token.

**For the developer (DX):**
- One decorator pattern for both layers: `@RequireOrgRole(minRole)` for org-wide endpoints, `@RequireRole(minRole)` for case-scoped ones. Same mental model; different namespaces.
- The "who is an admin?" question is now answered by a single DB query (`users.org_role = 'admin'`), not by parsing email strings at every guarded route.
- The CLI script gives ops a clean way to onboard members without writing SQL.

---

## Conceptual model

Two independent role namespaces, layered:

| Layer | Property of | Roles | Source of truth |
|---|---|---|---|
| **Org role** | the user | `admin` > `member` > `guest` | `users.org_role` column |
| **Case role** | the (user, case) pair | `owner` > `editor` > `viewer` | `case_members.role` column |

They never collide because they answer different questions:

- "Can this user create new cases?" → org role (`member` or `admin`).
- "Can this user mutate this specific case?" → case role on that case (`owner` or `editor`).

A `guest` user can be invited to a specific case as an `editor` and have full work-on-this-case capability — they just can't spin up their own cases. A `member` can be invited to someone else's case as a `viewer` and have read-only access *there* while still creating their own cases elsewhere.

---

## Testing strategy

- **Unit tests** for the role hierarchy comparison and the `OrgRoleGuard` (mirror the structure of `role.guard.spec.ts` from the case-level work).
- **Service tests** for the CLI script's upsert logic (does it preserve `admin` when present; does it create new users with `member`).
- **Controller integration tests** for `POST /cases` — guest 403s, member succeeds and gets ownership, admin succeeds.
- **Frontend** changes are mostly chrome + a modal — covered by build and the manual walkthrough at the end. No new frontend test infra.
- **Run command:** `npm test --prefix backend -- --testPathPatterns=<file>` for a single spec; `npm test --prefix backend` for the whole suite. Jest in this project uses `--testPathPatterns` (plural).

---

## Phase 1 — Backend org-role infrastructure

### Task 1: Add `orgRole` column to `UserEntity`

**Files:**
- Modify: `backend/src/database/entities/user.entity.ts`

**Step 1: Add the column + type**

```ts
export type OrgRole = 'admin' | 'member' | 'guest';

@Entity('users')
export class UserEntity extends BaseEntity {
  // ... existing columns unchanged ...

  @Column({ name: 'org_role', type: 'varchar', default: 'guest' })
  orgRole: OrgRole;
}
```

Add `OrgRole` to the named exports from this file so other modules can import it.

**Step 2: Verify TypeScript compiles**

Run: `npm run build --prefix backend`
Expected: success.

**Step 3: Restart dev server (if running) — dev's `synchronize: true` will pick up the column automatically.**

**Leave changes in working tree.**

---

### Task 2: Migration — add column + backfill

**Files:**
- Create: `backend/src/database/migrations/<timestamp>-AddUserOrgRole.ts`

**Step 1: Generate**

Run: `./migrations.sh --dev --generate AddUserOrgRole`

Expected: a new migration file. The `up()` will likely contain only an `ADD COLUMN` (since dev's `synchronize: true` already applied the entity change to the schema, but the generator diffs against the migration history, not the live schema, so this should still produce useful SQL). If it's empty, write the body by hand.

**Step 2: Replace `up()` and `down()` with this exact body**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserOrgRole<timestamp> implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN org_role varchar NOT NULL DEFAULT 'guest'`);
    await queryRunner.query(`UPDATE users SET org_role = 'admin' WHERE email LIKE '%@incite.ventures'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN org_role`);
  }
}
```

Preserve the generator's class-name timestamp suffix.

**Step 3: Apply on dev**

Dev's `synchronize: true` already added the column (with default `'guest'`). The backfill needs to run manually so existing `@incite.ventures` rows become `admin`:

```bash
docker exec -i daubert-postgres psql -U postgres -d daubert -c "UPDATE users SET org_role = 'admin' WHERE email LIKE '%@incite.ventures';"
```

Report the number of rows updated. If 0, that's fine (no `@incite.ventures` accounts in dev).

**DO NOT** run `./migrations.sh --prod --run`. User does that themselves.

**Leave changes in working tree.**

---

### Task 3: Initial role on user shell creation

**Files:**
- Modify: `backend/src/modules/admin/users/admin-users.service.ts`
- Modify: `backend/src/modules/users/users.service.ts`

**Important correction.** `auth.guard.ts` does NOT create users — it only links existing shell users to Firebase UIDs on first sign-in (or throws `NO_ACCOUNT` if no shell exists). All user shells are created by either:
1. `AdminUsersService.createWithOptionalMembership()` — via the `/admin/users` panel.
2. The new `add-member` CLI script (Task 10) — writes via raw SQL.

So org-role assignment happens at shell-creation time in those two places, NOT in the auth path.

**Engineering decision logged (not flagged):** Admin-created user shells get their `orgRole` computed automatically from the email domain (`@incite.ventures` → `admin`, otherwise → `guest`). The admin panel UI does NOT get a role override field in this PR. If an admin needs to create a member-level user, they use the new CLI script. Future PR can add a role dropdown to the admin user-creation form if the friction shows up.

**Step 1: Update `AdminUsersService.createWithOptionalMembership`**

Read the current method (it uses `dataSource.transaction` + `manager.create(UserEntity, ...)`). Add `orgRole` computation:

```ts
import { OrgRole, UserEntity } from '../../../database/entities/user.entity';
import { ADMIN_EMAIL_DOMAIN } from '../../auth/admin.constants';

// inside the transaction, before manager.save:
const emailDomain = input.email.split('@')[1];
const orgRole: OrgRole = emailDomain === ADMIN_EMAIL_DOMAIN ? 'admin' : 'guest';

const user = await manager.save(
  manager.create(UserEntity, {
    email: input.email,
    name: input.name,
    orgRole,
  }),
);
```

**Step 2: Add `setOrgRole` helper to `UsersService`**

For the CLI script and any future programmatic promotion path:

```ts
import { OrgRole } from '../../database/entities/user.entity';

async setOrgRole(userId: string, role: OrgRole): Promise<UserEntity> {
  await this.repo.update(userId, { orgRole: role });
  return this.repo.findOneByOrFail({ id: userId });
}
```

(`UsersService.create` does NOT need widening — it's only called from one paid path today and the script writes via raw SQL.)

**Step 3: Verify build**

Run: `npm run build --prefix backend`
Expected: success.

**Leave changes in working tree.**

---

### Task 4: `@RequireOrgRole` decorator + role hierarchy

**Files:**
- Create: `backend/src/modules/auth/require-org-role.decorator.ts`
- Create: `backend/src/modules/auth/require-org-role.decorator.spec.ts`

**Step 1: Implementation**

```ts
import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { OrgRole } from '../../database/entities/user.entity';
import { OrgRoleGuard } from './org-role.guard';

export const REQUIRED_ORG_ROLE_KEY = 'requiredOrgRole';

export const ORG_ROLE_HIERARCHY: Record<OrgRole, number> = {
  guest: 0,
  member: 1,
  admin: 2,
};

export function orgRoleAtLeast(actual: OrgRole, required: OrgRole): boolean {
  return ORG_ROLE_HIERARCHY[actual] >= ORG_ROLE_HIERARCHY[required];
}

export const RequireOrgRole = (minRole: OrgRole) =>
  applyDecorators(SetMetadata(REQUIRED_ORG_ROLE_KEY, minRole), UseGuards(OrgRoleGuard));
```

**Step 2: Spec (9 cases — full 3×3 matrix, same shape as the case-level role hierarchy spec)**

```ts
import { orgRoleAtLeast } from './require-org-role.decorator';

describe('orgRoleAtLeast', () => {
  it.each([
    ['admin', 'guest', true],
    ['admin', 'member', true],
    ['admin', 'admin', true],
    ['member', 'guest', true],
    ['member', 'member', true],
    ['member', 'admin', false],
    ['guest', 'guest', true],
    ['guest', 'member', false],
    ['guest', 'admin', false],
  ] as const)('orgRoleAtLeast(%s, %s) === %s', (actual, required, expected) => {
    expect(orgRoleAtLeast(actual, required)).toBe(expected);
  });
});
```

**Step 3: Run**

Run: `npm test --prefix backend -- --testPathPatterns=require-org-role`
Expected: 9 tests pass.

**Important:** the file imports `OrgRoleGuard` from `./org-role.guard`, which doesn't exist yet (Task 5 creates it). Create a STUB `org-role.guard.ts` with `// STUB: replaced in Task 5`. The stub MUST be a proper NestJS `@Injectable() class implements CanActivate` (not a function) — `applyDecorators(UseGuards(OrgRoleGuard))` expects a class. Same pattern as the case-level `role.guard.ts` stub from the previous plan.

```ts
// STUB: replaced in Task 5
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class OrgRoleGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
```

**Leave changes in working tree.**

---

### Task 5: `OrgRoleGuard`

**Files:**
- Overwrite: `backend/src/modules/auth/org-role.guard.ts` (stub from Task 4)
- Create: `backend/src/modules/auth/org-role.guard.spec.ts`

**Step 1: Implementation**

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserEntity, OrgRole } from '../../database/entities/user.entity';
import { REQUIRED_ORG_ROLE_KEY, orgRoleAtLeast } from './require-org-role.decorator';

/**
 * Org-wide role gate. Reads `req.user.orgRole` and compares to the route's
 * declared minimum via `@RequireOrgRole(minRole)`. Script-token requests have
 * no `req.user`, so any route gated by this guard 403s for scripts. That's
 * intentional — org-wide routes are user-only.
 */
@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: UserEntity | undefined = request.user;
    if (!user) throw new ForbiddenException('Authentication required');

    const minRole =
      this.reflector.getAllAndOverride<OrgRole>(REQUIRED_ORG_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'guest';

    if (!orgRoleAtLeast(user.orgRole, minRole)) {
      throw new ForbiddenException(`Requires org role '${minRole}' or higher`);
    }
    return true;
  }
}
```

**Step 2: Spec — 3 paths**

1. No `req.user` → `ForbiddenException('Authentication required')`.
2. `user.orgRole` below `minRole` → `ForbiddenException` with `Requires org role 'X' or higher`.
3. `user.orgRole` meets `minRole` → returns `true`.

Mock the `Reflector` (`jest.fn()`); build `ExecutionContext` by hand. Mirror the existing `role.guard.spec.ts` style.

**Step 3: Run**

Run: `npm test --prefix backend -- --testPathPatterns=org-role.guard`
Expected: 3 tests pass.

**Leave changes in working tree.**

---

### Task 6: Wire `OrgRoleGuard`, delete `IsAdminGuard`

**Files:**
- Modify: `backend/src/modules/auth/auth.module.ts`
- Modify: every controller that uses `@UseGuards(IsAdminGuard)` — replace with `@RequireOrgRole('admin')`. Confirmed callsites (from grep):
  - `backend/src/modules/admin/cases/admin-cases.controller.ts`
  - `backend/src/modules/admin/users/admin-users.controller.ts`
  - `backend/src/modules/admin/labeled-entities/admin-labeled-entities.controller.ts` (or wherever it lives — confirm by grep)
- Delete: `backend/src/modules/auth/admin.guard.ts`

**Step 1: Update auth.module**

```ts
providers: [
  firebaseAdminProvider,
  { provide: APP_GUARD, useClass: AuthGuard },
  RoleGuard,         // case-level (existing)
  OrgRoleGuard,      // org-level (new)
  CaseAccessService,
],
exports: [firebaseAdminProvider, RoleGuard, OrgRoleGuard, CaseAccessService, TypeOrmModule],
```

Remove `IsAdminGuard` from providers and exports.

**Step 2: Replace usages**

`grep -rln "IsAdminGuard" backend/src` to enumerate. For each:

```ts
@UseGuards(IsAdminGuard)
```

Becomes:

```ts
@RequireOrgRole('admin')
```

Drop the `IsAdminGuard` import and add `RequireOrgRole` from `'../auth/require-org-role.decorator'` (or path appropriate to the file).

If `@UseGuards` is no longer used in the file, drop the import from `@nestjs/common`.

**Step 3: Delete the old guard file**

```bash
rm backend/src/modules/auth/admin.guard.ts
```

**Step 4: Update `admin.constants.ts`**

Replace the file's comment block with:

```ts
/**
 * Default admin email domain. Used ONLY during initial user creation in
 * `AuthGuard` to set the new user's org role. Once a user exists, admin
 * status is read off the `users.org_role` column.
 */
export const ADMIN_EMAIL_DOMAIN = 'incite.ventures';
```

**Step 5: Verify**

```bash
npm run build --prefix backend
npm test --prefix backend
```

Both green. Any remaining `IsAdminGuard` reference would fail compilation.

**Leave changes in working tree.**

---

## Phase 2 — Case creation for members

### Task 7: `POST /cases` endpoint

**Files:**
- Modify: `backend/src/modules/cases/cases.controller.ts`

**Step 1: Reuse existing DTO**

`backend/src/modules/cases/dto/create-case.dto.ts` **already exists** with the right shape:

```ts
export class CreateCaseDto {
  @IsString()
  name: string;
  @IsOptional()
  @IsDateString()
  startDate?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkDto)
  links?: LinkDto[];
}
```

Import and use it. Do NOT create a duplicate. The admin module has its own `AdminCreateCaseRequest` that includes `ownerUserId` — that one stays for admin-override case creation.

**Step 2: Controller endpoint**

Add to `CasesController` (alongside the existing routes):

```ts
@RequireOrgRole('member')
@Post()
async create(@Body() dto: CreateCaseDto, @Req() req: any) {
  return this.service.createWithOwner({
    name: dto.name,
    ownerUserId: req.user.id,
    startDate: dto.startDate ?? null,
    links: dto.links,
  });
}
```

Imports: `Post`, `Body`, `RequireOrgRole`, the new `CreateCaseDto`. Note `RequireOrgRole('member')` admits both `member` and `admin` (per the hierarchy).

**Step 3: Spec**

Add cases to `backend/src/modules/cases/cases.controller.spec.ts`:

- Guest user (`req.user.orgRole = 'guest'`) → guard 403s before handler is called.
- Member user → handler is called; the service receives `ownerUserId === req.user.id`.
- Admin user → same as member.

The guard test plumbing follows the same pattern as the existing controller spec (mock the `OrgRoleGuard` to pass via `overrideGuard`, or instantiate the controller directly and stub the service).

**Step 4: Run**

```bash
npm test --prefix backend -- --testPathPatterns=cases
```

Expected: all green.

**Leave changes in working tree.**

---

### Task 8: `/auth/me` returns `orgRole`

**Files:**
- Modify: `backend/src/modules/auth/auth.controller.ts`

**Step 1: Confirm shape**

Current `/auth/me` handler is `getMe(@Req() req: any): UserEntity { return req.user; }`. Because `orgRole` is now a column on `UserEntity` (Task 1), it's automatically included in the response — **no handler change needed**.

**Step 2: But the typed response in the existing OpenAPI may not declare `orgRole`** — that's Task 9. Leave this task as a single read to confirm the handler returns the entity and no shape transformation strips fields.

Read `backend/src/modules/auth/auth.controller.ts` and confirm. If the handler is doing any cherry-picking, widen it to include `orgRole`.

**Leave changes in working tree.**

---

### Task 9: OpenAPI updates

**Files:**
- Modify: `contracts/schemas/admin.yaml` (add `OrgRole` enum, add `orgRole` to `AdminUser`)
- Modify: `frontend/src/lib/api-client.ts` (widen the hand-typed `User` interface to include `orgRole`)

**State of the world:**
- `POST /cases` **already exists** in `contracts/paths/cases.yaml:1-26` with `operationId: createCase`.
- `CreateCaseRequest` **already exists** in `contracts/schemas/cases.yaml:51`.
- There is **no** `contracts/schemas/users.yaml`. The only user schema is `AdminUser` in `contracts/schemas/admin.yaml:8`. The `/auth/me` response uses a hand-typed `User` interface in `frontend/src/lib/api-client.ts` (around line 93–98) that is NOT generated from OpenAPI.

So this task is narrow: add `OrgRole` enum + `orgRole` field to admin.yaml, then widen the hand-typed `User` in api-client.ts to include `orgRole: OrgRole`.

**Step 1: Schema**

In `contracts/schemas/admin.yaml`, add `OrgRole`:

```yaml
OrgRole:
  type: string
  enum: [admin, member, guest]
  description: Org-wide role on the platform. Distinct from case-level roles.
```

Add `orgRole` field to `AdminUser`:

```yaml
AdminUser:
  type: object
  properties:
    # ... existing fields ...
    orgRole:
      $ref: '#/OrgRole'
```

**Step 2: Hand-typed `User` widen**

Update `frontend/src/lib/api-client.ts`:

```ts
export type OrgRole = 'admin' | 'member' | 'guest';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  orgRole: OrgRole;   // new
}
```

(Find the existing `User` interface around line 93 and add the field.)

**Step 3: Regenerate types**

```bash
npm run gen
```

Both `frontend/src/generated/api-types.ts` and `backend/src/generated/api-types.ts` update with the new `OrgRole`.

**Step 4: Verify**

```bash
npm run build --prefix backend
npm run build --prefix frontend
```

Both green.

**Leave changes in working tree.**

---

## Phase 3 — CLI script

### Task 10: `scripts/add-member.ts`

**Files:**
- Create: `backend/scripts/add-member.ts`
- Modify: `backend/package.json` (script entry)
- Modify: `package.json` at the repo root (script runner)

**Step 1: Existing script pattern — raw SQL via `db-connect`**

`backend/scripts/create-user.ts` uses `createConnection()` from `./db-connect` and runs raw SQL with `ds.query(...)`. The helper also exports `parseArgs` (parses `--key value`) and `colors` (terminal colors). NO Nest bootstrap. Match this pattern exactly.

**Step 2: Script implementation**

`backend/scripts/add-member.ts`:

```ts
#!/usr/bin/env ts-node
/**
 * Promote a user to member (or create a new member shell).
 * Usage: npm run scripts:add-member -- --email "user@example.com"
 *
 * Behavior:
 *  - Existing admin → no-op (admin > member, preserve).
 *  - Existing member → no-op.
 *  - Existing guest → promoted to member.
 *  - No user → created as member shell (firebase_uid stays null until first sign-in).
 */
import { createConnection, parseArgs, colors } from './db-connect';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    console.error(colors.red('Usage: --email <email>'));
    process.exit(1);
  }

  const ds = await createConnection();
  try {
    const existing = await ds.query(
      'SELECT id, email, org_role FROM users WHERE email = $1',
      [email],
    );

    if (existing.length > 0) {
      const row = existing[0];
      if (row.org_role === 'admin') {
        console.log(colors.yellow(`${email} is already an admin — leaving unchanged.`));
        return;
      }
      if (row.org_role === 'member') {
        console.log(colors.yellow(`${email} is already a member — no change.`));
        return;
      }
      await ds.query(
        `UPDATE users SET org_role = 'member', updated_at = NOW() WHERE id = $1`,
        [row.id],
      );
      console.log(colors.green(`Promoted ${email}: guest → member.`));
      return;
    }

    // No user yet — create a shell. Name is the email local-part; the
    // AuthGuard's first-sign-in flow will overwrite with the Firebase display name.
    const namePlaceholder = email.split('@')[0];
    const result = await ds.query(
      `INSERT INTO users (name, email, org_role, created_at, updated_at)
       VALUES ($1, $2, 'member', NOW(), NOW())
       RETURNING id`,
      [namePlaceholder, email],
    );
    console.log(colors.green(`Created ${email} as member (will be linked to Firebase on first sign-in).`));
    console.log(`  ID: ${result[0].id}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
```

The behavior:
- Existing admin → no-op (admin > member, preserve).
- Existing member → no-op.
- Existing guest → promoted to member.
- No user → created as member.

**Step 3: Backend script entry**

Add to `backend/package.json` `scripts`:

```json
"scripts:add-member": "ts-node scripts/add-member.ts"
```

(Match the pattern of the existing `scripts:create-user` entry.)

**Step 4: Root runner**

Add to root `package.json` `scripts`:

```json
"scripts:add-member": "npm run scripts:add-member --prefix backend"
```

**Step 5: Smoke test**

```bash
npm run scripts:add-member -- --email test-member@example.com
```

Expected output: `Created test-member@example.com as member (will be linked to Firebase on first sign-in).`

Then:

```bash
npm run scripts:add-member -- --email test-member@example.com
```

Expected output: `test-member@example.com is already a member — no change.`

Clean up by running:

```bash
docker exec -i daubert-postgres psql -U postgres -d daubert -c "DELETE FROM users WHERE email = 'test-member@example.com';"
```

**Leave changes in working tree.**

---

## Phase 4 — Frontend

### Task 11: Expose `orgRole` from `AuthProvider`

**Files:**
- Modify: `frontend/src/components/Auth/AuthProvider.tsx`
- Modify: `frontend/src/lib/api-client.ts` (whatever `User` type the api-client exports for `getMe()` consumers)

**Step 1: Widen the `DaubertUser` shape**

```ts
type OrgRole = 'admin' | 'member' | 'guest';

interface DaubertUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  orgRole: OrgRole;
}
```

If the `/auth/me` response already arrives via a typed wrapper, the codegen from Task 9 should have done the heavy lifting — verify by reading the relevant lines of `api-client.ts` and the generated types.

**Step 2: Expose via the context**

Already done — `useAuth().user` now carries `orgRole`. No interface change to the context value beyond the widened `DaubertUser`.

**Step 3: Build**

```bash
npm run build --prefix frontend
```

Expected: green.

**Leave changes in working tree.**

---

### Task 12: `api-client.createCase`

**Files:**
- Modify: `frontend/src/lib/api-client.ts`

**Step 1: Add method**

```ts
createCase(dto: { name: string; startDate?: string; links?: { url: string; label: string }[] }): Promise<Case>
```

Same `request<T>` wrapper used by every other typed endpoint.

**Step 2: Build**

```bash
npm run build --prefix frontend
```

Expected: green.

**Leave changes in working tree.**

---

### Task 13: New case modal

**Files:**
- Create: `frontend/src/components/Cases/NewCaseModal.tsx`

**Step 1: Component shape**

A controlled modal with:

- **Header:** "New case" title. Close (×) button top-right.
- **Body:**
  - **Name** (required) — text input, 1–200 chars. Autofocus.
  - **Start date** (optional) — date input (`type="date"`), submits as ISO 8601 if filled.
  - **Links** (optional, repeating) — a small list editor with "+ Add link" button. Each row has two inputs (URL, label) and a "remove" icon (`FaTrash` from `fa6`). Empty by default.
- **Footer:** "Cancel" (left, secondary) + "Create case" (right, primary). The primary is disabled while submitting or when name is empty.
- **Error banner** at the top of the body, surfaces server errors.

Match the styling vocabulary used by other modals in the workspace — `bg-surface-panel`, `border-line-strong`, `text-ink-muted`, etc. No new dependencies. Look at `frontend/src/components/Common/ErrorModal.tsx` or `Workspace/NewPrimaryModal.tsx` for the existing modal pattern.

**Step 2: Submit handler**

```ts
onSubmit = async () => {
  try {
    setSubmitting(true);
    const created = await apiClient.createCase({
      name: name.trim(),
      startDate: startDate || undefined,
      links: links.filter(l => l.url.trim() && l.label.trim()),
    });
    onCreated?.(created);
    onClose();
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Failed to create case');
  } finally {
    setSubmitting(false);
  }
};
```

**Step 3: Props**

```ts
interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (created: Case) => void;
}
```

**Step 4: Build**

```bash
npm run build --prefix frontend
```

Expected: green.

**Leave changes in working tree.**

---

### Task 14: "+" tile on the cases dashboard

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Step 1: Wire the new tile**

At the top of `CaseSelector` (or wherever the case grid is rendered), determine if the current user can create:

```ts
const { user } = useAuth();
const canCreate = user?.orgRole === 'admin' || user?.orgRole === 'member';
```

In the grid layout, render the "+" tile as the **first** card when `canCreate`. Use the same grid sizing as the other cards. Visual: a large `FaPlus` icon centered, "New case" label below, dashed border, hover ring.

Click handler opens `NewCaseModal`. On `onCreated`, navigate the user into the new case:

```ts
router.push(`/cases/${created.id}/investigations`);
```

If `!canCreate`, render the existing grid unchanged. Do not render any empty placeholder pretending to be a "+".

**Step 2: Edge case — empty grid for new members**

A brand-new member with no cases sees only the "+" tile (no "Contact your administrator…" empty-state copy, which currently shows when `cases.length === 0`). Update the empty-state branch:

- `canCreate && cases.length === 0` → render just the "+" tile, no copy.
- `!canCreate && cases.length === 0` → existing copy (no cases assigned, contact admin).

**Step 3: Build + manual verify**

```bash
npm run build --prefix frontend
```

Then start dev (`npm run db`, `npm run be`, `npm run fe`) and sign in:
- As a `guest` account → no "+" tile.
- As a `member` account (use the CLI script from Task 10 to promote yourself) → "+" tile renders, modal opens, case creation succeeds, you land in the workspace.

**Leave changes in working tree.**

---

### Task 15: Frontend admin gating uses `orgRole`

**Files:**
- Modify: `frontend/src/components/Auth/AdminGuard.tsx`
- Modify: `frontend/src/components/Auth/UserMenu.tsx` (confirmed at line 14: `isAdmin = user?.email?.split('@')[1] === ADMIN_EMAIL_DOMAIN`)
- Modify: `frontend/src/app/admin/layout.tsx` (if it does its own gating)
- Delete: `frontend/src/lib/admin.ts` (the email-domain constant)
- Modify: any other consumer that imports from `frontend/src/lib/admin.ts` (grep first)

**Step 1: Grep usages**

```bash
grep -rln "ADMIN_EMAIL_DOMAIN\|@/lib/admin" frontend/src
```

Known hits (from review):
- `frontend/src/components/Auth/AdminGuard.tsx`
- `frontend/src/components/Auth/UserMenu.tsx`
- `frontend/src/app/admin/layout.tsx`

For every hit, replace the email-domain check with `useAuth().user?.orgRole === 'admin'`.

**Step 2: Delete the constant file**

```bash
rm frontend/src/lib/admin.ts
```

If anything still imports it, the build fails and you patch the leftover hits.

**Step 3: Build**

```bash
npm run build --prefix frontend
```

Expected: green. Test by signing in as a non-admin (`member` or `guest`) and confirming `/admin` 403s / redirects.

**Leave changes in working tree.**

---

## Phase 5 — Docs + verification

### Task 16: Update `docs/ROLES.md`

**Files:**
- Modify: `docs/ROLES.md`

Add a top-level "Org-level roles" section at the start (before the existing "Roles" heading) covering:

- The three-tier hierarchy (`admin > member > guest`).
- The capability matrix (one row per tier × two columns: "Create cases" / "Promote others").
- The relationship to case-level roles (different namespaces — link to the conceptual model from this plan).
- `@RequireOrgRole(minRole)` decorator usage.
- Initial role assignment rules (email-domain check during user creation only).
- How to promote a user (CLI script).

Keep it concise — the audience already knows the case-level system; this is a parallel layer.

**Leave changes in working tree.**

---

### Task 17: Full suite + manual E2E

**Files:** none

**Step 1: Backend suite + build**

```bash
npm run build --prefix backend && npm test --prefix backend
npm run build --prefix frontend
```

All green.

**Step 2: Manual end-to-end**

With three test accounts (`admin@incite.ventures`, `member@…`, `guest@…`):

1. Sign in as `guest@…` → confirm no "+" tile, no `/admin` access, can still open cases they're invited to.
2. Use the CLI script: `npm run scripts:add-member -- --email guest@…`. Confirm output says "Promoted … guest → member."
3. **Reload the guest's tab** to re-fire `onAuthStateChanged` → `AuthProvider` re-fetches `/auth/me` → `orgRole='member'` flows in. **Full sign-out is NOT required** — `AuthProvider` only calls `/auth/me` inside the `onAuthStateChanged` callback, which re-fires on tab reload with the cached Firebase user. Confirm "+" tile is now visible.
4. Click "+", create a case. Confirm redirect to the workspace. Confirm the new case appears in their grid.
5. Sign in as `admin@incite.ventures` → confirm "+" tile present, modal works, `/admin/*` accessible.
6. Sign in as the original guest and confirm the old case-level role behavior unchanged (still invited to cases as viewer/editor/owner correctly).

**Step 3: Report any gaps**

If anything misbehaves, file a follow-up — do NOT patch inline during the verification step.

**Leave changes in working tree. Do not commit.**

---

## Open follow-ups (out of scope)

- Admin-UI for promoting / demoting members (replace the CLI script with a panel). Today an admin still needs CLI access to promote a user.
- Pricing / billing tie-in (members as a paid tier).
- Per-user case quota.
- Inviting someone to a case who doesn't have an account yet should ideally auto-create them as `guest` and pre-populate the invite — currently they must sign up first via Firebase, then the invite gate works. Worth revisiting once self-serve sign-up onboarding is more polished.
