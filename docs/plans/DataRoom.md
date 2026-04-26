# Data Room — Google Drive Integration

**Goal:** Per-case "Data Room" backed by the user's own Google Drive. Lawyers/experts connect a Drive folder to a case; Daubert browses, uploads to, and downloads from that folder via Drive's API. Daubert holds OAuth tokens (encrypted) and a folder reference — no file copies.

**Non-goals (this plan):**
- Dropbox / OneDrive / Box (deferred — see "Future")
- Agent tools (`read_dataroom_file`, `create_dataroom_file`) — separate follow-up plan once the basic flow is shipped
- Subfolder traversal — keep listing flat for v1
- File search inside the data room
- Drive's JS picker — using a folder-URL paste flow instead (no frontend SDK dep)

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/database/entities/data-room-connection.entity.ts` | Create | Per-case Drive connection — encrypted tokens + folder ID |
| 2 | `backend/src/database/entities/index.ts` | Modify | Register the new entity |
| 3 | `backend/src/modules/data-room/data-room.module.ts` | Create | NestJS module wiring |
| 4 | `backend/src/modules/data-room/data-room.controller.ts` | Create | REST endpoints — connect / callback / list / upload / download / disconnect |
| 5 | `backend/src/modules/data-room/data-room.service.ts` | Create | Orchestrates connection lifecycle, delegates Drive ops to `GoogleDriveService` |
| 6 | `backend/src/modules/data-room/google-drive.service.ts` | Create | Wraps `googleapis` — auth URL, token exchange, list / download / upload / refresh / revoke |
| 7 | `backend/src/modules/data-room/encryption.service.ts` | Create | AES-256-GCM credential encryption (key from env, KMS-ready) |
| 8 | `backend/src/modules/data-room/dto/*.ts` | Create | Validated payloads for connect-init and upload metadata |
| 9 | `backend/src/app.module.ts` | Modify | Register `DataRoomModule` |
| 10 | `backend/src/config/env.validation.ts` | Modify | Append `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `DATAROOM_ENCRYPTION_KEY` to the existing required-prod list (file already exists; uses a list-based validator that throws on missing vars) |
| 11 | `backend/.env.example` | Modify | Document the new env vars |
| 12 | `contracts/paths/data-room.yaml` | Create | OpenAPI spec for `/cases/:caseId/data-room/*` and the OAuth callback |
| 13 | `contracts/schemas/data-room.yaml` | Create | `DataRoomConnection`, `DataRoomFile`, request/response schemas |
| 14 | `contracts/openapi.yaml` | Modify | Reference the new paths + schemas |
| 15 | `frontend/src/app/cases/[caseId]/data-room/layout.tsx` | Create | Wraps `AuthGuard` |
| 16 | `frontend/src/app/cases/[caseId]/data-room/page.tsx` | Create | File browser — disconnected / connecting / connected / broken states |
| 17 | `frontend/src/lib/api-client.ts` | Modify | Add data-room methods |
| 18 | `backend/package.json` | Modify | Install `googleapis`, `busboy`, `@types/busboy` |
| 19 | Frontend case-level nav (file TBD during implementation) | Modify | Add "Data Room" link so users can reach `/cases/:caseId/data-room` |
| 20 | `backend/src/database/migrations/<ts>-AddDataRoomConnection.ts` | Create | Generated migration for the new table — required for prod deploy (dev relies on `synchronize`) |

---

## Data model

```
DataRoomConnection (one per case)
├── id                 UUID, PK
├── caseId             FK → Case (UNIQUE — enforces 1:1 with case)
├── provider           varchar, default 'google_drive'  ← forward-compat for future providers
├── credentialsCipher  bytea       ← AES-256-GCM ciphertext of { access_token, refresh_token, expiry, scope }
├── credentialsIv      bytea       ← per-row IV
├── credentialsAuthTag bytea       ← GCM auth tag
├── folderId           varchar     ← Drive folder ID (e.g. "0AAbc123...")
├── folderName         varchar     ← captured at connect time, for display
├── status             varchar     ← 'active' | 'broken' (token refresh failure)
├── createdAt          timestamp
└── updatedAt          timestamp
```

Cascade-delete on case deletion. On entity removal, the service **attempts** to revoke the token via Google's revoke endpoint, but always deletes the row regardless. Revoke failures (network error, already-revoked, refresh token rotated) are logged at warn level — failing to revoke shouldn't block the user from disconnecting locally. The Google account audit log will reflect the revoke attempt; users worried about residual access can manually remove the app from `myaccount.google.com/permissions`.

## Encryption

`EncryptionService` reads `DATAROOM_ENCRYPTION_KEY` (32-byte hex, generated via `openssl rand -hex 32`) from env. Uses `crypto.createCipheriv('aes-256-gcm', key, iv)`. Per-row IV (12 bytes random). Stores `(ciphertext, iv, authTag)` separately on the entity.

For prod: store the key in Google Secret Manager, expose as a Cloud Run secret env var. Rotation requires re-encrypting all rows with the new key — out of scope for this plan, but the service is structured to support it (key versioning is a TODO comment).

## OAuth flow

**Scopes:** `https://www.googleapis.com/auth/drive` (full read/write across the user's *entire* Drive). Required because users paste a folder URL — `drive.file` would only see files Daubert itself created, which doesn't fit this UX.

**Tradeoff:** the consent screen will say "See, edit, create, and delete all of your Google Drive files." That's broad. Two mitigations baked into this plan:
1. The connect button shows an explicit pre-OAuth modal: "Daubert will request access to your full Google Drive. It will only read or modify the folder you select for this case." Sets expectations before the consent screen.
2. The user can revoke at any time from `myaccount.google.com/permissions` — link this from the broken-state UI.

OAuth verification (Google's review process for sensitive scopes) is required for prod with multiple users — start the form during implementation; takes weeks. Until verified, users see Google's "this app isn't verified" warning during OAuth.

**Endpoints:**
- `POST /cases/:caseId/data-room/connect` — initiate. Generates a signed `state` token (HMAC of `{ caseId, nonce, ts }` using `DATAROOM_ENCRYPTION_KEY` for the secret), constructs Google's consent URL with `redirect_uri=$BACKEND/data-room/oauth-callback`, returns `{ url }`. Frontend does `window.location = url`. **No rate limit in v1** — low risk because the endpoint just builds a URL (doesn't call Google), but worth a per-user limit (e.g., 10/min) before opening to outside users. Flagged in Future.
- `GET /data-room/oauth-callback?code=...&state=...` — callback. **Decorated with `@Public()`** to bypass the global `AuthGuard` — Google can't send a Firebase token, so this endpoint authenticates via the HMAC `state` parameter instead. **Not case-scoped in the path** (Google requires a fixed `redirect_uri`). Verifies HMAC + nonce + timestamp (≤10min old), extracts `caseId`, exchanges `code` for tokens, fetches folder name from Drive, encrypts tokens, upserts `DataRoomConnection`. 302-redirects to `$FRONTEND/cases/{caseId}/data-room`.

**State parameter** is the auth + CSRF protection for the callback. The HMAC stops attackers from forging `state`; the timestamp limits the replay window; the nonce gives the state uniqueness for downstream auditing.

**Nonce storage:** v1 does **not** track used nonces in a store. The 10-minute replay window is acceptable because Google's authorization codes are themselves single-use — a replayed `state` carrying the same `code` will fail at Google's `exchangeCode` step ("invalid_grant"). The HMAC + timestamp window blocks tampering and bounds replay; Google blocks code reuse. If we ever need true single-use state, add a Redis SET with TTL=10min keyed by nonce. Flagged in Future.

**Folder selection** happens *after* OAuth completes:
1. User clicks "Connect Google Drive" — OAuth happens.
2. Backend stores tokens with `folderId = null`.
3. Frontend lands on the data room page, sees connection without folder, shows folder URL paste field.
4. User pastes a Drive folder URL (e.g., `https://drive.google.com/drive/folders/0AAbc123...`).
5. Frontend extracts the ID client-side (regex), sends `PATCH /cases/:caseId/data-room/folder` with `{ folderId }`.
6. Backend validates by calling Drive's `files.get(folderId)` — confirms access + captures `folderName`.

This avoids the JS picker dependency and keeps the connect flow simple.

## Token refresh

Every Drive API call routes through `GoogleDriveService` which checks expiry first:

```
async withFreshTokens(connection, fn):
  if connection.expiry < now() + 60s:
    try refresh; persist new tokens
    on failure: mark connection.status = 'broken', throw
  decrypt access_token, call fn(token)
  on 401 from Google: refresh once, retry; if still 401, mark broken
```

`status='broken'` shows a "Reconnect" banner on the frontend.

**TOCTOU concern — concurrent refresh.** If two requests arrive simultaneously and both see expired tokens, naive code would call refresh twice. Google's refresh tokens are single-use when rotation is enabled — the second call gets `invalid_grant` and that connection is now permanently broken. Fix: cache the in-flight refresh promise on a per-connection basis.

```
private refreshInFlight = new Map<string, Promise<Tokens>>();

async refreshIfNeeded(connection):
  const key = connection.id;
  if (this.refreshInFlight.has(key)) return this.refreshInFlight.get(key);
  const p = this.doRefresh(connection).finally(() => this.refreshInFlight.delete(key));
  this.refreshInFlight.set(key, p);
  return p;
```

Concurrent callers with the same connection ID await the same promise; only one refresh hits Google. Per-instance only — across multiple Cloud Run instances this can still race, but the blast radius is limited and refresh-token-rotation in Drive is configurable (we leave it on for security; accept the rare cross-instance race as a self-healing reconnect).

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/cases/:caseId/data-room/connect` | Initiate OAuth — returns redirect URL |
| `GET`  | `/data-room/oauth-callback` | OAuth callback (single registered redirect URI) |
| `GET`  | `/cases/:caseId/data-room` | Get connection state |
| `PATCH`| `/cases/:caseId/data-room/folder` | Set/change the connected folder |
| `GET`  | `/cases/:caseId/data-room/files` | List files in the folder (flat) |
| `GET`  | `/cases/:caseId/data-room/files/:fileId/download` | Stream-proxy a file from Drive |
| `POST` | `/cases/:caseId/data-room/files` | Upload a file (multipart) |
| `DELETE` | `/cases/:caseId/data-room` | Disconnect — revoke token + delete connection row |

All case-scoped endpoints use `CaseMemberGuard`. Owner can connect/disconnect/upload; guest can list/download (deny upload + connect/disconnect for guests in the controller — explicit `if role === 'guest' throw ForbiddenException` for write ops).

## Frontend

`/cases/[caseId]/data-room/page.tsx` — single page, four states driven by `useEffect`-fetched connection data:

1. **Disconnected** (no connection row) — single "Connect Google Drive" button.
2. **No folder** (connection exists, `folderId === null`) — paste a Drive folder URL, click "Set folder".
3. **Connected** — file table (name, type, size, modified, actions). Upload button. "Disconnect" in a corner.
4. **Broken** (`status === 'broken'`) — banner: "Connection lost. Please reconnect." + "Reconnect" button (re-runs OAuth, upserts on the same row).

File preview: click a file → opens Drive's web viewer (`https://drive.google.com/file/d/<id>/view`) in a new tab. No in-app PDF rendering for v1.

Upload: standard `<input type="file">` → POSTs multipart. Single file at a time. Show progress via `XMLHttpRequest` for upload progress events (fetch can't expose those reliably).

## Tasks

### Task 1 — Entity + Encryption + Env
**Files:** 1, 2, 7, 10, 11, 18

- Install `googleapis`, `busboy`, `@types/busboy`. (Bypassing multer entirely — see Task 4 upload streaming notes.)
- Create `DataRoomConnection` entity with the fields above. Mark `caseId` UNIQUE.
- Register in `entities/index.ts`.
- Create `EncryptionService` with `encrypt(plaintext: string)` returning `{ ciphertext, iv, authTag }` and `decrypt(...)` reversing.
- Add `DATAROOM_ENCRYPTION_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `FRONTEND_URL` (if not already present) to `env.validation.ts` (required in prod).
- Document in `.env.example`.
- Backend boots; entity gets auto-synced in dev. (Generate prod migration before prod deploy — separate step.)

### Task 2 — OpenAPI contracts
**Files:** 12, 13, 14

- `schemas/data-room.yaml`: `DataRoomConnection`, `DataRoomFile`, `ConnectInitResponse`, `SetFolderRequest`.
- `paths/data-room.yaml`: 8 endpoints listed above. Note that the OAuth callback returns 302; spec it with a `302` response and `Location` header.
- Wire into `openapi.yaml` (paths + schemas).
- Run `npm run gen`.

### Task 3 — `GoogleDriveService`
**Files:** 6

Pure provider class. No knowledge of `DataRoomConnection` — takes already-decrypted tokens. Methods:
- `getAuthUrl(state: string): string`
- `exchangeCode(code: string): Promise<TokenSet>`
- `refreshAccessToken(refreshToken: string): Promise<TokenSet>`
- `revokeToken(refreshToken: string): Promise<void>`
- `getFolder(accessToken: string, folderId: string): Promise<{ id, name }>`
- `listFiles(accessToken: string, folderId: string): Promise<DriveFile[]>`
- `downloadFile(accessToken: string, fileId: string): Promise<Readable>` — returns a stream
- `uploadFile(accessToken: string, folderId: string, name: string, mimeType: string, body: Readable): Promise<DriveFile>`

### Task 4 — `DataRoomService` + Controller + Module
**Files:** 3, 4, 5, 8, 9

- DTOs for connect-init and folder-set.
- `DataRoomService` orchestrates: signs/verifies HMAC state, encrypts/decrypts via `EncryptionService`, calls `GoogleDriveService`, manages `withFreshTokens` wrapper for refresh.
- Controller exposes the 8 endpoints. `CaseMemberGuard` on all case-scoped endpoints. The OAuth callback (`GET /data-room/oauth-callback`) is decorated with `@Public()` to bypass the global `AuthGuard` — Google can't send a Firebase token, so the HMAC `state` parameter is the auth instead. **Both decorators must be present**: `@Public()` (skips AuthGuard) + the controller method internally verifies HMAC. Drop either and you have a hole.
- **Guest-vs-owner check** on write endpoints. `CaseMemberGuard` already injects the resolved membership onto the request (look at `case-member.guard.ts` for the property name — likely `req.caseMembership`). Read `req.caseMembership.role` instead of re-querying `case_members`. Throw `ForbiddenException` for `'guest'` on `connect`, `setFolder`, `upload`, `disconnect`.
- **Downloads:** use NestJS `StreamableFile` to pipe Drive's response stream straight to the client. **Forward Drive's headers**: read `name` and `mimeType` from a `files.get(fileId, { fields: 'name, mimeType, size' })` call before initiating the download stream, then set `Content-Type: <mimeType>`, `Content-Disposition: attachment; filename="<sanitized name>"`, and `Content-Length: <size>` on the response. RFC 5987 encoding for the filename if it contains non-ASCII (`filename*=UTF-8''<percent-encoded>`).
- **Uploads:** bypass multer / `FileInterceptor` entirely. In the upload controller method, take `@Req() req` and run `busboy` directly. As soon as busboy emits the file event, hand the resulting `Readable` to `drive.files.create({ media: { mimeType, body: stream } })` — `googleapis` switches to a resumable upload automatically and pipes the body in 256KB chunks. Peak memory per upload is ~256KB regardless of file size. Enforce the 50MB cap via busboy's `limits.fileSize`. Reject multi-file uploads (`limits.files: 1`).
- Wire `DataRoomModule` into `AppModule`.

**Streaming upload sketch:**
```ts
@Post('files')
async upload(@Req() req: Request, @Param('caseId') caseId: string, @Res() res: Response) {
  const conn = await this.service.getConnection(caseId, req.user);
  const bb = busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

  // Helper: respond if we haven't already. Once googleapis starts streaming
  // upload chunks the response can't be safely flushed twice — guard every
  // res.* call with headersSent.
  const safeRespond = (status: number, body: unknown) => {
    if (res.headersSent) return;
    res.status(status).json(body);
  };

  bb.on('file', async (_field, fileStream, info) => {
    try {
      const driveFile = await this.service.uploadStream(conn, info.filename, info.mimeType, fileStream);
      safeRespond(200, driveFile);
    } catch (err) {
      fileStream.resume();  // drain to free the request socket
      safeRespond(500, { message: err.message });
    }
  });
  bb.on('limit', () => safeRespond(413, { message: 'File exceeds 50MB' }));
  bb.on('error', (err) => safeRespond(400, { message: `Malformed upload: ${err.message}` }));
  req.pipe(bb);
}
```
The `safeRespond` guard matters because once `drive.files.create` is mid-stream and an error throws, headers may already be flushed. Calling `res.json` again would crash the process. Same protection applies to `limit` and `error` events that can fire after partial transmission.

### Task 5 — Backend tests
**Files:** new spec files alongside the services

Three high-leverage unit-test surfaces. All can run in seconds; none need Drive credentials.

- **`encryption.service.spec.ts`** — round-trip a plaintext through encrypt/decrypt; verify ciphertext changes per call (random IV); verify decrypt with wrong key throws; verify decrypt with tampered authTag throws.
- **`data-room.service.spec.ts`** focused on HMAC `state`:
  - `signState({ caseId, nonce, ts })` produces a deterministic value for fixed inputs.
  - `verifyState(state)` accepts valid; rejects tampered HMAC, expired timestamp, and wrong-shape payloads.
  - The 10-minute window boundary is correctly inclusive on the recent side and exclusive on the stale side.
- **`google-drive.service.spec.ts`** — mock `googleapis` (not the entire library; just `drive.files.create / get / list` and the OAuth client). Verify:
  - `listFiles` requests the right `q=` filter (parent folder).
  - `uploadFile` passes the stream through; doesn't buffer.
  - `refreshAccessToken` retries on transient failure; gives up after N attempts.
  - The `refreshInFlight` promise cache de-duplicates concurrent callers (call `refreshIfNeeded` twice in parallel; assert only one underlying call).

This isn't exhaustive — Drive end-to-end is the smoke test (Task 11). These three guard the two pieces most likely to be subtly wrong: crypto and concurrency.

### Task 6 — API client
**Files:** 17

- `dataRoomConnect`, `dataRoomGet`, `dataRoomSetFolder`, `dataRoomListFiles`, `dataRoomDownload`, `dataRoomUpload` (uses `XMLHttpRequest` for progress), `dataRoomDisconnect`.
- For `connect`, the method returns the URL string from the backend; the caller does `window.location.href = url`.

### Task 7 — Frontend page
**Files:** 15, 16

- Layout wraps `AuthGuard`.
- Page implements the 4-state machine described above.
- Folder URL parser. Match strictly against `/^https?:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{20,})(?:[/?#].*)?$/` (handles `/folders/<id>`, `/folders/<id>?usp=...`, and multi-account `/drive/u/N/folders/<id>` variants). **Reject up-front** on empty string, missing `/folders/`, or non-Drive URLs — show "Please paste a Google Drive folder URL" without firing a backend request. Backend re-validates defensively + calls Drive's `files.get` for the real check.
- File list table with download buttons. Click name → opens Drive viewer in new tab.
- Upload form with progress bar.
- Disconnect confirmation modal.
- "Broken" state banner + reconnect button (re-runs OAuth on the same row).

### Task 8 — Token refresh + broken-state UX
**Files:** 5 (extend), 16 (extend)

- Confirm `withFreshTokens` wrapper handles all four cases: fresh, near-expiry (refresh), expired-401-from-Drive (refresh + retry), refresh-failed (mark broken + throw).
- Confirm the `refreshInFlight` promise cache de-duplicates concurrent refresh attempts (covered by Task 5 test, but also exercise via the broken-state UI path).
- Frontend handles the `status === 'broken'` state with a clear "Reconnect" affordance that re-runs the connect flow against the same connection row.

### Task 9 — Frontend navigation
**Files:** 19

- Find the case-level navigation (likely the case layout or sidebar component — `frontend/src/components/InvestigationsSidebar.tsx` or a `cases/[caseId]/layout.tsx` if one exists; verify during implementation).
- Add a "Data Room" link with appropriate icon (`react-icons/fa6` — `FaFolderOpen` or `FaCloudArrowUp`).
- Route: `/cases/${caseId}/data-room`.
- Highlight active route via `usePathname` (same pattern as the admin sidebar).
- Don't gate by role — guests can navigate to the page; the page handles read-only state internally.

### Task 10 — Generate prod migration
**Files:** 20

- After Task 1 lands and the entity is synced in dev, generate the migration for prod:
  ```bash
  ./migrations.sh --dev --generate AddDataRoomConnection
  ```
  (Per project rules: migrations are generated only via `./migrations.sh`. Generate-only — never apply. The user runs `./migrations.sh --prod --run` themselves before the prod deploy.)
- Inspect the generated SQL: should only create `data_room_connections` and its indexes/FKs. No drops, no surprise alterations to other tables.
- Commit the migration file.

### Task 11 — Smoke test
- Connect a real Drive account, paste a folder URL, list files, upload a file, download a file, disconnect.
- Verify revocation by visiting Google Account → Security → Third-party apps; "Daubert" should be gone (or absent if the revoke call failed — log inspection should show the warning).
- Force a token expiry (manually set `expiry` to past in DB) → next API call refreshes silently.
- Force a refresh failure (revoke from Google's side, then trigger any data-room request) → connection goes to `'broken'` state; UI shows reconnect.
- Confirm `@Public()` is correctly scoped: `GET /data-room/oauth-callback?code=junk&state=junk` should return 4xx (HMAC fails), not 401 from `AuthGuard`.
- Test upload error path: simulate a Drive API error mid-upload; verify the response doesn't crash the process (`res.headersSent` guard works).

---

## Resolved (recorded for posterity)

- **Scopes:** `https://www.googleapis.com/auth/drive` (full read/write).
- **Single provider only.** Dropbox dropped.
- **Folder selection:** paste Drive folder URL — no JS picker dep.
- **Agent tools:** deferred to a separate `DataRoomAgentTools.md` plan.
- **`provider` field retained** as forward-compat for re-introducing Dropbox/OneDrive/Box later.
- **Upload strategy:** streaming via `busboy` directly (no multer). Pipes the multipart stream into `drive.files.create` so peak memory per upload is ~256KB regardless of file size. 50MB cap enforced at busboy. Bypasses NestJS `FileInterceptor` (which is multer-based and would buffer).
- **Folder URL parsing:** hybrid. Frontend regex extracts the folder ID for instant UX feedback. Backend re-runs the regex defensively against the submitted ID, then validates by calling Drive's `files.get(folderId)` — the real source of truth. Reject if the API returns 404 or `mimeType !== 'application/vnd.google-apps.folder'` (with a useful "looks like a file, not a folder" error). Both sides handle multi-account URL variants (`/drive/u/N/folders/...`).
- **Audit logging:** structured logs to Cloud Logging now, app-level audit table deferred. Use NestJS's built-in `Logger` (no new dependency) with structured context objects:
  ```ts
  this.logger.log({ event: 'data_room.upload', userId, caseId, fileId, fileSize });
  ```
  Cloud Logging captures stdout JSON natively. **No `pino`** — adding a dep + `nestjs-pino` config for a handful of log lines isn't worth it; revisit if/when we want JSON-only output everywhere. File ID and size only, never file names (often PII). Compliance-grade audit logging gets its own follow-up plan paired with the AdminPanel audit logging that was deferred. When that lands, controllers add `await this.auditLog.record(...)` calls alongside the existing `logger.log` — small change, no architectural revisit.

## Future / TODO

- **Dropbox / OneDrive / Box.** Re-introduce the `StorageProvider` interface and implement second provider. The `provider` column on `DataRoomConnection` is already in place. Estimated 1-2 weeks.
- **Agent tools** — `read_dataroom_file` (download + extract text via `pdf-parse`/`mammoth`) and `create_dataroom_file` (upload generated content from agent). Own plan.
- **Subfolder navigation.** Currently flat listing of one folder; users may want to drill into subfolders.
- **Multi-file selection / batch ops.**
- **Drive verification.** Required for prod use with multiple users on `drive` scope. Start the form during this plan's implementation; verification takes weeks. Until verified, users will see Google's "this app isn't verified" warning during OAuth.
- **Encryption key rotation.** Re-encrypt all rows with new key. `EncryptionService` should be structured for key versioning (TODO comment in the code).
- **Compliance-grade audit logging.** Pairs with the AdminPanel audit logging deferred earlier. App-level `audit_events` table, queryable from the admin UI, with retention policy and PII review. If audit logs ever become litigation evidence, signed/append-only storage is the next step beyond that.
- **Upload performance.** If users start uploading hundreds of files concurrently and busboy on Express becomes a bottleneck, `@nestjs/platform-fastify` + `@fastify/multipart` has better streaming throughput. Multi-week swap, only worth it if metrics demand it.
- **Rate limiting on `POST /data-room/connect`.** Today, an authenticated user can spam this endpoint to generate consent URLs. Low risk because the endpoint just builds and returns a string — no Google API call, no token cost. Add a per-user limit (e.g., 10/min via `@nestjs/throttler`) before opening to outside users. Same throttler should also cover the OAuth callback (rate-limit by IP since the request is unauthenticated by Firebase).
- **Single-use OAuth state nonces.** v1 accepts the 10-minute replay window because Google's authorization codes are themselves single-use. If we ever want strict single-use state (defense in depth, audit trail of state issuance), add a Redis SET with TTL=10min keyed by nonce; reject duplicates at callback verification.

---

## Plan-level checklist

- [ ] Task 1 — Entity + Encryption + Env
- [ ] Task 2 — OpenAPI contracts
- [ ] Task 3 — `GoogleDriveService`
- [ ] Task 4 — `DataRoomService` + Controller + Module
- [ ] Task 5 — Backend tests
- [ ] Task 6 — API client
- [ ] Task 7 — Frontend page
- [ ] Task 8 — Token refresh + broken-state UX
- [ ] Task 9 — Frontend navigation
- [ ] Task 10 — Generate prod migration
- [ ] Task 11 — Smoke test
