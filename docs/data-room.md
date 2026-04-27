# Data Room

Per-case Google Drive integration for storing, browsing, uploading, and downloading case documents. Each case has at most one data room connection (1:1 relationship). Case owners manage the connection; all case members can browse and download files.

## Directory Structure

```
backend/src/modules/data-room/
├── data-room.module.ts        NestJS module
├── data-room.controller.ts    REST endpoints (9 operations)
├── data-room.service.ts       Orchestration, OAuth, token lifecycle
├── google-drive.service.ts    Google Drive API wrapper
├── encryption.service.ts      AES-256-GCM encryption for tokens at rest
└── dto/
    └── set-folder.dto.ts      Folder ID validation

frontend/src/
├── app/cases/[caseId]/data-room/
│   ├── page.tsx               Main data room UI (4-state machine)
│   └── layout.tsx             Layout wrapper
└── lib/
    └── google-picker.ts       Google Drive Picker SDK wrapper

contracts/
├── paths/data-room.yaml       Endpoint specs
└── schemas/data-room.yaml     Request/response DTOs
```

## Endpoints

All case-scoped endpoints are gated by `CaseMemberGuard` (Firebase auth). The OAuth callback is `@Public()` and authenticated via HMAC `state`.

| Method | Path | Purpose | Role |
|--------|------|---------|------|
| `POST` | `/cases/:caseId/data-room/connect` | Initiate OAuth, returns consent URL | Owner |
| `GET` | `/data-room/oauth-callback` | Google OAuth redirect target | Public (HMAC) |
| `GET` | `/cases/:caseId/data-room` | Get connection status | Any member |
| `PATCH` | `/cases/:caseId/data-room/folder` | Set or change connected folder | Owner |
| `GET` | `/cases/:caseId/data-room/files` | List files in folder (flat, max 100) | Any member |
| `GET` | `/cases/:caseId/data-room/files/:fileId/download` | Stream-proxy file from Drive | Any member |
| `POST` | `/cases/:caseId/data-room/files` | Upload file (multipart, 50MB max) | Owner |
| `GET` | `/cases/:caseId/data-room/access-token` | Short-lived token for Drive Picker | Owner |
| `DELETE` | `/cases/:caseId/data-room` | Disconnect and revoke token | Owner |

## Entity: `data_room_connections`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK (from BaseEntity) |
| `case_id` | UUID | FK -> cases, UNIQUE (1:1), CASCADE delete |
| `provider` | varchar | Default `'google_drive'` |
| `credentials_cipher` | bytea | AES-256-GCM ciphertext |
| `credentials_iv` | bytea | Random 12-byte IV per row |
| `credentials_auth_tag` | bytea | GCM auth tag |
| `folder_id` | varchar | Nullable. Drive folder ID |
| `folder_name` | varchar | Nullable. Display name from Drive |
| `status` | varchar | `'active'` or `'broken'` |
| `created_at` | timestamp | Auto (from BaseEntity) |
| `updated_at` | timestamp | Auto (from BaseEntity) |

The encrypted credentials store a JSON blob:

```json
{
  "accessToken": "ya29...",
  "refreshToken": "1//0gF...",
  "expiry": "2026-05-27T11:04:00.000Z",
  "scope": "https://www.googleapis.com/auth/drive"
}
```

Encryption key: `DATAROOM_ENCRYPTION_KEY` env var (32 bytes, hex-encoded). Generate with `openssl rand -hex 32`.

## OAuth Flow

1. Frontend calls `POST /cases/:caseId/data-room/connect`
2. Backend generates HMAC-SHA256 signed state: `base64url(caseId.nonce.timestamp.hmac)`
3. Returns Google OAuth consent URL with the `state` parameter
4. User grants access; Google redirects to `GET /data-room/oauth-callback?code=...&state=...`
5. Backend verifies HMAC signature, checks timestamp (10-minute TTL), extracts `caseId`
6. Exchanges authorization code for tokens, encrypts with AES-256-GCM, persists to DB
7. 302 redirects to `$FRONTEND_URL/cases/{caseId}/data-room`

The OAuth callback sits outside the `cases/:caseId/` prefix because Google's `redirect_uri` is fixed at registration time. The `caseId` rides inside the signed `state`.

Reconnecting an existing case overwrites the old credentials but preserves `folderId`/`folderName` so the user doesn't have to re-pick the folder.

## Folder Selection

Two paths depending on whether `NEXT_PUBLIC_DRIVE_PICKER_KEY` is configured:

- **With Picker** (preferred): Frontend calls `GET /access-token` to mint a short-lived token, opens the Google Drive Picker SDK, and sends the selection via `PATCH /folder`.
- **Without Picker** (fallback): The frontend shows a "Picker not configured" banner prompting the operator to set the env var.

The backend validates folder IDs with regex (`^[a-zA-Z0-9_-]{20,}$`) and confirms the Drive resource is actually a folder (`mimeType === 'application/vnd.google-apps.folder'`).

## Token Refresh and Broken State

Google rotates refresh tokens; concurrent refresh calls with the same token would permanently break the connection.

**De-duplication**: `DataRoomService` keeps a `Map<connectionId, Promise>` of in-flight refreshes. If a refresh is already running for a connection, all callers await the same promise.

**Refresh triggers**:
- Before every Drive API call, if expiry is within 60 seconds
- On 401 response from Drive, forces a single retry with fresh tokens
- If the retry also gets 401, marks `status = 'broken'`

**Broken state UX**:
- Yellow warning banner with explanation
- "Reconnect" button re-runs OAuth (overwrites credentials, preserves folder)
- "Disconnect" button removes the connection entirely
- Link to `myaccount.google.com/permissions` for manual revocation

## Upload / Download

### Upload (streaming)

Uses `busboy` directly instead of NestJS's `FileInterceptor` (multer) to avoid buffering the entire file in memory. The upload stream pipes directly into `drive.files.create`, which auto-switches to resumable upload in 256KB chunks. Peak memory is ~256KB regardless of file size.

- 50MB cap enforced at busboy `limits.fileSize`
- Single file per request (busboy `limits.files: 1`)
- `safeRespond` guard checks `res.headersSent` before responding (headers may flush during streaming)
- Frontend shows a progress bar via `XMLHttpRequest` upload events

### Download (streaming)

1. Fetches file metadata (`name`, `mimeType`, `size`) from Drive
2. Pipes Drive's stream response directly to the client via NestJS `StreamableFile`
3. Sets `Content-Type`, `Content-Disposition` (RFC 5987 for non-ASCII names), `Content-Length`

## Frontend UI States

The data room page is a 4-state machine:

| State | Condition | UI |
|-------|-----------|-----|
| **Disconnected** | No connection row | "Connect Google Drive" button with consent modal |
| **No Folder** | Connection exists, `folderId === null` | Google Drive Picker (or "not configured" banner) |
| **Connected** | Active connection with folder | File table, upload, download, change folder, disconnect |
| **Broken** | `status === 'broken'` | Yellow warning, reconnect/disconnect buttons |

## Role-Based Access

Write operations (connect, disconnect, upload, set folder) require `owner` role via `DataRoomService.requireOwner()`. Read operations (get connection, list files, download) are available to all case members including guests.

## Environment Variables

**Backend** (required in prod):

| Variable | Purpose |
|----------|---------|
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth2 app credentials |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth2 app credentials |
| `GOOGLE_OAUTH_REDIRECT_URI` | e.g. `https://api.daubert.com/data-room/oauth-callback` |
| `DATAROOM_ENCRYPTION_KEY` | 32 bytes hex (`openssl rand -hex 32`) |
| `FRONTEND_URL` | For OAuth callback redirect |

**Frontend** (optional):

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_DRIVE_PICKER_KEY` | Google API key for Drive Picker SDK |
