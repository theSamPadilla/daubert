# Drop `links`, Add Members from Create-Case Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the unused `case.links` JSONB field everywhere, and let owners add members directly from the new-case modal — using a smart hybrid (direct-add when the email matches an existing platform user, invite-link as fallback).

**Architecture:** `links` is dead metadata — never rendered in the app. Drop it end-to-end (entity column, migration, DTOs, OpenAPI schemas, frontend modal + settings, hand-typed Case interface). For member-add, add one new backend endpoint `POST /cases/:caseId/members` (owner-gated, body `{ email, role }`) that looks up the user by email and creates the membership; reuse existing `CasesService.addMember`. The `NewCaseModal` orchestrates: create case → for each member row, try direct-add → on 404 fall back to `createInvite` → render a post-create summary listing direct-adds and pending invite links.

**Tech Stack:** NestJS 10 + TypeORM + Postgres (backend), Next.js 14 App Router + Tailwind (frontend), OpenAPI 3 contracts.

**Spec source:** `docs/ROLES.md`. The org-level role + case-level role systems are untouched. This plan only adds a direct-add path to an existing role-gated surface.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|---|---|---|
| 1 | `backend/src/database/entities/case.entity.ts` | Modify | Remove `links` JSONB column |
| 2 | `backend/src/database/migrations/<ts>-DropCaseLinks.ts` | Create | `DROP COLUMN links` on cases; `down()` re-adds with default `[]` |
| 3 | `backend/src/modules/cases/dto/create-case.dto.ts` | Modify | Remove `links` field + `LinkDto` class |
| 4 | `backend/src/modules/cases/dto/update-case.dto.ts` | Modify | Same |
| 5 | `backend/src/modules/admin/cases/dto/create-case.dto.ts` | Modify | Same |
| 6 | `backend/src/modules/cases/cases.service.ts` | Modify | Drop `links` from `createWithOwner` input shape, `update` mapping, and any other use |
| 7 | `backend/src/modules/admin/cases/admin-cases.controller.ts` | Modify | Drop `links` from the admin-create call |
| 8 | `backend/src/modules/cases/cases.controller.ts` | Modify | Drop `links` from the self-serve create call; add new `POST /cases/:caseId/members` route |
| 9 | `backend/src/modules/cases/cases.service.ts` | Modify | New `addMemberByEmail(caseId, email, role)` — looks up user, calls existing `addMember`, throws 404 if no user |
| 10 | `backend/src/modules/cases/dto/add-member.dto.ts` | Create | DTO for `{ email, role }` |
| 11 | `backend/src/modules/users/users.module.ts` | Modify | Export `UsersService` if not already exported (so cases module can lookup by email) |
| 12 | `backend/src/modules/cases/cases.module.ts` | Modify | Import `UsersModule` |
| 13 | `contracts/schemas/cases.yaml` | Modify | Remove `links` from `Case`, `CreateCaseRequest`, `UpdateCaseRequest`; remove `Link` schema if no consumer remains; add `AddMemberRequest` schema |
| 14 | `contracts/schemas/admin.yaml` | Modify | Remove `links` from `AdminCreateCaseRequest` |
| 15 | `contracts/paths/cases.yaml` | Modify | Add `POST /cases/{caseId}/members` (owner) endpoint |
| 16 | `contracts/openapi.yaml` | Modify | Register the new path; remove `Link` registration if dropped |
| 17 | `frontend/src/lib/api-client.ts` | Modify | Drop `links` from `Case`, `updateCase`, `createCase`; add `addCaseMember(caseId, dto)` method |
| 18 | `frontend/src/components/Cases/NewCaseModal.tsx` | Rewrite | Drop `links` section; add `Members` section (email + role rows); post-create orchestration (direct → invite fallback → summary); tighten styling to match other modals (no shouty uppercase labels) |
| 19 | `frontend/src/app/cases/[caseId]/settings/page.tsx` | Modify | Drop the links editor entirely; "Case info" section becomes just name + start date |
| 20 | `docs/ROLES.md` | Modify | Update the route audit table: add `POST /cases/:caseId/members` row |

### What changes (UX and DX)

**For the user (UX):**
- Creating a case stops asking for `links` — was never used anywhere.
- During case creation, owners can list teammates' emails + roles. Anyone already on the platform is added directly; anyone not is sent an invite link surfaced in a copy-friendly summary at the end.
- Existing settings page no longer shows the links editor.

**For the developer (DX):**
- `links` is fully gone from the schema, DTOs, contracts, types, and UI — no dead field to remember.
- One new endpoint (`POST /cases/:caseId/members`) cleanly handles the "add an existing platform user" case; the existing invite endpoint covers the "no account yet" case.
- The modal's orchestration logic is self-contained — settings page can adopt the same direct-add affordance later by calling the same api-client method.

---

## Engineering decisions logged (not flagged)

- **Atomicity.** Case creation + member adds are not in a single transaction. If the case POST succeeds but a member add fails, the case still exists and the user sees a partial summary ("Created case; failed to add X: reason"). Reasonable for a UI-driven flow; matches how Linear / Notion handle bulk member adds.
- **Email match.** Exact lowercase match against `users.email`. No fuzzy match. If the user enters mixed-case, the frontend lowercases before sending — backend ALSO lowercases on read for safety.
- **Direct-add → invite fallback rule.** Direct-add returns 404 when no user exists for that email. Frontend interprets 404 specifically as "fall back to invite". Any other status surfaces as an error row in the summary.
- **Owner add of self.** If the owner types their own email, the backend's existing duplicate-membership check (`ConflictException`) catches it. Frontend renders that as a benign "you're already the owner" note in the summary.

---

## Testing strategy

- **Unit/integration tests** for the new `CasesService.addMemberByEmail` (user-not-found → 404, success path → membership row, duplicate → 409).
- **Controller test** for `POST /cases/:caseId/members` (owner → success, editor/viewer → 403 via guard, missing user → 404).
- **Frontend** changes are UI; rely on build + manual walkthrough at the end.

Run command: `npm test --prefix backend -- --testPathPatterns=<file>`.

---

## Phase 1 — Drop `links` (backend)

### Task 1: Remove `links` column from `CaseEntity`

**Files:**
- Modify: `backend/src/database/entities/case.entity.ts`

**Step 1: Drop the column**

Remove the `links` field declaration and its `@Column` decorator. Preserve everything else.

```ts
@Entity('cases')
export class CaseEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ name: 'start_date', type: 'timestamp', nullable: true })
  startDate: Date | null;

  // links field DELETED

  // ... rest unchanged ...
}
```

**Step 2: Verify build**

Run: `npm run build --prefix backend`
Expected: failures wherever `links` was consumed (the next tasks fix those callsites). Note the failures — they're your task list.

If the build succeeds (because TS doesn't catch JSONB field misuse), still grep `\.links` in `backend/src` to spot remaining references — those are bugs.

**Leave changes in working tree.**

---

### Task 2: Migration `DropCaseLinks`

**Files:**
- Create: `backend/src/database/migrations/<ts>-DropCaseLinks.ts`

**Step 1: Generate**

```bash
./migrations.sh --dev --generate DropCaseLinks
```

Expected: a new migration file. The generator may already produce the correct DROP COLUMN since the entity no longer has the field.

**Step 2: Replace body exactly**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropCaseLinks<timestamp> implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE cases DROP COLUMN links`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE cases ADD COLUMN links jsonb NOT NULL DEFAULT '[]'`);
  }
}
```

Preserve the class-name timestamp suffix. Strip any unrelated drift ALTERs the generator may emit.

**Step 3: Apply on dev**

Dev's `synchronize: true` will drop the column on next backend restart. If you want to drop it immediately:

```bash
docker exec -i daubert-postgres psql -U postgres -d daubert -c "ALTER TABLE cases DROP COLUMN IF EXISTS links;"
```

**DO NOT** run `./migrations.sh --prod --run`.

**Leave changes in working tree.**

---

### Task 3: Drop `links` from cases DTOs

**Files:**
- Modify: `backend/src/modules/cases/dto/create-case.dto.ts`
- Modify: `backend/src/modules/cases/dto/update-case.dto.ts`
- Modify: `backend/src/modules/admin/cases/dto/create-case.dto.ts`

**Step 1: Remove `links` field + `LinkDto` class from each file**

For each, drop the `LinkDto` class (top of file) and the `@IsOptional() @IsArray() @ValidateNested ... links?: LinkDto[]` field. Drop now-unused imports (`IsArray`, `ValidateNested`, `Type` from `class-transformer`).

**Step 2: Verify build**

```bash
npm run build --prefix backend
```

The 3 DTO files should compile cleanly. Remaining errors point at service callsites (Task 4).

**Leave changes in working tree.**

---

### Task 4: Drop `links` from `CasesService` + `AdminCasesController`

**Files:**
- Modify: `backend/src/modules/cases/cases.service.ts`
- Modify: `backend/src/modules/admin/cases/admin-cases.controller.ts`

**Step 1: `createWithOwner` input shape**

```ts
async createWithOwner(input: { name: string; ownerUserId: string; startDate?: string | null }) {
  // ... drop `links: input.links ?? []` from the entity create call ...
}
```

**Step 2: `update`**

Drop the `if (dto.links !== undefined) c.links = dto.links;` line.

**Step 3: `admin-cases.controller.ts`**

Drop `links: dto.links` from the call to `createWithOwner` (and from anywhere else it appears).

**Step 4: Verify**

```bash
npm run build --prefix backend
npm test --prefix backend
```

Both green. Any existing test that asserts `links` on the response needs updating — drop the assertion.

**Leave changes in working tree.**

---

## Phase 2 — Drop `links` (contracts + frontend)

### Task 5: OpenAPI updates

**Files:**
- Modify: `contracts/schemas/cases.yaml`
- Modify: `contracts/schemas/admin.yaml`
- Modify: `contracts/openapi.yaml`

**Step 1: `contracts/schemas/cases.yaml`**

- `Case`: drop `links` from `required` and from `properties`.
- `CreateCaseRequest`: drop `links`.
- `UpdateCaseRequest`: drop `links`.
- `Link` schema: delete entirely if nothing else references it (grep `'#/Link'` in `contracts/` before deleting). Most likely no other consumer.

**Step 2: `contracts/schemas/admin.yaml`**

- `AdminCreateCaseRequest`: drop `links`.

**Step 3: `contracts/openapi.yaml`**

If `Link` was registered in `components.schemas`, remove the registration. Otherwise no edits here.

**Step 4: Regenerate**

```bash
npm run gen
```

Then:

```bash
npm run build --prefix backend
npm run build --prefix frontend
```

Both green. The frontend build will reveal any consumer of `Case.links` — those are caught in Task 6.

**Leave changes in working tree.**

---

### Task 6: Frontend — drop `links` references

**Files:**
- Modify: `frontend/src/lib/api-client.ts`
- Modify: `frontend/src/app/cases/[caseId]/settings/page.tsx`

**Step 1: `api-client.ts`**

- Find the hand-typed `Case` interface (around the same area as the other hand-typed types). Drop the `links` field.
- Find `createCase` and `updateCase` methods. Drop `links` from their `dto` parameter type.

**Step 2: `settings/page.tsx`**

Find the case-info section (around lines 50–160). Delete the entire "Links" sub-section (the array editor, the add/remove handlers, the `links` state). Preserve `name` and `startDate` editing.

`apiClient.updateCase(...)` now only sends `name` and `startDate`.

**Step 3: Build**

```bash
npm run build --prefix frontend
```

Green.

**Leave changes in working tree.**

---

## Phase 3 — Direct-add member endpoint

### Task 7: `AddMemberDto`

**Files:**
- Create: `backend/src/modules/cases/dto/add-member.dto.ts`

**Step 1: Body**

```ts
import { IsEmail, IsIn } from 'class-validator';
import { CaseRole } from '../../../database/entities/case-member.entity';

export class AddMemberDto {
  @IsEmail()
  email: string;

  @IsIn(['owner', 'editor', 'viewer'])
  role: CaseRole;
}
```

Owners CAN add other owners directly via this endpoint (admins / case-managers occasionally want to spin up a co-owned case). The invite-link path restricts to `editor` / `viewer` — that's an invite-flow constraint, not an underlying capability.

**Leave changes in working tree.**

---

### Task 8: `CasesService.addMemberByEmail`

**Files:**
- Modify: `backend/src/modules/cases/cases.service.ts`
- Modify: `backend/src/modules/cases/cases.module.ts`
- Modify: `backend/src/modules/users/users.module.ts` (only if `UsersService` isn't exported)

**Step 1: Wire `UsersService` into `CasesService`**

`CasesService` constructor doesn't have `UsersService` today. Add it:

```ts
import { UsersService } from '../users/users.service';

// constructor:
constructor(
  // ... existing repo injections ...
  private readonly usersService: UsersService,
) {}
```

Module wiring: `cases.module.ts` must import `UsersModule`. Read `users.module.ts` first — if `UsersService` is in `exports`, no change there. If not, add it to exports.

**Step 2: Add the service method**

```ts
async addMemberByEmail(caseId: string, email: string, role: CaseRole): Promise<CaseMemberEntity> {
  const lower = email.trim().toLowerCase();
  const user = await this.usersService.findByEmail(lower);
  if (!user) {
    throw new NotFoundException(`No user found with email ${lower}`);
  }
  return this.addMember(caseId, user.id, role);
}
```

Reuse existing `addMember`. The duplicate-check (`ConflictException`) in `addMember` is what surfaces "already a member" cleanly.

**Step 3: Spec**

Add to `cases.service.spec.ts`:

- User not found → `NotFoundException`.
- User exists, not already a member → returns membership with the given role.
- User exists, already a member → propagates `ConflictException` from underlying `addMember`.
- Email is trimmed + lowercased before lookup.

**Step 4: Verify**

```bash
npm test --prefix backend -- --testPathPatterns=cases
```

Green.

**Leave changes in working tree.**

---

### Task 9: `POST /cases/:caseId/members` endpoint

**Files:**
- Modify: `backend/src/modules/cases/cases.controller.ts`
- Modify: `backend/src/modules/cases/cases.controller.spec.ts`

**Step 1: Endpoint**

Add to `CasesController`:

```ts
@RequireRole('owner')
@Post(':caseId/members')
addMember(
  @Param('caseId') caseId: string,
  @Body() dto: AddMemberDto,
) {
  return this.service.addMemberByEmail(caseId, dto.email, dto.role);
}
```

Imports: `AddMemberDto` from `'./dto/add-member.dto'`.

**Step 2: Spec**

Add controller-level tests:
- Owner caller, valid email → service called with right args; response is the membership.
- Service throws `NotFoundException` → 404 surfaces.
- Service throws `ConflictException` → 409 surfaces.

Mock `CasesService.addMemberByEmail` for these.

**Step 3: Verify**

```bash
npm test --prefix backend -- --testPathPatterns=cases
```

Green.

**Leave changes in working tree.**

---

### Task 10: OpenAPI for the new endpoint

**Files:**
- Modify: `contracts/schemas/cases.yaml`
- Modify: `contracts/paths/cases.yaml`
- Modify: `contracts/openapi.yaml`

**Step 1: Schema**

Add `AddMemberRequest` to `contracts/schemas/cases.yaml`:

```yaml
AddMemberRequest:
  type: object
  required: [email, role]
  properties:
    email:
      type: string
      format: email
    role:
      $ref: '../schemas/admin.yaml#/CaseRole'
```

**Step 2: Path**

Add to `contracts/paths/cases.yaml` under the existing `/cases/{caseId}/members` path object (which already has `GET` after the previous plan landed):

```yaml
/cases/{caseId}/members:
  parameters:
    - $ref: '../openapi.yaml#/components/parameters/CaseIdParam'
  get:
    # ... existing GET op preserved ...
  post:
    operationId: addCaseMember
    summary: Add an existing platform user to this case
    tags: [cases]
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '../schemas/cases.yaml#/AddMemberRequest'
    responses:
      '200':
        description: Membership created
        content:
          application/json:
            schema:
              $ref: '../schemas/admin.yaml#/CaseMember'
      '404':
        description: No user with that email
      '409':
        description: User is already a member
```

Adjust the existing-op formatting if the file uses a different style — match exactly.

**Step 3: Register**

If `contracts/openapi.yaml` references `AddMemberRequest` explicitly in `components.schemas`, add it. Otherwise the `$ref` from the path file is enough.

**Step 4: Regenerate**

```bash
npm run gen
npm run build --prefix backend
npm run build --prefix frontend
```

All green.

**Leave changes in working tree.**

---

### Task 11: `api-client.addCaseMember`

**Files:**
- Modify: `frontend/src/lib/api-client.ts`

**Step 1: Method**

```ts
addCaseMember(caseId: string, dto: { email: string; role: CaseRole }): Promise<CaseMember> {
  return request<CaseMember>(`/cases/${caseId}/members`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}
```

Match the style of the other api-client methods. Place near `listCaseMembers`.

**Step 2: Build**

```bash
npm run build --prefix frontend
```

Green.

**Leave changes in working tree.**

---

## Phase 4 — Modal members section + summary

### Task 12: `NewCaseModal` — restyle + Members section + orchestration

**Files:**
- Modify: `frontend/src/components/Cases/NewCaseModal.tsx`

This is the biggest single task. Break it into clear steps.

**Step 1: Drop the Links section**

Remove the entire Links block (state, add/remove handlers, render). The modal body now has Name, Start date, Members.

**Step 2: Tighten styling**

Drop the `uppercase tracking-wider` on the *field labels* (keep on the modal header). Change them to plain `text-sm text-ink-muted mb-1.5`. Tighten body spacing from `space-y-4` to `space-y-3` to feel less form-y. Match the surface treatment of `NewPrimaryModal.tsx` — read that file for the body / footer style and mirror.

The result should feel closer to NewPrimaryModal (compact, casual) and less like a settings page form.

**Step 3: Members state + UI**

Add a state slice:

```ts
const [members, setMembers] = useState<{ email: string; role: 'editor' | 'viewer' }[]>([]);
```

(Owners can be added LATER via the settings panel — keep the modal options to `editor` / `viewer` only. Both code paths support owner, but the modal UX is for the common case.)

Render a "Members" section below Start date:

- Section label: "Add members" (plain `text-sm text-ink-muted mb-1.5`).
- Render existing rows as `<email input>` + `<role select>` + remove button.
- Below: a "+ Add member" button that pushes an empty row.
- Empty by default (no rows on open).

**Step 4: Orchestration on submit**

Replace the existing `handleSubmit` with:

```ts
type AddResult =
  | { email: string; status: 'added'; role: 'editor' | 'viewer' }
  | { email: string; status: 'invited'; code: string; role: 'editor' | 'viewer' }
  | { email: string; status: 'error'; role: 'editor' | 'viewer'; reason: string };

const handleSubmit = async () => {
  try {
    setSubmitting(true);
    setError(null);

    const created = await apiClient.createCase({
      name: name.trim(),
      startDate: startDate || undefined,
    });

    const valid = members.filter((m) => m.email.trim().includes('@'));
    const results: AddResult[] = [];
    for (const m of valid) {
      const email = m.email.trim().toLowerCase();
      try {
        await apiClient.addCaseMember(created.id, { email, role: m.role });
        results.push({ email, role: m.role, status: 'added' });
      } catch (err: any) {
        // 404 = no user with that email → fall back to invite
        if (err?.message?.includes('No user found')) {
          try {
            const inv = await apiClient.createInvite(created.id, { email, role: m.role });
            results.push({ email, role: m.role, status: 'invited', code: inv.code });
          } catch (inviteErr: any) {
            results.push({ email, role: m.role, status: 'error', reason: inviteErr?.message ?? 'Failed to invite' });
          }
        } else {
          results.push({ email, role: m.role, status: 'error', reason: err?.message ?? 'Failed to add' });
        }
      }
    }

    onCreated?.(created, results);
    // Reset for next open
    setName(''); setStartDate(''); setMembers([]);
  } catch (e: unknown) {
    setError(e instanceof Error ? e.message : 'Failed to create case');
  } finally {
    setSubmitting(false);
  }
};
```

Important: the modal does NOT close immediately on success when there are member results to show. Instead, it transitions to a "Summary" view inside the same modal (Step 5).

**Step 5: Summary view inside the modal**

After successful create, switch the modal body to a summary that shows:

- A header: "Case created — `<case name>`".
- For each `result` in `results`:
  - `added`: ✓ icon (use `FaCheck` from fa6), `<email>` "added as `<role>`".
  - `invited`: ✓ icon, `<email>` "invite ready", followed by a copy-link button (writes `${origin}/invite/${code}` to clipboard).
  - `error`: × icon (use `FaXmark`), `<email>` "could not be added — `<reason>`".
- If `results.length === 0`: skip the summary, navigate immediately.
- Footer changes to a single "Go to case" button that calls `onCreated`'s navigation path (via a callback prop) and closes the modal.

Adjust the prop signature:

```ts
interface NewCaseModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (created: Case, results: AddResult[]) => void;
}
```

If `onCreated` does the navigation in `app/page.tsx`, the modal stays open until the user clicks "Go to case" (then `onCreated` fires + `onClose`).

When `results.length === 0`: call `onCreated` and `onClose` immediately on success — no summary state.

**Step 6: Build**

```bash
npm run build --prefix frontend
```

Green.

**Step 7: Manual smoke**

1. Run `npm run db && npm run be && npm run fe`.
2. Sign in as a member.
3. Click "+", fill the form with a name, leave dates empty.
4. Add three member rows: one email that exists in the DB, one that doesn't, one that's empty.
5. Submit. Expect the summary to show 1 added, 1 invited (with copy-link), 1 ignored (empty rows filtered out).
6. Click "Go to case" → land in the workspace.

**Leave changes in working tree.**

---

### Task 13: Update `app/page.tsx` to handle the summary callback

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Step 1: Adjust `onCreated`**

Today: `onCreated={(created) => router.push(`/cases/${created.id}/investigations`)}`.

New: the modal stays open showing the summary; navigation fires when the user clicks "Go to case" inside the modal. The callback now happens at user choice, not automatically.

The simplest shape:

```tsx
<NewCaseModal
  open={newCaseOpen}
  onClose={() => setNewCaseOpen(false)}
  onCreated={(created /* , results */) => {
    router.push(`/cases/${created.id}/investigations`);
  }}
/>
```

The modal calls `onCreated` only when the user clicks "Go to case". `onClose` follows. No race.

**Step 2: Build**

```bash
npm run build --prefix frontend
```

Green.

**Leave changes in working tree.**

---

## Phase 5 — Docs + verification

### Task 14: Update `docs/ROLES.md` route audit

**File:** `docs/ROLES.md`

In the "Route audit (target state)" table inside the case-level section, add a row:

```markdown
| `POST /cases/:caseId/members` | `owner` (direct-add by email of an existing platform user) |
```

Place it near the existing `PATCH /cases/:caseId/members/:userId` row. Keep the existing rows intact.

**Leave changes in working tree.**

---

### Task 15: Full suite + manual E2E

**Files:** none.

**Step 1: Backend suite + build**

```bash
npm run build --prefix backend && npm test --prefix backend
npm run build --prefix frontend
```

All green.

**Step 2: Manual end-to-end (revised)**

1. Sign in as a member.
2. Click "+ New case".
3. Confirm the Links section is GONE.
4. Add a name. Add two members:
   - One email that already exists (e.g., another test account you've created via the admin panel or `add-member` CLI).
   - One email that doesn't exist (e.g., `freshly-invented@example.com`).
5. Submit.
6. Confirm the summary appears inside the modal: "Case created…", "<existing email> added as editor", "<new email> invite ready" with a Copy link button.
7. Click Copy link → confirm the URL is `${origin}/invite/<code>`.
8. Click "Go to case" → land in the new case workspace.
9. Navigate to `/cases/<id>/settings`. Confirm:
   - The Links editor is gone.
   - Members section shows you (owner) AND the existing-email user (as editor).
   - Invites section shows one pending invite for the new email.

If any of the above misbehaves, file a follow-up — do NOT patch inline.

**Step 3: Cleanup**

Delete any test data created during the walkthrough.

**Leave changes in working tree. Do not commit.**

---

## Open follow-ups (out of scope)

- Surface a "+ Add member" button at the top of the Members section in settings (same orchestration as the modal). Today owners can already create invites in the settings InvitesSection — the affordance is just less discoverable.
- Optional bulk import (paste a CSV of email,role rows) on the modal.
- After a guest accepts an invite, the case owner gets no notification. Polling/SSE would surface it. Not in scope.
