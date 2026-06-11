# Data Room → Google Drive Export

**One-liner:** A "Save to Google Drive" action in the data room that pushes stored case files out to the user's Drive — the mirror image of the existing Drive import, reusing the same `drive.file` token client and backend-brokered streaming.

## Problem & why now

The data room can pull files **in** from Drive (import, already built), but there is no way to get files back **out** to a user's Drive. Investigators routinely need to move exhibits or work-product into their own Workspace — to attach to a filing, share with co-counsel, or archive. Today the only path is download-to-disk then manual re-upload to Drive.

This is the symmetric twin of a convenience we already shipped, so it's cheap to build and removes an obvious friction.

## Fit with strategy

- **BYO-cloud is demoted to deferred extensions**, but the Drive *import* convenience was already pulled forward. Export is its mirror — a **one-off file movement, not a storage-backend integration** — so it is not scope creep into BYO-cloud.
- **Chain-of-custody:** a file leaving the controlled room for a personal Drive is a custody boundary crossing worth recording (`export`).
- **Reuse:** the `drive.file` scope, the GIS token client, and the backend `googleapis` wiring all already exist for import.

## The idea (refined)

1. **"Save to Google Drive" action** on data-room files (single + multi-select), beside the existing download/delete actions.
2. **Reuse the existing `drive.file` token client** (`frontend/src/lib/google-picker.ts`). **`drive.file` already permits creating files in the user's Drive** — no new OAuth scope, no CASA review.
3. **Destination folder:** open the Google Picker in **folder-select mode** so the user chooses where files land; a user-picked folder grants the app write access under `drive.file`. **Fallback** if folder-select proves unreliable: the app creates/uses a single `Daubert Exports` folder in the user's Drive (fully within `drive.file`, zero ambiguity).
4. **Backend-brokered, symmetric with import:** the frontend posts `{ accessToken, fileIds, destinationFolderId }`; the backend reads each GCS object and calls `drive.files.create` with the bytes + `parents: [destinationFolderId]`. Streamed straight from GCS — never buffered whole.
5. **Bytes pushed as-is** (PDF/docx/xlsx/etc.) — no Google-format conversion (that was an import-only concern).
6. **Custody:** each exported file writes an `export` access-log row.

## Product decisions (locked — anchors for autonomous execution)

- **Backend-brokered upload** via `drive.files.create` (symmetric with the import path), **not** client-side. Reuses the existing `googleapis` wiring; backend streams from GCS to Drive.
- **Reuse the existing `drive.file` scope + GIS token client.** No new OAuth scope, no CASA. Token is short-lived, used only for the in-request uploads, **never persisted** (same as import).
- **Files pushed as stored bytes** — no Google-format conversion.
- **Custody:** each export writes an `export` access-log row. This is a **new action value only** — `DataRoomAction` in `data-room-access-log.entity.ts` gains `'export'`; the column is `character varying`, so **no migration is required.** Actor = requesting user.
- **Role:** export requires `viewer`+ — you can already *download* these files in the UI; export is "download-to-Drive," so it carries the same gate as download, not the stricter editor gate.
- **Destination folder:** Picker folder-select primary; app-created `Daubert Exports` folder as the fallback.

## Scope

**In (MVP):**
- **Frontend:** "Save to Google Drive" action (single + multi-select) in the data-room page; destination-folder Picker; progress/toast on completion.
- **`google-picker.ts`:** add a folder-picker variant returning `{ accessToken, destinationFolderId }` (mirror of `pickDriveFiles`).
- **Backend:** `POST /cases/:caseId/data-room/export/google-drive` taking `{ accessToken, fileIds, destinationFolderId }`; for each `fileId`: resolve `{ id, caseId }`, open the GCS read stream, `drive.files.create` with parent. `viewer`+ gate.
- **`export` custody logging** per file (reuse `DataRoomService` private `log()`).
- **`api-client.ts`** method (`dataRoomExportToDrive`) + `contracts/` openapi path/schema + `npm run gen`.
- **Tests** mirroring the existing import tests.

**Out / later:**
- **Microsoft OneDrive/SharePoint export** (Graph) — behind the same UI affordance.
- **Whole-folder export** (push a folder subtree in one action).
- **Background/async export** for very large batches.

## Risks & open questions

- **Weakest assumption:** that destination-folder selection works cleanly under `drive.file`. If a user-picked *existing* folder doesn't grant write, fall back to the app-created `Daubert Exports` folder. **Validate this early** — it's the only non-trivial bit.
- **Large files:** stream GCS→Drive; do not buffer the whole object in memory (mirror import's streaming so backend memory stays bounded).
- **Duplicate exports:** re-exporting the same file creates a new Drive file each time. Acceptable; dedup is out of scope.
- **Partial batch failure:** in a multi-file export, one file failing should not abort the rest — return a per-file result (succeeded/failed) so the UI can report it.
