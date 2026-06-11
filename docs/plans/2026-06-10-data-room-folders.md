# Data Room Folders Implementation Plan

**Goal:** Add nested folders to the built-in data room — create/navigate/move/delete folders so it organizes files like Google Drive.

## Summary
- **What & why:** The data room is currently a flat list of files per case. This adds a folder tree: members create folders, navigate into them (breadcrumbs), upload/import into the current folder, move files and folders, and delete folders. Folders are pure metadata in our DB — GCS object keys stay flat (`org/<orgId>/case/<caseId>/<fileId>`), so nothing about storage changes.
- **Key product decisions (locked):**
  - **Nested folders, arbitrary depth** (`parentFolderId` self-reference) with breadcrumb navigation.
  - **Deleting a non-empty folder cascade-deletes everything inside** (subfolders + files + their GCS objects) after a confirm that shows the item count. Each deleted file still writes a `delete` access-log row.
  - **Move is in v1:** files and folders can be moved between folders via a "Move to…" picker. Moving a folder into its own descendant is rejected.
  - Roles unchanged: reads (list/download) = `viewer`+; writes (create/upload/import/move/delete) = `editor`+.
- **Load-bearing architecture decisions:**
  - Folders are metadata only. A new `data_room_folders` table + a nullable `folderId` FK on `data_room_files`. **No GCS restructuring** — moving a file just updates its `folderId`, the object key never changes.
  - The flat `GET .../files` list becomes a folder-scoped `GET .../contents?folderId=` returning `{ breadcrumb, folders, files }`.
- **Risk concentration (opus tasks):** Task 2 (service — recursive cascade-delete with GCS cleanup, move cycle-prevention, folder-scoped queries) and Task 6 (frontend — breadcrumbs, navigation, new-folder, move, cascade-confirm across list + grid).
- **Operator note:** no migration is applied by this run. Dev auto-syncs (`synchronize`). The prod migration (new `data_room_folders` table + `folder_id` column on `data_room_files`) is generated + run by the operator via `./migrations.sh` (additive — safe to run before deploy).

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task. Work in the main repo on `dev` (no worktree). No `Co-Authored-By` trailer. Do NOT run `./migrations.sh` or apply a migration (operator's job). The data-room feature work is currently uncommitted on `dev` — build on top of the working tree.

## Atomized Change Table

| File | Action | What changes |
|---|---|---|
| `backend/src/database/entities/data-room-folder.entity.ts` | Create | `DataRoomFolderEntity` (caseId, parentFolderId nullable, name, createdByUserId) |
| `backend/src/database/entities/data-room-file.entity.ts` | Modify | Add nullable `folderId` column (null = root) |
| `backend/src/database/entities/index.ts` | Modify | Register `DataRoomFolderEntity` |
| `backend/src/database/entities/entities.spec.ts` | Modify | Assert `data_room_folders` table + `folder_id` column |
| `backend/src/modules/data-room/dto/folder.dto.ts` | Create | `CreateFolderDto`, `MoveFileDto`, `MoveFolderDto` |
| `backend/src/modules/data-room/data-room.service.ts` | Modify | `createFolder`, `listContents`, `deleteFolder` (cascade), `moveFile`, `moveFolder`; `folderId` param on `uploadFromStream` + `importFromDrive` |
| `backend/src/modules/data-room/data-room.service.spec.ts` | Modify | Tests for the new methods |
| `backend/src/modules/data-room/data-room.controller.ts` | Modify | Folder routes + `folderId` on upload/import |
| `backend/src/modules/data-room/data-room.controller.spec.ts` | Modify | Route/role tests |
| `backend/src/modules/data-room/data-room.module.ts` | Modify | `forFeature` add `DataRoomFolderEntity` |
| `contracts/schemas/data-room.yaml` | Modify | `DataRoomFolder`, `DataRoomContents`, `CreateFolderRequest`, `MoveRequest` |
| `contracts/paths/data-room.yaml` + `contracts/openapi.yaml` | Modify | Folder operations |
| `backend/src/generated/api-types.ts` / `frontend/src/generated/api-types.ts` | Modify (gen) | `npm run gen` |
| `frontend/src/lib/api-client.ts` | Modify | `dataRoomContents`, `dataRoomCreateFolder`, `dataRoomDeleteFolder`, `dataRoomMoveFile`, `dataRoomMoveFolder`; `folderId` on upload/import |
| `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.tsx` | Modify | Breadcrumbs, folder rows/cards + navigation, new-folder dialog, move action, cascade-delete confirm (list + grid) |
| `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.spec.tsx` | Modify | Update mocks for `dataRoomContents`; keep existing assertions passing |
| `docs/data-room.md` | Modify | Document folders |

---

## Task 1: Folder entity + `folderId` on files
**Implementer:** sonnet
**Files:**
- Create `backend/src/database/entities/data-room-folder.entity.ts`
- Modify `backend/src/database/entities/data-room-file.entity.ts`
- Modify `backend/src/database/entities/index.ts`
- Modify `backend/src/database/entities/entities.spec.ts`

**Step 1 — `data-room-folder.entity.ts`** (extends `BaseEntity`; table `data_room_folders`):
```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('data_room_folders')
@Index(['caseId', 'parentFolderId'])
export class DataRoomFolderEntity extends BaseEntity {
  @Column({ name: 'case_id' })
  caseId: string;

  @Column({ name: 'parent_folder_id', type: 'varchar', nullable: true }) // null = root
  parentFolderId: string | null;

  @Column()
  name: string;

  @Column({ name: 'created_by_user_id' })
  createdByUserId: string;
}
```

**Step 2 — `data-room-file.entity.ts`:** add a nullable folder FK column:
```ts
@Index()
@Column({ name: 'folder_id', type: 'varchar', nullable: true }) // null = root
folderId: string | null;
```

**Step 3 — `index.ts`:** import + export `DataRoomFolderEntity` and add it to the `entities` array.

**Step 4 (test) — `entities.spec.ts`:** add assertions that `DataRoomFolderEntity` maps to `data_room_folders`, and that `DataRoomFileEntity` now has a `folder_id` column (via `getMetadataArgsStorage().columns`).

**Step 5 — run:** `npm test --prefix backend -- entities` → green.
**Step 6 — commit:** `git add backend/src/database/entities && git commit -m "feat(data-room): folder entity + folderId on files"`

## Task 2: Service — folders, contents, cascade-delete, move
**Implementer:** opus  ·  (recursive cascade w/ GCS cleanup, cycle-prevention, folder-scoped queries — high blast radius)
**Files:**
- Create `backend/src/modules/data-room/dto/folder.dto.ts`
- Modify `backend/src/modules/data-room/data-room.service.ts`
- Modify `backend/src/modules/data-room/data-room.service.spec.ts`

**DTOs (`folder.dto.ts`):**
```ts
import { IsOptional, IsString, IsNotEmpty, MaxLength, ValidateIf } from 'class-validator';
export class CreateFolderDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
  @IsOptional() @IsString() parentFolderId?: string | null;
}
export class MoveRequestDto {
  // null targets the root; a string targets a folder
  @ValidateIf((o) => o.targetFolderId !== null) @IsString() targetFolderId: string | null;
}
```

Inject `@InjectRepository(DataRoomFolderEntity)` alongside the existing repos. Add `DataRoomFolderDto` + `DataRoomContentsDto` types. Methods:

- `createFolder(caseId, userId, name, parentFolderId|null): Promise<DataRoomFolderDto>` — if `parentFolderId` given, assert that folder exists and `caseId` matches (404 otherwise). Save + return DTO.
- `listContents(caseId, folderId|null): Promise<{ breadcrumb: {id,name}[]; folders: DataRoomFolderDto[]; files: DataRoomFileDto[] }>` — folders = `find({ where: { caseId, parentFolderId: folderId ?? IsNull() }, order: { name: 'ASC' } })`; files = `find({ where: { caseId, folderId: folderId ?? IsNull() }, order: { createdAt: 'DESC' } })`. Build `breadcrumb` by walking `parentFolderId` from `folderId` to root (each step asserts caseId). Empty breadcrumb at root. (Use TypeORM `IsNull()` for the null case.)
- `moveFile(caseId, userId, fileId, targetFolderId|null): Promise<void>` — load file scoped `{ id, caseId }` (404). If `targetFolderId`, assert that folder exists + same case. Set `folderId = targetFolderId`, save.
- `moveFolder(caseId, userId, folderId, targetFolderId|null): Promise<void>` — load folder `{ id, caseId }` (404). Reject moving into itself or a descendant: walk up from `targetFolderId` via `parentFolderId`; if you reach `folderId`, throw `BadRequestException('cannot move a folder into itself or a descendant')`. If `targetFolderId` given, assert it exists + same case. Set `parentFolderId = targetFolderId`, save.
- `deleteFolder(caseId, userId, folderId): Promise<void>` — load folder `{ id, caseId }` (404). Gather the full subtree: BFS from `folderId` collecting all descendant folder ids (always scoped by caseId). Then `files = fileRepo.find({ where: { caseId, folderId: In(allFolderIds) } })`. **For each file** (same per-file behavior as `deleteFile`): `await this.fileRepo.remove(row)` **then** `await this.storage.delete(row.objectKey)` then `await this.log(caseId, userId, 'delete', file.id)`. **DB-vs-storage rule:** always remove the DB row (DB is source of truth, matching `deleteFile`'s ordering); collect any `storage.delete` errors in an array and continue deleting the rest; after the loop, if the array is non-empty, throw so the operator sees it. A storage failure therefore leaves a *reclaimable GCS orphan* (key prefix is known) — that's the accepted tradeoff; never abort the cascade or leave half-removed DB rows. After files, remove all folder rows (descendants + the folder itself). `storage.delete` is idempotent.
- **`uploadFromStream` + `importFromDrive`:** add an optional trailing `folderId?: string | null` param; when creating the `data_room_files` row, set `folderId: folderId ?? null`. If `folderId` is provided, assert the folder exists + same case before writing. **`importFromDrive` must thread its received `folderId` into each `uploadFromStream(...)` call inside its loop.** Keep existing behavior when omitted (root).

> Import `IsNull` and `In` from `typeorm` for the null-parent / subtree `where` clauses.

All folder/file lookups are scoped by `caseId` (multi-tenant). `listContents` is the new read path; keep `listFiles` too if other code uses it (the controller's `GET .../files` may stay as a root-only alias or be removed — check usages; the frontend will switch to contents).

**Step 1 (test):** extend `data-room.service.spec.ts` (mock the folder repo via `getRepositoryToken(DataRoomFolderEntity)`, plus the existing file repo / log repo / storage / case repo mocks). Cover:
- `createFolder` saves with caseId + parentFolderId; rejects a parent in another case.
- `listContents` returns root folders/files when folderId null; nested when set; builds breadcrumb.
- `moveFile` updates folderId; 404 for cross-case file.
- `moveFolder` rejects moving into a descendant (cycle) — mock the parent-walk to hit the source id.
- `deleteFolder` recursively deletes: for a folder with a subfolder containing 1 file, asserts `storage.delete` called for that file's objectKey, file row removed, a `delete` access-log written, and all folder rows removed.
- `uploadFromStream(..., folderId)` persists the file with that folderId.

**Step 2–4:** `npm test --prefix backend -- data-room.service` (fail → implement → pass). Then `npm run build --prefix backend`.
**Step 5 — commit:** `git add backend/src/modules/data-room/dto/folder.dto.ts backend/src/modules/data-room/data-room.service.ts backend/src/modules/data-room/data-room.service.spec.ts && git commit -m "feat(data-room): folder service (create/list/move/cascade-delete)"`

## Task 3: Controller routes + module
**Implementer:** sonnet
**Files:**
- Modify `backend/src/modules/data-room/data-room.controller.ts`
- Modify `backend/src/modules/data-room/data-room.module.ts`
- Modify `backend/src/modules/data-room/data-room.controller.spec.ts`

Add routes (all `:caseId`-scoped; `@Param('caseId', new ParseUUIDPipe())`; userId via `(req as any).user.id`):
| Method | Path | Role | Handler |
|---|---|---|---|
| GET | `cases/:caseId/data-room/contents` | viewer | `service.listContents(caseId, query.folderId ?? null)` (read `@Query('folderId')`) |
| POST | `cases/:caseId/data-room/folders` | editor | `service.createFolder(caseId, userId, dto.name, dto.parentFolderId ?? null)` (`@Body() CreateFolderDto`) |
| DELETE | `cases/:caseId/data-room/folders/:folderId` | editor, `@HttpCode(204)` | `service.deleteFolder(caseId, userId, folderId)` |
| PATCH | `cases/:caseId/data-room/files/:fileId/move` | editor, `@HttpCode(204)` | `service.moveFile(caseId, userId, fileId, dto.targetFolderId)` (`@Body() MoveRequestDto`) |
| PATCH | `cases/:caseId/data-room/folders/:folderId/move` | editor, `@HttpCode(204)` | `service.moveFolder(caseId, userId, folderId, dto.targetFolderId)` |

Also thread an optional `folderId` into the existing **upload** (multipart — read from a busboy field or a `?folderId=` query; query is simplest) and **import** (`ImportFromDriveDto` gains an optional `folderId`) routes, passing it to the service. Use `@Query('folderId')` for upload to avoid busboy field parsing.

Module: `TypeOrmModule.forFeature([... , DataRoomFolderEntity])`.

**Step 1 (test):** controller spec — assert each new route delegates with the right args + role metadata (`contents`/files GET = viewer; folders POST/DELETE, moves = editor). Mock the new service methods.
**Step 2–4:** `npm test --prefix backend -- data-room.controller` (fail → implement → pass), then `npm run build --prefix backend` and full `npm test --prefix backend`.
**Step 5 — commit:** `git add backend/src/modules/data-room/data-room.controller.ts backend/src/modules/data-room/data-room.controller.spec.ts backend/src/modules/data-room/data-room.module.ts && git commit -m "feat(data-room): folder + move + contents endpoints"`

## Task 4: Contracts + codegen
**Implementer:** sonnet
**Files:** Modify `contracts/schemas/data-room.yaml`, `contracts/paths/data-room.yaml`, `contracts/openapi.yaml`; regen.

Schemas: `DataRoomFolder` `{ id, caseId, parentFolderId(nullable), name, createdByUserId, createdAt }`; `DataRoomContents` `{ breadcrumb: [{id,name}], folders: [DataRoomFolder], files: [DataRoomFile] }`; `CreateFolderRequest` `{ name, parentFolderId?(nullable) }`; `MoveRequest` `{ targetFolderId (string, nullable) }`. Add the operations from Task 3 (contents GET with `folderId` query; folders POST/DELETE; file/folder move PATCH; `folderId` query on upload + optional `folderId` on the import request body). Wire into `openapi.yaml`.

**Steps:** edit yaml → `npm run gen` → `npm run build --prefix backend` (clean; frontend may error on page/api-client until Tasks 5–6) → commit `feat(contracts): data-room folders`.

## Task 5: api-client
**Implementer:** sonnet
**Files:** Modify `frontend/src/lib/api-client.ts`

Add (mirroring the existing `request<T>` helper that sets the Firebase auth header + JSON content-type):
```ts
dataRoomContents: (caseId, folderId?: string | null) =>
  request<DataRoomContents>(`/cases/${caseId}/data-room/contents${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`),
dataRoomCreateFolder: (caseId, name, parentFolderId: string | null) =>
  request<DataRoomFolder>(`/cases/${caseId}/data-room/folders`, { method: 'POST', body: JSON.stringify({ name, parentFolderId }) }),
dataRoomDeleteFolder: (caseId, folderId) =>
  request<void>(`/cases/${caseId}/data-room/folders/${folderId}`, { method: 'DELETE' }),
dataRoomMoveFile: (caseId, fileId, targetFolderId: string | null) =>
  request<void>(`/cases/${caseId}/data-room/files/${fileId}/move`, { method: 'PATCH', body: JSON.stringify({ targetFolderId }) }),
dataRoomMoveFolder: (caseId, folderId, targetFolderId: string | null) =>
  request<void>(`/cases/${caseId}/data-room/folders/${folderId}/move`, { method: 'PATCH', body: JSON.stringify({ targetFolderId }) }),
```
Add inline `DataRoomFolder` + `DataRoomContents` interfaces. Add an optional `folderId` arg to `dataRoomUpload` (append `?folderId=` to the POST URL) and `dataRoomImportFromDrive` (include `folderId` in the body).

**Steps:** implement → `npm run build --prefix frontend` may still fail on page.tsx (Task 6) — confirm api-client itself type-checks via `cd frontend && npx tsc --noEmit` (ignore page.tsx errors). Commit `feat(data-room): folder api-client methods`.

## Task 6: Frontend — folders UI (breadcrumbs, nav, new folder, move, cascade confirm)
**Implementer:** opus  ·  (folder navigation state + move picker + cascade confirm across list AND grid)
**Files:**
- Modify `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.tsx`
- Modify `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.spec.tsx`

Behavior:
- State: `currentFolderId: string | null` (null = root), `breadcrumb`, `folders`, `files`. Replace the `dataRoomListFiles` call with `dataRoomContents(caseId, currentFolderId)`; store `folders`, `files`, `breadcrumb` from the response. Navigating = `setCurrentFolderId(id)` then re-fetch.
- **Breadcrumbs** above the toolbar: `Data Room (root) › Folder › Subfolder`, each segment clickable to navigate there.
- **Folder rendering** in BOTH list and grid (reuse the existing `viewMode`): folders sort first, shown with a folder icon (`FaFolder`, amber tint), clicking a folder navigates into it. In list view a folder row shows name + item count + a "…"/delete + move affordance; in grid a folder card.
- **New folder:** a "New folder" button (canMutate) opens a small inline dialog/prompt for the name → `dataRoomCreateFolder(caseId, name, currentFolderId)` → refetch.
- **Move:** a "Move to…" action on files and folders (canMutate) that opens a folder picker (a simple modal listing the case's folders to pick a destination, plus "Root") → calls `dataRoomMoveFile` / `dataRoomMoveFolder` → refetch. (Drag-drop is optional polish — not required for v1.)
- **Cascade-delete confirm:** deleting a folder confirms with its item count, e.g. `confirm(\`Delete "${folder.name}" and its ${folder.itemCount} item(s)? Everything inside is permanently deleted.\`)` → `dataRoomDeleteFolder` → refetch. (Folder DTO should carry an `itemCount` of direct children — if the backend doesn't provide it, compute "this folder and everything inside" generic copy; prefer the count if available.)
- Upload/import pass `currentFolderId` so new files land in the current folder.
- Keep all existing file behaviors (download/delete/upload/import, list+grid, role gating, the `title="Download"/"Delete"` + button texts) intact.

**Step 1 (test):** update `page.spec.tsx`:
- Replace the `dataRoomListFiles` mock with `dataRoomContents` returning `{ breadcrumb: [], folders: [...], files: FAKE_FILES }` (the page now calls `dataRoomContents`, not `dataRoomListFiles`).
- Add `dataRoomContents`, `dataRoomCreateFolder`, `dataRoomDeleteFolder`, `dataRoomMoveFile`, `dataRoomMoveFolder` to the api-client mock.
- **Update the existing import assertion:** the page now passes the current folder to upload/import, so at the root `currentFolderId` is `null` → change `expect(mockDataRoomImportFromDrive).toHaveBeenCalledWith('case-123', 't', ['a', 'b'])` to `toHaveBeenCalledWith('case-123', 't', ['a', 'b'], null)`. (The `dataRoomUpload`/`dataRoomImportFromDrive` mocks already take `...args: unknown[]`, so no mock-signature change is needed — only the assertion.)
- Keep the rest: file names render, delete calls `dataRoomDeleteFile`, viewer hides upload/delete + Drive button.
- Add: clicking a folder calls `dataRoomContents` again with that folder id; "New folder" calls `dataRoomCreateFolder`.
**Step 2–4:** `npm test --prefix frontend -- data-room` (fail → implement → pass), then `npm run build --prefix frontend` (clean).
**Step 5 — commit:** `git add -A frontend/src && git commit -m "feat(data-room): folders UI (breadcrumbs, nav, new folder, move)"`

## Task 7: Docs
**Implementer:** sonnet
**Files:** Modify `docs/data-room.md`

Add a "Folders" section: the data model (`data_room_folders` + `folderId` on files; GCS keys stay flat), the endpoints (`contents`, folder create/delete, file/folder move), nesting + breadcrumbs, cascade-delete behavior (deletes contents + GCS objects + logs each), and the operator migration note (new table + `folder_id` column, generate + run via `./migrations.sh`). Commit `docs: data room folders`.

## Done criteria
- `npm test --prefix backend` + `npm run build --prefix backend` green; `npm test --prefix frontend` + `npm run build --prefix frontend` green.
- Manual QA (after deploy/local): create a folder, navigate in (breadcrumb updates), upload into it, move a file out to root, move a folder under another (and confirm moving into a descendant is rejected), delete a non-empty folder (confirm shows count; files + GCS objects gone; `delete` rows logged).
- No GCS object-key changes; cascade delete leaves no orphaned objects.
- No migration created by this run (operator generates the prod migration).
