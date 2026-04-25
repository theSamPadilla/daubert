# Data Room

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/database/entities/data-room-connection.entity.ts` | Create | Entity: per-case OAuth connection to external storage |
| 2 | `backend/src/modules/data-room/data-room.module.ts` | Create | NestJS module registration |
| 3 | `backend/src/modules/data-room/data-room.controller.ts` | Create | REST endpoints: connect, disconnect, list/upload/download files |
| 4 | `backend/src/modules/data-room/data-room.service.ts` | Create | Orchestrates OAuth, delegates to providers, manages token refresh |
| 5 | `backend/src/modules/data-room/providers/google-drive.provider.ts` | Create | Google Drive API v3 integration |
| 6 | `backend/src/modules/data-room/providers/dropbox.provider.ts` | Create | Dropbox API v2 integration |
| 7 | `frontend/src/app/cases/[caseId]/data-room/page.tsx` | Create | File browser — connect, browse, upload, preview |
| 8 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Add `read_dataroom_file`, `create_dataroom_file` tools |
| 9 | `backend/src/prompts/investigator/` | Modify | Update system prompt with data room instructions |

---

## Data Model

```
DataRoomConnection (per-case)
├── id            UUID, PK, auto-generated
├── createdAt     timestamp
├── updatedAt     timestamp
├── provider      varchar             — "google_drive" | "dropbox"
├── credentials   JSONB, encrypted    — OAuth tokens (access_token, refresh_token, expiry)
├── folderPath    string              — root folder in the provider for this case
└── caseId        FK → Case           — cascade delete
```

No file entity. Files are listed dynamically from the provider API.
One connection per case (can extend to multiple later).

## OAuth Flow

1. User clicks "Connect Google Drive" (or Dropbox) from the Data Room page.
2. Backend initiates OAuth → redirects to provider → user authorizes.
3. Provider redirects back with auth code → backend exchanges for tokens → stores in `DataRoomConnection.credentials`.
4. Connection active. All file operations go through the provider API.

## Backend

**Endpoints:**
- `POST /cases/:caseId/data-room/connect` — initiate OAuth (returns redirect URL)
- `GET /cases/:caseId/data-room/callback` — OAuth callback, stores tokens
- `GET /cases/:caseId/data-room/files` — list files in connected folder
- `GET /cases/:caseId/data-room/files/:fileId` — download/preview a file
- `POST /cases/:caseId/data-room/files` — upload a file to connected folder
- `DELETE /cases/:caseId/data-room/disconnect` — remove connection

**Provider interface:**
```typescript
interface StorageProvider {
  listFiles(connection: DataRoomConnection, path?: string): Promise<FileEntry[]>
  downloadFile(connection: DataRoomConnection, fileId: string): Promise<Buffer>
  uploadFile(connection: DataRoomConnection, name: string, content: Buffer, mimeType: string): Promise<FileEntry>
  refreshTokens(connection: DataRoomConnection): Promise<Credentials>
}
```

Google Drive and Dropbox each implement this interface.

## Frontend

**Data Room page (`/cases/[caseId]/data-room`):**

Disconnected state:
- "Connect" buttons for Google Drive and Dropbox

Connected state:
- File browser: name, type, modified date, size
- Preview for supported types (PDF, images, spreadsheets)
- "Upload" button — manual control to push a Daubert artifact to the connected folder
- "Disconnect" option

## Agent Tools

**`read_dataroom_file`**
- Input: `{ caseId, fileId }`
- Temp-downloads from provider, extracts text (PDFs/docs) or returns raw content (spreadsheets)
- Used for AI to parse and act on uploaded documents

**`create_dataroom_file`**
- Input: `{ caseId, name, content, mimeType }`
- Uploads a file to the connected storage (e.g., agent generates a CSV export)
