# Data Room

Every case has a built-in data room automatically — no OAuth flow, no connect step, no folder picker. Members browse and download files; editors and above upload and delete. There is no external storage dependency in development.

## Architecture

### StorageProvider interface

All storage operations go through a single interface:

```typescript
interface StorageProvider {
  upload(objectKey: string, body: Readable, contentType: string): Promise<{ size: number }>;
  download(objectKey: string): Promise<{ stream: Readable; size?: number }>;
  delete(objectKey: string): Promise<void>;  // idempotent — never throws if absent
}
```

### Implementations

**`GcsStorageProvider`** (production) — wraps `@google-cloud/storage`. Authenticates via Application Default Credentials (`new Storage()` with no explicit keys). On Cloud Run this resolves to the Workload Identity service account — no static key files are needed or used.

**`LocalDiskStorageProvider`** (non-prod / local / QA) — writes under `os.tmpdir()/daubert-data-room` by default, or the path in `DATA_ROOM_LOCAL_DIR`. Path traversal (`..`) is rejected. Useful for development and automated tests without any GCP dependency.

### Selection logic (`storage.factory.ts`)

| Condition | Provider |
|-----------|----------|
| `GCS_DATA_ROOM_BUCKET` is set | `GcsStorageProvider` |
| `GCS_DATA_ROOM_BUCKET` unset, `NODE_ENV !== 'production'` | `LocalDiskStorageProvider` |
| `GCS_DATA_ROOM_BUCKET` unset, `NODE_ENV === 'production'` | Fatal startup error |

The fatal-in-prod guard prevents files from landing on ephemeral Cloud Run disk.

## Object layout

```
org/<orgId>/case/<caseId>/<fileId>
```

The `fileId` is the `data_room_files` row's primary key, so storage and database are always in lockstep. Cross-case access is structurally impossible: every read and delete is scoped by `{ id, caseId }`, so a fileId from another case is simply not found.

## Data model

### `data_room_files`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK — equals the last segment of `object_key` |
| `case_id` | UUID | FK → cases (indexed) |
| `name` | varchar | Original filename |
| `mime_type` | varchar | MIME type from upload |
| `size` | bigint | Bytes (TypeORM surfaces as string) |
| `object_key` | varchar | Unique. Full GCS/disk path |
| `uploaded_by_user_id` | varchar | Firebase UID of uploader |
| `created_at` | timestamp | Auto |

### `data_room_access_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `case_id` | UUID | Indexed |
| `file_id` | varchar | Nullable (reserved for future bulk actions) |
| `user_id` | varchar | Firebase UID |
| `action` | varchar | `upload` \| `download` \| `delete` \| `agent_read` (agent file read, see Agent Access below) |
| `created_at` | timestamp | Auto |

**What is and is not logged:** upload, download, and delete each write a log row as part of the operation — a log failure fails the operation. Listing files is not logged (browsing is not access).

## Folders

Files can be organised into a folder tree. Folders are pure metadata — GCS object keys stay flat (`org/<orgId>/case/<caseId>/<fileId>`) — so moving a file or folder is a single `folderId` update; no object is ever moved or recopied.

### Data model

**`data_room_folders`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `case_id` | UUID | FK → cases (indexed) |
| `parent_folder_id` | UUID | Nullable FK → self — null means root |
| `name` | varchar | Display name |
| `created_by_user_id` | varchar | Firebase UID of creator |
| `created_at` | timestamp | Auto |

**`data_room_files.folder_id`** — nullable UUID FK → `data_room_folders`. `null` means the file sits at the root of the case data room.

### Nesting and breadcrumbs

`parent_folder_id` supports arbitrary nesting depth. The contents endpoint (`GET .../contents`) returns a `breadcrumb` array of `{ id, name }` ancestors from root to the requested folder, so the frontend can render a path bar without additional requests.

### Endpoints

| Method | Path | Role | Notes |
|--------|------|------|-------|
| `GET` | `/cases/:caseId/data-room/contents?folderId=` | viewer+ | Returns `{ breadcrumb, folders, files }` for the given folder; omit `folderId` for root |
| `POST` | `/cases/:caseId/data-room/folders` | editor+ | Create folder (name + optional parentFolderId) |
| `DELETE` | `/cases/:caseId/data-room/folders/:folderId` | editor+ | Cascade delete (see below) |
| `PATCH` | `/cases/:caseId/data-room/files/:fileId/move` | editor+ | Set file's `folderId` |
| `PATCH` | `/cases/:caseId/data-room/folders/:folderId/move` | editor+ | Set folder's `parentFolderId` |

Upload (`POST .../files`) and Drive import (`POST .../import/google-drive`) both accept an optional `folderId` body field so new files land in the caller's current folder.

### Cascade delete

Deleting a folder recursively removes all descendant folders and files. For every file removed the backend:

1. Writes a `delete` access-log row (chain-of-custody, same as a direct file delete).
2. Issues a GCS `delete` for the object.

GCS delete failures are non-fatal: the DB row is removed and the GCS object becomes a reclaimable orphan. This ensures the cascade never aborts mid-way and never leaves half-removed database rows.

### Move and cycle prevention

Files can be moved to any folder (or back to root). Folders can be moved to any other folder. Before persisting a folder move the backend walks the target's ancestry to confirm the destination is not the folder itself or any of its descendants — a cycle would make the subtree unreachable and is rejected with a 400.

### Roles

Reads (contents listing, download) require `viewer` role or above. Creating, deleting, or moving folders, and moving files, requires `editor` role or above — the same gate as file upload and delete.

### Operator migration note

The prod migration adds the `data_room_folders` table and the `folder_id` column on `data_room_files`. Both changes are additive (no existing rows are altered). Generate and apply via `./migrations.sh` as usual:

```bash
./migrations.sh --prod --generate AddDataRoomFolders
./migrations.sh --prod --run
```

Dev auto-syncs via `synchronize: true` — no manual step needed.

## Backend-brokered access

There are no public GCS objects and no presigned URLs. Every file access goes through the NestJS backend:

- The backend verifies the caller's Firebase token and case role before serving or accepting any data.
- Reads require `viewer` role or above; writes require `editor` role or above.
- Each write (upload, download, delete) appends an `access_log` row before the response is sent — this is the chain-of-custody guarantee.

## Agent Access

Data-room files are readable by both agent surfaces, not just the human UI: the built-in chat agent and the MCP bring-your-own-agent server (`docs/ai-system.md`) each expose `list_data_room_files` (full manifest, up to 500 files, `truncated` flag beyond that) and `read_data_room_file` (extracted text for docx/pdf/xlsx/csv/txt, an image block for images, or a size note if the file exceeds the ceiling). Both tools require viewer role on the case and share the same underlying `DataRoomService` methods, so the two surfaces have identical read behavior. A successful `read_data_room_file` call writes an `agent_read` row to `data_room_access_log` — the same chain-of-custody guarantee as a human download.

## Endpoints

| Method | Path | Role | Notes |
|--------|------|------|-------|
| `GET` | `/cases/:caseId/data-room/files` | viewer+ | List files, newest first |
| `POST` | `/cases/:caseId/data-room/files` | editor+ | Stream upload (busboy, 50MB cap) |
| `GET` | `/cases/:caseId/data-room/files/:fileId/download` | viewer+ | Stream download |
| `DELETE` | `/cases/:caseId/data-room/files/:fileId` | editor+ | Delete file, returns 204 |

## Upload and download

**Upload** uses `busboy` directly, bypassing NestJS `FileInterceptor` (multer) to avoid buffering the entire file before streaming. The file stream pipes straight into storage. Peak memory is bounded regardless of file size.

- 50MB cap enforced via `busboy limits.fileSize`.
- One file per request (`limits.files: 1`).
- `safeRespond` checks `res.headersSent` before writing status — prevents double-response if headers flush mid-stream.

**Download** resolves the file row, opens the storage read stream, logs the access, then returns a NestJS `StreamableFile` with `Content-Type`, `Content-Disposition` (RFC 5987 for non-ASCII filenames), and `Content-Length` (when available).

## Importing from Google Drive

An "Add from Google Drive" action beside the normal upload button lets editors pull files directly from their Drive without a manual download-then-reupload step.

**Flow:**

1. The frontend loads the Google Picker using the [Google Identity Services](https://developers.google.com/identity/gsi/web) library and requests a short-lived `drive.file` access token (no full `drive` scope; not CASA-restricted).
2. The user picks files through the Picker. Opening the Picker with `drive.file` grants the app access to exactly those files and nothing else.
3. The frontend POSTs `{ accessToken, fileIds }` to `POST /cases/:caseId/data-room/import/google-drive` (editor+ role required).
4. The backend downloads each file from Drive using the `googleapis` library and streams it straight into the active `StorageProvider`. Each file lands as a normal `data_room_files` row logged as an `upload` access-log entry — identical to a manual upload for chain-of-custody purposes.

**Native Google file export:** Google Workspace files cannot be downloaded as-is and are auto-exported to editable Office formats.

| Google type | Exported as |
|-------------|-------------|
| Docs | `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) |
| Sheets | `.xlsx` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) |
| Slides | `.pptx` (`application/vnd.openxmlformats-officedocument.presentationml.presentation`) |
| Forms, Drawings, other native types | Rejected (400) |

**No stored credentials:** the access token is used only for the in-request downloads and is never persisted.

**Operator prerequisites:**

| Item | Notes |
|------|-------|
| `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | Exposes the existing OAuth client ID to the frontend for the GIS token request. Add `drive.file` to the client's allowed scopes and the deployment's origin to the client's authorized JavaScript origins. |
| Google brand verification | Required to lift the ~100-test-user cap and remove the "unverified app" warning screen. This is the standard brand-verification gate, not CASA. |

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GCS_DATA_ROOM_BUCKET` | Yes in prod | GCS bucket name. Selects GcsStorageProvider. Validated at startup when `NODE_ENV=production`. |
| `DATA_ROOM_LOCAL_DIR` | No | Override the local-disk base directory. Defaults to `os.tmpdir()/daubert-data-room`. |

The OAuth/encryption variables from the old Drive integration (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `DATAROOM_ENCRYPTION_KEY`) are gone. The OAuth client itself is retained and reused for the Drive import Picker; `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` exposes the client ID to the frontend (see "Importing from Google Drive" below). `NEXT_PUBLIC_DRIVE_PICKER_KEY` is also reused.

## Bring-your-own-cloud

The `StorageProvider` interface is the extension point for alternate backends. `docs/plans/extensions.md` tracks deferred providers: Google Drive (`drive.file` scope, per-case folders), Microsoft Graph (SharePoint/OneDrive). Both would register behind the same interface and the rest of the data room — access log, role gates, streaming — would be unchanged.

## Operator migration note

In development, `synchronize: true` auto-syncs the schema from entities — no manual steps needed.

For production, the operator must generate and apply the migration manually:

```bash
./migrations.sh --prod --generate AddBuiltInDataRoom
./migrations.sh --prod --run
```

This migration creates `data_room_files` and `data_room_access_log`, and drops the old `data_room_connections` table. Review the generated file before running.
