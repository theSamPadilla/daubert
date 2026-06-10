# Import from Google Drive — Implementation Plan

**Goal:** Let case editors pick individual files from their Google Drive and import them into the built-in (GCS) data room, using the non-restricted `drive.file` scope (no full `drive`, no CASA).

## Summary
- **What & why:** Today files only enter the data room via direct upload. This adds an "Add from Google Drive" action: the user picks files in the Google Picker (granting `drive.file` access to *only* those files), and the backend copies each into the existing data room as a normal `data_room_files` row + `upload` access-log entry. Drive is a one-time **source**, not a backend — after import the file lives in our GCS store, which is good for chain-of-custody (a logged copy captured at import time).
- **Key product decisions:**
  - **Native Google files auto-export to editable Office** on import: Docs→`.docx`, Sheets→`.xlsx`, Slides→`.pptx`. Binary files (PDF, images, Office, etc.) copy as-is. (Operator's call — they want to keep editing these as they go.)
  - Multi-file selection allowed; each file imports independently — partial success is reported (one bad file doesn't fail the batch).
  - Editor+ only (same write gate as upload).
- **Load-bearing architecture decisions:**
  - **Token is obtained client-side via Google Identity Services (GIS) `TokenClient`** with scope `drive.file`, then passed (with the picked file IDs) to the backend per-import. **No OAuth connection, no stored/refreshed token, no encryption** — the token is used in-request and discarded. This is the whole reason it's lighter than the old OAuth data room.
  - Backend downloads/exports each file from Drive via `googleapis` (already a dep) using that access token, and streams it into the **existing** `StorageProvider` through `DataRoomService.uploadFromStream`. No new entity, no schema change.
- **Operator prerequisites (not code):** a Web **OAuth client ID** exposed as `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (reuse the existing OAuth client — add `drive.file` + the app's JS origins); `NEXT_PUBLIC_DRIVE_PICKER_KEY` already exists. Google **brand verification** to leave testing mode (light gate, not CASA) before non-allowlisted users can use it.
- **Risk concentration (opus tasks):** Task 2 (backend import: token use, native-vs-binary export, streaming, per-file error handling).

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task. Work in the main repo on `dev` (the built-in data room is already merged here). No `Co-Authored-By` trailer. No DB migration (this feature adds none).

## Atomized Change Table

| File | Action | What changes |
|---|---|---|
| `backend/src/modules/data-room/google-drive-import.service.ts` | Create | `googleapis`-based: given an access token + Drive fileId, fetch metadata and return `{ name, mimeType, stream }`, auto-exporting native Google types to Office formats |
| `backend/src/modules/data-room/google-drive-import.service.spec.ts` | Create | Unit tests (mock `googleapis`): binary passthrough, native→Office export mapping, missing-metadata error |
| `backend/src/modules/data-room/dto/import-drive.dto.ts` | Create | `ImportFromDriveDto` — `{ accessToken: string; fileIds: string[] }` with class-validator |
| `backend/src/modules/data-room/data-room.service.ts` | Modify | Add `importFromDrive(caseId, userId, accessToken, fileIds)` — loops file IDs, imports each via the import service + `uploadFromStream`, returns `{ imported: DataRoomFileDto[]; failed: {fileId,error}[] }` |
| `backend/src/modules/data-room/data-room.service.spec.ts` | Modify | Tests for `importFromDrive` (mock the import service): success, per-file failure isolation, editor gate |
| `backend/src/modules/data-room/data-room.controller.ts` | Modify | Add `POST cases/:caseId/data-room/import/google-drive` (`@RequireRole('editor')`), body `ImportFromDriveDto`, returns the import result |
| `backend/src/modules/data-room/data-room.module.ts` | Modify | Add `GoogleDriveImportService` to providers |
| `contracts/paths/data-room.yaml` | Modify | Add the import operation |
| `contracts/schemas/data-room.yaml` | Modify | Add `ImportFromDriveRequest` + `ImportFromDriveResponse` |
| `backend/src/generated/api-types.ts` / `frontend/src/generated/api-types.ts` | Modify (gen) | `npm run gen` |
| `frontend/src/lib/google-picker.ts` | Create | Re-create: load Picker SDK + GIS, `pickDriveFiles()` → `{ accessToken, fileIds }` via a `drive.file` `TokenClient` and a file (not folder) Picker |
| `frontend/src/lib/api-client.ts` | Modify | Add `dataRoomImportFromDrive(caseId, accessToken, fileIds)` |
| `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.tsx` | Modify | "Add from Google Drive" button beside "Upload file"; runs picker → import → refresh; shows a partial-failure notice |
| `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.spec.tsx` | Modify | Test the import button calls picker + `dataRoomImportFromDrive` and refreshes; hidden for viewers |
| `frontend/.env.development` + `frontend/.env.example` | Modify | Add `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` |

## Task 1: Import-source service (Drive download/export)
**Implementer:** opus  ·  (native-vs-binary export logic + streaming via googleapis)
**Files:**
- Create `backend/src/modules/data-room/google-drive-import.service.ts`
- Test `backend/src/modules/data-room/google-drive-import.service.spec.ts`

Recover the download/metadata pattern from the deleted `google-drive.service.ts` (git: `git show 7ac9798^:backend/src/modules/data-room/google-drive.service.ts`) — it built a `drive_v3.Drive` from an access token and used `drive.files.get`.

**Service shape:**
```ts
// Native Google MIME -> { exportMime, ext }
const EXPORT_MAP: Record<string, { exportMime: string; ext: string }> = {
  'application/vnd.google-apps.document':     { exportMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  'application/vnd.google-apps.spreadsheet':  { exportMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',     ext: 'xlsx' },
  'application/vnd.google-apps.presentation': { exportMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
};

@Injectable()
export class GoogleDriveImportService {
  private drive(accessToken: string): drive_v3.Drive {
    const auth = new google.auth.OAuth2();            // bare client; an access token needs no client id/secret
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
  }

  // Returns the importable form of a Drive file: final name, final mimeType, and a Readable.
  async fetchForImport(accessToken: string, fileId: string): Promise<{ name: string; mimeType: string; stream: Readable }> {
    const drive = this.drive(accessToken);
    const { data } = await drive.files.get({ fileId, fields: 'name, mimeType', supportsAllDrives: true });
    if (!data.name || !data.mimeType) throw new Error('Drive returned incomplete metadata');

    const exp = EXPORT_MAP[data.mimeType];
    if (exp) {
      const res = await drive.files.export({ fileId, mimeType: exp.exportMime }, { responseType: 'stream' });
      return { name: `${data.name}.${exp.ext}`, mimeType: exp.exportMime, stream: res.data as Readable };
    }
    // Other native Google types (forms, drawings, etc.) have no clean Office export — reject clearly.
    if (data.mimeType.startsWith('application/vnd.google-apps.')) {
      throw new Error(`Unsupported Google file type: ${data.mimeType}`);
    }
    const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
    return { name: data.name, mimeType: data.mimeType, stream: res.data as Readable };
  }
}
```

**Step 1 (test):** `jest.mock('googleapis')` with a fake `drive` whose `files.get`/`files.export` return canned metadata + a `Readable.from(...)`. Assert: a binary file (e.g. `application/pdf`) returns name+mime unchanged via `files.get({alt:'media'})`; a `google-apps.document` returns `name.docx` + the docx mime via `files.export`; a `google-apps.form` throws "Unsupported"; missing name/mime throws.
**Step 2–4:** `npm test --prefix backend -- google-drive-import` (fail → implement → pass).
**Step 5 — commit:** `git add backend/src/modules/data-room/google-drive-import.service.ts backend/src/modules/data-room/google-drive-import.service.spec.ts && git commit -m "feat(data-room): Google Drive import source service"`

## Task 2: Service `importFromDrive` + DTO
**Implementer:** opus  ·  (orchestration, per-file isolation, reuse of uploadFromStream)
**Files:**
- Create `backend/src/modules/data-room/dto/import-drive.dto.ts`
- Modify `backend/src/modules/data-room/data-room.service.ts`
- Modify `backend/src/modules/data-room/data-room.service.spec.ts`

**DTO** (`import-drive.dto.ts`): `class ImportFromDriveDto { @IsString() @IsNotEmpty() accessToken: string; @IsArray() @ArrayNotEmpty() @IsString({ each: true }) fileIds: string[]; }`. Cap `fileIds` length with `@ArrayMaxSize(25)`.

**Service method:** inject `GoogleDriveImportService`. 
```ts
async importFromDrive(caseId, userId, accessToken, fileIds): Promise<{ imported: DataRoomFileDto[]; failed: { fileId: string; error: string }[] }> {
  const imported = []; const failed = [];
  for (const fileId of fileIds) {
    try {
      const { name, mimeType, stream } = await this.driveImport.fetchForImport(accessToken, fileId);
      imported.push(await this.uploadFromStream(caseId, userId, name, mimeType, stream));
    } catch (e) {
      failed.push({ fileId, error: (e as Error).message });
    }
  }
  return { imported, failed };
}
```
Each successful file flows through the existing `uploadFromStream` → objectKey, `data_room_files` row, `upload` access-log entry. No new logging path.

**Size:** the import request body is tiny JSON (`{accessToken, fileIds}`), so `main.ts`'s `express.json({limit:'50mb'})` is irrelevant; the file *content* streams Drive→GCS and never passes through express. There is intentionally **no** size cap on imported files for v1 (they're the user's own Drive files). If this becomes a problem, add a metadata `size` pre-check in Task 1's `fetchForImport` — logged as a deferred concern, not built now.

**Step 1 (test):** in `data-room.service.spec.ts`, provide a mock `GoogleDriveImportService` (via its token) returning a `Readable` for good IDs and throwing for one bad ID. Assert: `imported` has the good ones (each calling `uploadFromStream` → storage.upload + log), `failed` captures the bad one, and one failure does not abort the rest.
**Step 2–4:** `npm test --prefix backend -- data-room.service` (fail → implement → pass).
**Step 5 — commit:** `git add backend/src/modules/data-room/dto/import-drive.dto.ts backend/src/modules/data-room/data-room.service.ts backend/src/modules/data-room/data-room.service.spec.ts && git commit -m "feat(data-room): importFromDrive service + DTO"`

## Task 3: Controller endpoint + module wiring
**Implementer:** sonnet
**Files:**
- Modify `backend/src/modules/data-room/data-room.controller.ts`
- Modify `backend/src/modules/data-room/data-room.module.ts`
- Test `backend/src/modules/data-room/data-room.controller.spec.ts`

Add to the controller:
```ts
@RequireRole('editor')
@Post('cases/:caseId/data-room/import/google-drive')
importFromDrive(
  @Param('caseId', new ParseUUIDPipe()) caseId: string,
  @Body() dto: ImportFromDriveDto,
  @Req() req: Request,
) {
  return this.service.importFromDrive(caseId, (req as any).user.id, dto.accessToken, dto.fileIds);
}
```
(Use `@Body()` + `ValidationPipe` is global — no manual parsing.) Module: add `GoogleDriveImportService` to `providers`.

**Step 1 (test):** controller spec — mock `DataRoomService.importFromDrive`; assert the route delegates with `caseId`, `req.user.id`, `dto.accessToken`, `dto.fileIds`, and that the route requires `editor` via `REQUIRED_ROLE_KEY` metadata.
**Step 2–4:** `npm test --prefix backend -- data-room.controller` then `npm run build --prefix backend` (green).
**Step 5 — commit:** `git add backend/src/modules/data-room/data-room.controller.ts backend/src/modules/data-room/data-room.controller.spec.ts backend/src/modules/data-room/data-room.module.ts && git commit -m "feat(data-room): POST import/google-drive endpoint"`

## Task 4: Contracts + codegen
**Implementer:** sonnet
**Files:** Modify `contracts/paths/data-room.yaml`, `contracts/schemas/data-room.yaml`; regen.

Add `POST /cases/{caseId}/data-room/import/google-drive` with request `ImportFromDriveRequest` `{ accessToken: string; fileIds: string[] }` and response `ImportFromDriveResponse` `{ imported: DataRoomFile[]; failed: { fileId: string; error: string }[] }`.
**Steps:** edit yaml → `npm run gen` → `npm run build --prefix backend` (green; frontend may error only on api-client/page until Task 6) → commit `feat(contracts): data-room Drive import`.

## Task 5: Frontend picker (`drive.file` + GIS)
**Implementer:** opus  ·  (GIS token client + Picker glue is fiddly and browser-only)
**Files:**
- Create `frontend/src/lib/google-picker.ts`
- Modify `frontend/.env.development` + `frontend/.env.example` (add `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`)

**Note on the Picker key:** `NEXT_PUBLIC_DRIVE_PICKER_KEY` is still present in `frontend/.env.development` (line 14) and `.env.example` (line 7) — only its *code usage* was removed in the built-in-data-room work. `docs/data-room.md:105` wrongly tombstones it as "gone"; Task 7 corrects that. Reuse the existing var — do not re-add it.

Recover the SDK-loading shape from git (`git show 0f6ae49^:frontend/src/lib/google-picker.ts`) — keep its lazy `apis.google.com/js/api.js` + `gapi.load('picker')` loader. Add a loader for GIS (`https://accounts.google.com/gsi/client`). Export:
```ts
export async function pickDriveFiles(): Promise<{ accessToken: string; fileIds: string[] } | null>;
```
Flow: (1) load GIS, create a `google.accounts.oauth2.initTokenClient({ client_id: NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.file', callback })` and request an access token (popup). (2) load the Picker; build a `DocsView` for files (NOT folders — drop `setSelectFolderEnabled`), `setOAuthToken(accessToken)`, `setDeveloperKey(NEXT_PUBLIC_DRIVE_PICKER_KEY)`, enable multi-select (`enableFeature(google.picker.Feature.MULTISELECT_ENABLED)`). (3) resolve `{ accessToken, fileIds: docs.map(d => d.id) }`, or `null` on cancel.

`.env.example` comment: `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` — Web OAuth client ID for the Drive Picker's `drive.file` token (reuse the existing OAuth client; add the app origins + Drive/Picker APIs in Cloud Console).

**Step 1 (test):** picker is browser-SDK glue — no unit test here; it's covered by the Task 6 page test (mocked) + manual QA. (State this; don't fake the Google SDKs.)
**Step — commit:** `git add frontend/src/lib/google-picker.ts frontend/.env.development frontend/.env.example && git commit -m "feat(data-room): Drive file picker (drive.file + GIS)"`

## Task 6: api-client + page button
**Implementer:** sonnet
**Files:**
- Modify `frontend/src/lib/api-client.ts`
- Modify `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.tsx`
- Modify `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.spec.tsx`

api-client: `dataRoomImportFromDrive: (caseId, accessToken, fileIds) => request<ImportResult>(\`/cases/${caseId}/data-room/import/google-drive\`, { method: 'POST', body: JSON.stringify({ accessToken, fileIds }) })` (follow the existing `request` helper which sets the Firebase auth header + JSON content-type — verify it sets `Content-Type: application/json`).

page.tsx: add an "Add from Google Drive" button beside "Upload file" (inside the same `canMutate` block). Handler: `const picked = await pickDriveFiles(); if (!picked) return;` → set a loading state → `await apiClient.dataRoomImportFromDrive(caseId, picked.accessToken, picked.fileIds)` → `fetchFiles()` → if `result.failed.length`, show a non-blocking notice listing how many failed. Reuse the existing error banner for hard failures.

**Step 1 (test):** in `page.spec.tsx`, mock `@/lib/google-picker` (`pickDriveFiles` → `{ accessToken:'t', fileIds:['a','b'] }`) and `@/lib/api-client`; assert clicking "Add from Google Drive" calls `dataRoomImportFromDrive('case-123','t',['a','b'])` then refreshes the list; assert the button is hidden for a `viewer`.
**Step 2–4:** `npm test --prefix frontend -- data-room` then `npm run build --prefix frontend` (green).
**Step 5 — commit:** `git add -A frontend/src && git commit -m "feat(data-room): Add from Google Drive button"`

## Task 7: Docs
**Implementer:** sonnet
**Files:** Modify `docs/data-room.md`; check off the item in `docs/plans/extensions.md` ("Import sources" → Import from Google Drive) and `docs/plans/todo.md` (the import line).

- Add an "Importing from Google Drive" section to `docs/data-room.md`: the `drive.file` + Picker + GIS flow, the native→Office export map, that imports become normal `data_room_files` rows (logged as `upload`), and the operator prerequisites (`NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`, brand verification).
- **Correct `docs/data-room.md:105`** — it currently lists `NEXT_PUBLIC_DRIVE_PICKER_KEY` (and implies the OAuth client) as "gone." Remove `NEXT_PUBLIC_DRIVE_PICKER_KEY` from that "gone" list (it's reused by import) and note the OAuth client is retained/reused for the Picker.
- Mark the item done in `docs/plans/extensions.md` and `docs/plans/todo.md`.

Commit `docs: Drive import`.

## Done criteria
- `npm test --prefix backend` + `npm run build --prefix backend` green; `npm test --prefix frontend` + `npm run build --prefix frontend` green.
- Manual QA (needs the OAuth client id + Picker key configured): "Add from Google Drive" → pick a PDF and a Google Doc → both land in the data room (the Doc as `.docx`), each with an `upload` access-log row.
- No new DB migration; no stored Google credentials anywhere.
