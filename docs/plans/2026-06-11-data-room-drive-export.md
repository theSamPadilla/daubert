# Data Room → Google Drive Export — Implementation Plan

**Goal:** Add a "Save to Google Drive" action in the data room that pushes stored case files out to a user-chosen Drive folder — the mirror image of the existing Drive import, reusing the same `drive.file` token client and backend-brokered streaming.

## Summary
- **What & why:** The data room can pull files IN from Drive (import, already built) but can't push them back OUT. Investigators need to move exhibits/work-product into their own Workspace (to attach to a filing, share with co-counsel, archive). This adds a backend-brokered export: the frontend obtains a `drive.file` token + destination folder via the Google Picker, posts `{accessToken, fileIds, destinationFolderId}`, and the backend streams each stored object straight into `drive.files.create`. Every export is custody-logged (`export`).
- **Key product decisions:**
  - **Backend-brokered, streamed** GCS/disk → Drive (symmetric with import); never buffer the whole object.
  - **Reuse the existing `drive.file` scope + GIS token client** — no new OAuth scope, no CASA. Token is short-lived, request-scoped, never persisted (same as import).
  - **Role gate = `viewer`+** (matches *download*, not import's editor+): exporting is "download-to-Drive," a read from the room's perspective.
  - **Single + multi-select** export from the data-room page (locked MVP in the idea doc). The backend endpoint is list-based (`fileIds[]`); the frontend adds a per-file action **and** a minimal multi-select (checkbox per row + a "Save N to Drive" bulk action).
  - **Destination folder:** Google Picker in folder-select mode → `destinationFolderId`. If absent/null, the backend omits `parents` so the file lands in **My Drive root** (still fully within `drive.file`) — this doubles as the idea doc's fallback for flaky folder-select, without needing a named "Daubert Exports" folder.
  - **Custody:** each exported file writes an `export` access-log row. New action value only; column is `varchar` → **no migration**.
  - **Partial-batch tolerance:** one file failing does not abort the rest — the endpoint returns a per-file `{ exported, failed }` result.
- **Load-bearing architecture decisions:**
  - **New `GoogleDriveExportService`** mirrors `GoogleDriveImportService`: a bare `new google.auth.OAuth2()` + `setCredentials({access_token})` → `drive.files.create({ requestBody:{name,parents}, media:{mimeType, body: <stream>}, fields:'id, webViewLink', supportsAllDrives:true })`. Files pushed as **stored bytes**, no Google-format conversion.
  - **`DataRoomService.exportToDrive`** orchestrates: per `fileId`, `findOne({id,caseId})` (tenancy) → `storage.download(objectKey)` (stream) → `driveExport.uploadToFolder(...)` → `log('export')`; collects `{ exported, failed }`. The Drive-write auth is the **browser-obtained `drive.file` token**, independent of the backend's storage credentials.
  - **Response shape:** `{ exported: {fileId, name, webViewLink|null}[]; failed: {fileId, error}[] }` — the mirror of import's `{imported, failed}`, with a Drive link so the UI can offer "open in Drive."
- **Risk concentration (opus tasks): Task 3** (export orchestration: streaming, tenancy, partial-failure, custody) and **Task 7** (the data-room page — per-file action + multi-select on a freshly-rearchitected page; must not regress folder navigation). The idea doc's flagged "weakest assumption" — folder-select working under `drive.file` — is validated in QA; the My-Drive-root fallback de-risks it.

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task.

## Atomized Change Table

| # | File | Action | What changes |
|---|------|--------|---------------|
| 1 | `backend/src/database/entities/data-room-access-log.entity.ts` | Modify | `DataRoomAction` union gains `'export'` (no migration — varchar) |
| 2 | `backend/src/modules/data-room/google-drive-export.service.ts` | Create | New service: stream a buffer/stream into `drive.files.create` under a `drive.file` token |
| 3 | `backend/src/modules/data-room/google-drive-export.service.spec.ts` | Create | Mock `googleapis` (`filesCreate`); assert create called with name/parents/media |
| 4 | `backend/src/modules/data-room/data-room.module.ts` | Modify | Register `GoogleDriveExportService` provider |
| 5 | `backend/src/modules/data-room/data-room.service.ts` | Modify | Add `exportToDrive(caseId,userId,accessToken,fileIds,destinationFolderId)` orchestration; inject `GoogleDriveExportService` |
| 6 | `backend/src/modules/data-room/data-room.service.spec.ts` | Modify | Tests: success logs `export` + returns exported; cross-case file → failed; partial failure isolation; null folder → root |
| 7 | `backend/src/modules/data-room/dto/export-drive.dto.ts` | Create | `ExportToDriveDto { accessToken, fileIds[], destinationFolderId? }` |
| 8 | `backend/src/modules/data-room/data-room.controller.ts` | Modify | `POST cases/:caseId/data-room/export/google-drive`, `@RequireRole('viewer')` |
| 9 | `backend/src/modules/data-room/data-room.controller.spec.ts` | Modify | Assert export endpoint requires `viewer`; service method called with body |
| 10 | `contracts/schemas/data-room.yaml` | Modify | Add `ExportToDriveRequest` / `ExportToDriveResponse` |
| 11 | `contracts/paths/data-room.yaml` | Modify | Add the export path |
| 12 | `contracts/openapi.yaml` | Modify | Register the export path + schema refs |
| 13 | `frontend/src/generated/api-types.ts` + `backend/src/generated/api-types.ts` | Modify (gen) | `npm run gen` output |
| 14 | `frontend/src/lib/api-client.ts` | Modify | `dataRoomExportToDrive(caseId, accessToken, fileIds, destinationFolderId?)` |
| 15 | `frontend/src/lib/google-picker.ts` | Modify | `pickDriveFolderForExport()` → `{ accessToken, destinationFolderId } | null` |
| 16 | `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.tsx` | Modify | Per-file "Save to Google Drive" action (list+grid) + minimal multi-select + handlers |
| 17 | `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.spec.tsx` | Modify | Tests for single + multi export wiring |

---

## Task 1: Add `export` action value
**Implementer:** sonnet
**Files:** Modify `backend/src/database/entities/data-room-access-log.entity.ts` (line 4).

**Step 1:** change the union:
```ts
export type DataRoomAction = 'upload' | 'download' | 'delete' | 'agent_read' | 'export';
```
No migration (varchar column).

**Step 2: Build** — `npm run build --prefix backend` clean.

**Step 3: Commit** — `git add backend/src/database/entities/data-room-access-log.entity.ts && git commit -m "feat(data-room): add export access-log action"` (no Co-Authored-By trailer).

---

## Task 2: `GoogleDriveExportService`
**Implementer:** sonnet
**Files:** Create `backend/src/modules/data-room/google-drive-export.service.ts` + spec; modify `data-room.module.ts`.

**Step 1: Write the failing test** — `google-drive-export.service.spec.ts`, mirroring `google-drive-import.service.spec.ts`'s googleapis mock. **All ESM `import` statements MUST appear at the very top of the file, before any `jest.mock`/`require` — do NOT place `import { Readable }` after the `require()` (illegal, won't compile):**
```ts
import { Readable } from 'stream';

const filesCreate = jest.fn();
const setCredentials = jest.fn();
const OAuth2 = jest.fn().mockImplementation(() => ({ setCredentials }));
const drive = jest.fn();

jest.mock('googleapis', () => ({
  google: { auth: { OAuth2 }, drive },
}));

const { GoogleDriveExportService } = require('./google-drive-export.service');

describe('GoogleDriveExportService', () => {
  let service: any;
  beforeEach(() => {
    jest.clearAllMocks();
    drive.mockReturnValue({ files: { create: filesCreate } });
    service = new GoogleDriveExportService();
  });

  it('creates a Drive file from a stream in the destination folder', async () => {
    filesCreate.mockResolvedValue({ data: { id: 'drive123', webViewLink: 'https://drive/view' } });
    const res = await service.uploadToFolder('tok', 'doc.pdf', 'application/pdf', Readable.from(['x']), 'folderABC');
    expect(setCredentials).toHaveBeenCalledWith({ access_token: 'tok' });
    expect(filesCreate).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({ name: 'doc.pdf', parents: ['folderABC'] }),
      media: expect.objectContaining({ mimeType: 'application/pdf' }),
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    }));
    expect(res).toEqual({ id: 'drive123', webViewLink: 'https://drive/view' });
  });

  it('omits parents when destinationFolderId is null (My Drive root)', async () => {
    filesCreate.mockResolvedValue({ data: { id: 'd2', webViewLink: null } });
    await service.uploadToFolder('tok', 'a.csv', 'text/csv', Readable.from(['y']), null);
    const arg = filesCreate.mock.calls[0][0];
    expect(arg.requestBody.parents).toBeUndefined();
  });
});
```

**Step 2: Run, confirm fail** — `npm test --prefix backend -- google-drive-export.service.spec`.

**Step 3: Implement** `google-drive-export.service.ts` (mirror import service):
```ts
import { Injectable } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';

@Injectable()
export class GoogleDriveExportService {
  private drive(accessToken: string): drive_v3.Drive {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
  }

  /**
   * Create a file in the user's Drive from a byte stream. `destinationFolderId`
   * null → file lands in My Drive root (still within the drive.file scope).
   * Returns the new Drive file id and a shareable web link (if Drive provides one).
   */
  async uploadToFolder(
    accessToken: string,
    name: string,
    mimeType: string,
    stream: Readable,
    destinationFolderId: string | null,
  ): Promise<{ id: string; webViewLink: string | null }> {
    const drive = this.drive(accessToken);
    const res = await drive.files.create({
      requestBody: {
        name,
        ...(destinationFolderId ? { parents: [destinationFolderId] } : {}),
      },
      media: { mimeType, body: stream },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    return { id: res.data.id as string, webViewLink: res.data.webViewLink ?? null };
  }
}
```
Register in `data-room.module.ts`: add `GoogleDriveExportService` to the `providers` array and import it (keep `exports` as-is unless needed elsewhere — it's used only by `DataRoomService` within this module).

**Step 4: Run, confirm pass** — `npm test --prefix backend -- google-drive-export.service.spec`; `npm run build --prefix backend` clean.

**Step 5: Commit** — `git add backend/src/modules/data-room/google-drive-export.service.ts backend/src/modules/data-room/google-drive-export.service.spec.ts backend/src/modules/data-room/data-room.module.ts && git commit -m "feat(data-room): add GoogleDriveExportService"` (no Co-Authored-By trailer).

---

## Task 3: `DataRoomService.exportToDrive` orchestration
**Implementer:** opus
**Files:** Modify `backend/src/modules/data-room/data-room.service.ts`, `data-room.service.spec.ts`.

**Step 1: Write failing tests** in `data-room.service.spec.ts`. The existing setup mocks four repos, `storage` (`{upload,download,delete}`), and `driveImport`. Add a `driveExport` mock (`{ uploadToFolder: jest.fn() }`) to the providers so `DataRoomService` can be constructed (the provider token is the `GoogleDriveExportService` class — add it to the testing module). Add:
```ts
describe('exportToDrive', () => {
  const fileRow = (id: string) => ({ id, caseId: 'c1', name: `${id}.pdf`, mimeType: 'application/pdf', size: '10', objectKey: `k/${id}` });

  it('streams each file to Drive, logs export, returns exported list', async () => {
    fileRepo.findOne.mockImplementation(({ where: { id } }: any) => Promise.resolve(fileRow(id)));
    storage.download.mockResolvedValue({ stream: Readable.from(['x']) });
    driveExport.uploadToFolder.mockResolvedValue({ id: 'd1', webViewLink: 'https://v/1' });

    const res = await service.exportToDrive('c1', 'u1', 'tok', ['a', 'b'], 'folderX');

    expect(res.exported).toEqual([
      { fileId: 'a', name: 'a.pdf', webViewLink: 'https://v/1' },
      { fileId: 'b', name: 'b.pdf', webViewLink: 'https://v/1' },
    ]);
    expect(res.failed).toEqual([]);
    expect(driveExport.uploadToFolder).toHaveBeenCalledWith('tok', 'a.pdf', 'application/pdf', expect.anything(), 'folderX');
    expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'export', fileId: 'a', caseId: 'c1', userId: 'u1' }));
    expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'export', fileId: 'b' }));
  });

  it('reports a cross-case / missing file as failed without aborting the batch', async () => {
    fileRepo.findOne.mockImplementation(({ where: { id } }: any) =>
      Promise.resolve(id === 'missing' ? null : fileRow(id)));
    storage.download.mockResolvedValue({ stream: Readable.from(['x']) });
    driveExport.uploadToFolder.mockResolvedValue({ id: 'd', webViewLink: null });

    const res = await service.exportToDrive('c1', 'u1', 'tok', ['missing', 'ok'], null);

    expect(res.exported.map((e: any) => e.fileId)).toEqual(['ok']);
    expect(res.failed).toEqual([{ fileId: 'missing', error: expect.any(String) }]);
    // null folder is forwarded to the drive service (→ My Drive root)
    expect(driveExport.uploadToFolder).toHaveBeenCalledWith('tok', 'ok.pdf', 'application/pdf', expect.anything(), null);
  });

  it('isolates a Drive upload failure to that file', async () => {
    fileRepo.findOne.mockImplementation(({ where: { id } }: any) => Promise.resolve(fileRow(id)));
    storage.download.mockResolvedValue({ stream: Readable.from(['x']) });
    driveExport.uploadToFolder
      .mockResolvedValueOnce({ id: 'd1', webViewLink: null })
      .mockRejectedValueOnce(new Error('drive boom'));

    const res = await service.exportToDrive('c1', 'u1', 'tok', ['a', 'b'], 'f');
    expect(res.exported.map((e: any) => e.fileId)).toEqual(['a']);
    expect(res.failed).toEqual([{ fileId: 'b', error: 'drive boom' }]);
  });
});
```
`Readable` is ALREADY imported at the top of `data-room.service.spec.ts` (do not duplicate). Add the `GoogleDriveExportService` provider mock to the testing module (`{ provide: GoogleDriveExportService, useValue: driveExport }` where `const driveExport = { uploadToFolder: jest.fn() }`). **In a `beforeEach` inside the `exportToDrive` describe (or at the top of each test), set `logRepo.save.mockResolvedValue(undefined)` and `logRepo.create.mockImplementation((e) => e)`** so the awaited `log()` call resolves — the existing per-test pattern in this spec sets `logRepo.save` explicitly, so don't rely on a default.

**Step 2: Run, confirm fail.**

**Step 3: Implement** in `data-room.service.ts`:
- Import `GoogleDriveExportService` and inject it in the constructor (add `private readonly driveExport: GoogleDriveExportService,` alongside `driveImport`).
- Add the return type interface near the other DTOs:
```ts
export interface DriveExportResult {
  exported: { fileId: string; name: string; webViewLink: string | null }[];
  failed: { fileId: string; error: string }[];
}
```
- Add the method (place near `getFileForDownload` / `importFromDrive`):
```ts
/**
 * Export stored files to the user's Google Drive. Browser-supplied `accessToken`
 * (drive.file scope) authorizes the writes; storage creds authorize the reads.
 * Each file: tenancy-scoped lookup → stream from storage → drive.files.create →
 * `export` audit row. One file failing does not abort the batch. `destinationFolderId`
 * null → My Drive root.
 */
async exportToDrive(
  caseId: string,
  userId: string,
  accessToken: string,
  fileIds: string[],
  destinationFolderId: string | null,
): Promise<DriveExportResult> {
  const exported: DriveExportResult['exported'] = [];
  const failed: DriveExportResult['failed'] = [];

  for (const fileId of fileIds) {
    try {
      const row = await this.fileRepo.findOne({ where: { id: fileId, caseId } });
      if (!row) {
        failed.push({ fileId, error: 'file_not_found' });
        continue;
      }
      const { stream } = await this.storage.download(row.objectKey);
      const created = await this.driveExport.uploadToFolder(
        accessToken, row.name, row.mimeType, stream, destinationFolderId,
      );
      await this.log(caseId, userId, 'export', fileId);
      this.logger.log(`export caseId=${caseId} fileId=${fileId} driveId=${created.id}`);
      exported.push({ fileId, name: row.name, webViewLink: created.webViewLink });
    } catch (e) {
      failed.push({ fileId, error: e instanceof Error ? e.message : 'export_failed' });
    }
  }
  return { exported, failed };
}
```

**Step 4: Run, confirm pass** — `npm test --prefix backend -- data-room.service.spec`; build clean.

**Step 5: Commit** — `git add backend/src/modules/data-room/data-room.service.ts backend/src/modules/data-room/data-room.service.spec.ts && git commit -m "feat(data-room): add exportToDrive orchestration with per-file results"` (no Co-Authored-By trailer).

---

## Task 4: Controller endpoint + DTO
**Implementer:** sonnet
**Files:** Create `backend/src/modules/data-room/dto/export-drive.dto.ts`; modify `data-room.controller.ts`, `data-room.controller.spec.ts`.

**Step 1: Write failing test** — in `data-room.controller.spec.ts`, add `exportToDrive: jest.fn()` to the `mockService`, and:
```ts
it('POST export/google-drive requires viewer', () => {
  const role = Reflect.getMetadata(REQUIRED_ROLE_KEY, controller.exportToDrive);
  expect(role).toBe('viewer');
});
```

**Step 2: Run, confirm fail.**

**Step 3: Implement.** DTO `export-drive.dto.ts` (mirror `import-drive.dto.ts`):
```ts
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ExportToDriveDto {
  @IsString() @IsNotEmpty()
  accessToken: string;

  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(25) @IsString({ each: true })
  fileIds: string[];

  @IsOptional() @IsString()
  destinationFolderId?: string | null;
}
```
Controller — add after the import handler (mirror it, but `viewer` gate):
```ts
@RequireRole('viewer')
@Post('cases/:caseId/data-room/export/google-drive')
exportToDrive(
  @Param('caseId', new ParseUUIDPipe()) caseId: string,
  @Body() dto: ExportToDriveDto,
  @Req() req: Request,
) {
  return this.service.exportToDrive(
    caseId,
    (req as any).user.id,
    dto.accessToken,
    dto.fileIds,
    dto.destinationFolderId ?? null,
  );
}
```
Import `ExportToDriveDto` at the top.

**Step 4: Run, confirm pass** — `npm test --prefix backend -- data-room.controller.spec`; build clean.

**Step 5: Commit** — `git add backend/src/modules/data-room/dto/export-drive.dto.ts backend/src/modules/data-room/data-room.controller.ts backend/src/modules/data-room/data-room.controller.spec.ts && git commit -m "feat(data-room): add export-to-Drive endpoint (viewer+)"` (no Co-Authored-By trailer).

---

## Task 5: Contracts + api-client method
**Implementer:** sonnet
**Files:** Modify `contracts/schemas/data-room.yaml`, `contracts/paths/data-room.yaml`, `contracts/openapi.yaml`; run `npm run gen` (updates both `generated/api-types.ts`); modify `frontend/src/lib/api-client.ts`.

**Step 1:** Add to `contracts/schemas/data-room.yaml` (mirror Import schemas):
```yaml
ExportToDriveRequest:
  type: object
  required: [accessToken, fileIds]
  properties:
    accessToken: { type: string }
    fileIds:
      type: array
      items: { type: string }
      minItems: 1
      maxItems: 25
    destinationFolderId:
      type: string
      nullable: true

ExportToDriveResponse:
  type: object
  required: [exported, failed]
  properties:
    exported:
      type: array
      items:
        type: object
        required: [fileId, name, webViewLink]
        properties:
          fileId: { type: string }
          name: { type: string }
          webViewLink: { type: string, nullable: true }
    failed:
      type: array
      items:
        type: object
        required: [fileId, error]
        properties:
          fileId: { type: string }
          error: { type: string }
```
Add to `contracts/paths/data-room.yaml` (mirror the import path entry, summary "Export files from the data room to Google Drive", operationId `dataRoomExportToGoogleDrive`, request `$ref ExportToDriveRequest`, 200 response `$ref ExportToDriveResponse`).
Register in `contracts/openapi.yaml` — under `paths`, mirror the existing import entry exactly (the import entry is `/cases/{caseId}/data-room/import/google-drive: { $ref: './paths/data-room.yaml#/~1cases~1{caseId}~1data-room~1import~1google-drive' }`). Add:
```yaml
  /cases/{caseId}/data-room/export/google-drive:
    $ref: './paths/data-room.yaml#/~1cases~1{caseId}~1data-room~1export~1google-drive'
```
And under `components/schemas`, mirror the import schema refs:
```yaml
    ExportToDriveRequest:
      $ref: './schemas/data-room.yaml#/ExportToDriveRequest'
    ExportToDriveResponse:
      $ref: './schemas/data-room.yaml#/ExportToDriveResponse'
```
(Match the exact indentation of the surrounding entries in the file.)

**Step 2:** From repo root, `npm run gen` → regenerates `frontend/src/generated/api-types.ts` and `backend/src/generated/api-types.ts`. Confirm no errors. (The data-room page reads `DataRoomFile` etc. from generated types — make sure gen succeeds.)

**Step 3:** Add to `api-client.ts` (mirror `dataRoomImportFromDrive`):
```ts
dataRoomExportToDrive: (
  caseId: string,
  accessToken: string,
  fileIds: string[],
  destinationFolderId?: string | null,
) =>
  request<{ exported: { fileId: string; name: string; webViewLink: string | null }[]; failed: { fileId: string; error: string }[] }>(
    `/cases/${caseId}/data-room/export/google-drive`,
    { method: 'POST', body: JSON.stringify({ accessToken, fileIds, destinationFolderId }) },
  ),
```

**Step 4: Verify** — `npm run build --prefix frontend` (or `tsc --noEmit` in frontend) compiles; `npm run build --prefix backend` clean.

**Step 5: Commit** — `git add contracts frontend/src/generated/api-types.ts backend/src/generated/api-types.ts frontend/src/lib/api-client.ts && git commit -m "feat(data-room): export-to-Drive contract + api-client method"` (no Co-Authored-By trailer).

---

## Task 6: `pickDriveFolderForExport`
**Implementer:** sonnet
**Files:** Modify `frontend/src/lib/google-picker.ts`.

**Step 1:** Add a new export mirroring `pickDriveFiles`, but a single-folder select view. Reuse the existing `loadGis()`, `requestDriveFileToken()`, `loadGapiAndPicker()` preamble and env vars.
```ts
export async function pickDriveFolderForExport(): Promise<
  { accessToken: string; destinationFolderId: string } | null
> {
  await loadGis();
  const accessToken = await requestDriveFileToken();
  await loadGapiAndPicker();
  const picker = window.google?.picker;
  if (!picker) throw new Error('Google Picker failed to load');
  const appId = (process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? '').split('-')[0];

  return new Promise((resolve, reject) => {
    try {
      // Use the SAFE form (no ViewId.FOLDERS — untyped global, not used elsewhere
      // in this codebase). setSelectFolderEnabled(true) + the folder mime filter
      // is the load-bearing part and works under the drive.file scope.
      const view = new picker.DocsView()
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder');

      const built = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(process.env.NEXT_PUBLIC_DRIVE_PICKER_KEY)
        .setAppId(appId)
        .setCallback((data: any) => {
          if (data.action === picker.Action.PICKED) {
            const destinationFolderId = (data.docs ?? [])[0]?.id;
            resolve(destinationFolderId ? { accessToken, destinationFolderId } : null);
          } else if (data.action === picker.Action.CANCEL) {
            resolve(null);
          }
        });
      built.build().setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
}
```
The `setSelectFolderEnabled(true)` + folder mime filter is the load-bearing part (validated in QA — the idea doc's flagged "weakest assumption").

**Step 2: Verify** — `npm run build --prefix frontend` (or frontend `tsc --noEmit`) compiles. No unit test (the picker is browser-only; it's validated in QA, mirroring the untested `pickDriveFiles`).

**Step 3: Commit** — `git add frontend/src/lib/google-picker.ts && git commit -m "feat(data-room): add Drive folder-select picker for export"` (no Co-Authored-By trailer).

---

## Task 7: Data-room page — "Save to Google Drive" action + multi-select
**Implementer:** opus
**Files:** Modify `frontend/src/app/cases/[caseId]/(workspace)/data-room/page.tsx`, `page.spec.tsx`.

**Context:** The page has per-file Download/Move/Delete buttons in BOTH list view (~lines 656-688) and grid view (~lines 538-569). Download is visible to all roles; Move/Delete are `canMutate`-gated. There is NO multi-select state today. Import is wired via `handleImportFromDrive` (~213-233) → `pickDriveFiles()` → `apiClient.dataRoomImportFromDrive(...)` → `fetchContents()`. Mirror that for export.

**Step 1: Write failing tests** in `page.spec.tsx`. FIRST read the file's existing mocks. There is ONE `jest.mock('@/lib/google-picker', () => ({ pickDriveFiles: ... }))` factory and ONE `jest.mock('@/lib/api-client', ...)` factory (the `apiClient` object). **MODIFY those single existing factories — do NOT add a second `jest.mock` for the same module path** (only one wins). Concretely:
- Declare `const mockPickDriveFolderForExport = jest.fn();` and `const mockDataRoomExportToDrive = jest.fn();` near the other `mock*` consts.
- Inside the existing google-picker factory, add a second key alongside `pickDriveFiles`:
  `pickDriveFolderForExport: (...a: unknown[]) => mockPickDriveFolderForExport(...a),`
- Inside the existing api-client factory's `apiClient: { ... }` object, add:
  `dataRoomExportToDrive: (...a: unknown[]) => mockDataRoomExportToDrive(...a),`

The per-file button will have `title="Save to Google Drive"`, each file-row checkbox will have `aria-label={`Select ${file.name}`}`, and the bulk button text will be `Save {n} to Google Drive` (see Step 3) — the tests query those:
```ts
it('exports a single file to Drive via the per-file action', async () => {
  mockPickDriveFolderForExport.mockResolvedValue({ accessToken: 'tok', destinationFolderId: 'folderX' });
  mockDataRoomExportToDrive.mockResolvedValue({ exported: [{ fileId: 'f1', name: 'a.pdf', webViewLink: null }], failed: [] });
  render(<DataRoomPage />, { wrapper: Wrapper }); // use the file's existing render harness
  await screen.findByText('a.pdf');             // wait for the seeded file (match the existing mockDataRoomContents fixture's file name + id)
  fireEvent.click(screen.getAllByTitle('Save to Google Drive')[0]);
  await waitFor(() => expect(mockPickDriveFolderForExport).toHaveBeenCalled());
  await waitFor(() => expect(mockDataRoomExportToDrive).toHaveBeenCalledWith(CASE_ID, 'tok', ['f1'], 'folderX'));
});

it('does nothing when the folder picker is cancelled', async () => {
  mockPickDriveFolderForExport.mockResolvedValue(null);
  render(<DataRoomPage />, { wrapper: Wrapper });
  await screen.findByText('a.pdf');
  fireEvent.click(screen.getAllByTitle('Save to Google Drive')[0]);
  await waitFor(() => expect(mockPickDriveFolderForExport).toHaveBeenCalled());
  expect(mockDataRoomExportToDrive).not.toHaveBeenCalled();
});

it('exports multiple selected files in one call', async () => {
  mockPickDriveFolderForExport.mockResolvedValue({ accessToken: 'tok', destinationFolderId: 'fX' });
  mockDataRoomExportToDrive.mockResolvedValue({ exported: [], failed: [] });
  render(<DataRoomPage />, { wrapper: Wrapper });
  await screen.findByText('a.pdf');
  // select the seeded files via their row checkboxes (use the fixture's actual file names)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select a.pdf' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select b.pdf' }));
  fireEvent.click(screen.getByRole('button', { name: /Save 2 to Google Drive/ }));
  await waitFor(() => expect(mockDataRoomExportToDrive).toHaveBeenCalledWith(CASE_ID, 'tok', expect.arrayContaining(['f1', 'f2']), 'fX'));
});
```
**IMPORTANT:** Read the existing `mockDataRoomContents` fixture in the spec and match its actual file names/ids (the snippets above assume two files `a.pdf` (id `f1`) and `b.pdf` (id `f2`) — adjust to the real fixture, or extend the fixture to contain two files if it has only one). Reuse the file's existing render harness/wrapper (`<ConfirmProvider>` etc.) exactly as the import test does — copy its render setup rather than inventing `Wrapper`/`DataRoomPage` names.

**Step 2: Run, confirm fail.**

**Step 3: Implement.**
- **State:** `const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());` and `const [exporting, setExporting] = useState(false);`. Clear selection whenever `currentFolderId` changes (add to the existing folder-change effect, or reset in `fetchContents`).
- **Single-file handler:**
```ts
const handleExportToDrive = async (fileIds: string[]) => {
  if (fileIds.length === 0) return;
  const picked = await pickDriveFolderForExport();
  if (!picked) return; // cancelled
  setExporting(true);
  try {
    const res = await apiClient.dataRoomExportToDrive(caseId, picked.accessToken, fileIds, picked.destinationFolderId);
    if (res.failed.length) {
      setError(`${res.failed.length} file(s) couldn't be exported to Drive`);
    }
    // optional: success toast/state; clear selection on success
    setSelectedFileIds(new Set());
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Drive export failed');
  } finally {
    setExporting(false);
  }
};
```
- **Per-file action button** in BOTH list and grid views, next to Download (visible to ALL roles, NO `canMutate` gate), using `FaGoogle` (already imported) or a suitable fa6 icon (NO emojis — react-icons only):
```tsx
<button onClick={() => handleExportToDrive([file.id])} disabled={exporting} title="Save to Google Drive" aria-label="Save to Google Drive">
  <FaGoogle className="w-3.5 h-3.5" />
</button>
```
- **Multi-select (minimal):** add a checkbox to each FILE row (list view; and grid tile) with **`aria-label={`Select ${file.name}`}`**, `checked={selectedFileIds.has(file.id)}`, and an onChange that toggles the id in the Set (immutably: `setSelectedFileIds(prev => { const n = new Set(prev); n.has(file.id) ? n.delete(file.id) : n.add(file.id); return n; })`). When `selectedFileIds.size > 0`, render a small action bar (near the existing toolbar / above the list) containing a button whose text is exactly **`Save {selectedFileIds.size} to Google Drive`** → `handleExportToDrive([...selectedFileIds])`, plus a "Clear selection" button that resets the Set. Only FILE rows are selectable (NOT folders). Ensure the checkbox does NOT interfere with folder rows, breadcrumb, upload, import, or Move/Delete.
- **CRITICAL — do not regress:** the page was recently rearchitected for folders. Do not change folder navigation, breadcrumb, upload, import, move, or delete behavior. The checkbox column must not break row click/hover affordances. If adding a checkbox column to the list table is invasive, a lighter approach is a per-row checkbox in the existing actions cell — choose the least invasive option that passes the tests.

**Step 4: Run, confirm pass** — `npm test --prefix frontend -- data-room/page.spec` green; `npm run build --prefix frontend` compiles. Run the full frontend suite to confirm no regression: `npm test --prefix frontend` (report totals).

**Step 5: Commit** — `git add frontend/src/app/cases/[caseId]/(workspace)/data-room/page.tsx frontend/src/app/cases/[caseId]/(workspace)/data-room/page.spec.tsx && git commit -m "feat(data-room): Save to Google Drive action with single + multi-select"` (no Co-Authored-By trailer).

---

## Engineering decisions (logged, not blocking)
- **`viewer`+ gate** for export (matches download), not import's editor+ — exporting is download-to-Drive.
- **`destinationFolderId` null → My Drive root** (omit `parents`). This is the idea doc's fallback for flaky folder-select, without a named "Daubert Exports" folder (simpler, still within `drive.file`).
- **Per-file result `{exported, failed}`** with `webViewLink` so the UI can later link to the Drive copy. Partial failures never abort the batch.
- **Multi-select kept minimal** (checkbox + bulk button) to honor the locked MVP scope without rebuilding the freshly-rearchitected page's interaction model. Folders are not selectable.
- **No Google-format conversion** — bytes pushed as stored (import-only concern).
- **Per-task commits + no Co-Authored-By trailer** (fullsend autonomous build).
