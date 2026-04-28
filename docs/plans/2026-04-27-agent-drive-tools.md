# Agent Drive Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the AI investigator agent four new tools — `list_drive_files`, `read_drive_file`, `write_drive_file`, `update_drive_file` — so it can list, read, create, and overwrite files in the case's connected Google Drive folder. Owner-only writes (mirroring the HTTP controller). Hardened against Workspace-doc errors, fileIds outside the folder, and DB-history bloat.

**Architecture:** Most of the Drive plumbing already exists in `DataRoomService` (per-case auth, encrypted token refresh, retry-on-401). Three new methods get added: `updateFile` / `updateFromStream` (overwrite), `getFileParents` / `assertFileInFolder` (out-of-folder guard), and a Google-Workspace guard inside `getFileForDownload`. Then four thin tool dispatch cases in `AiService`. No schema changes, no migrations.

**Tech Stack:** NestJS, TypeORM, googleapis (already wired), Anthropic SDK tool-use blocks, Jest.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/ai/ai.module.ts` | Modify | Import `DataRoomModule` so `DataRoomService` is injectable into `AiService`. |
| 2 | `backend/src/modules/data-room/google-drive.service.ts` | Modify | Add `updateFile` (wraps `drive.files.update`) and `getFileParents` (wraps `drive.files.get` with `fields: 'parents'`). |
| 3 | `backend/src/modules/data-room/google-drive.service.spec.ts` | Modify | Cover `updateFile` and `getFileParents`. |
| 4 | `backend/src/modules/data-room/data-room.service.ts` | Modify | Add `updateFromStream` and `assertFileInFolder`. Add Google-Workspace mime check inside `getFileForDownload`. |
| 5 | `backend/src/modules/data-room/data-room.service.spec.ts` | Modify | Real `updateFromStream` + `assertFileInFolder` tests with mocked connection/encryption (no thin existence check). |
| 6 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Add four Anthropic tool schemas: `LIST_DRIVE_FILES_TOOL`, `READ_DRIVE_FILE_TOOL`, `WRITE_DRIVE_FILE_TOOL`, `UPDATE_DRIVE_FILE_TOOL`. |
| 7 | `backend/src/modules/ai/tools/index.ts` | Modify | Re-export the four new tools and register them in `AGENT_TOOLS`. |
| 8 | `backend/src/modules/ai/tools/drive-content.ts` | Create | Helper: text-vs-binary mime detection + bounded UTF-8 decode of a Drive download stream. Destroys stream on binary or truncation paths to release the HTTP connection. |
| 9 | `backend/src/modules/ai/tools/drive-content.spec.ts` | Create | Unit tests: text/binary classification, size cap clamp, stream destruction. |
| 10 | `backend/src/modules/ai/ai.service.ts` | Modify | Inject `DataRoomService` + `CaseAccessService`; thread `userId` into `executeTool`; add four dispatch cases; add `executeListDriveFiles` / `executeReadDriveFile` / `executeWriteDriveFile` / `executeUpdateDriveFile` + `assertCaseOwner` + `assertFileInConnectedFolder` helpers; `driveErrorPayload` switches to `instanceof` first, then narrows by code. Update `slimToolResult` to drop `content` from `read_drive_file` results. |
| 11 | `backend/src/prompts/investigator.ts` | Modify | List the four new tools so the agent knows when to use them. |
| 12 | `backend/src/skills/product-knowledge.md` | Modify | Add Drive tools to the AI Assistant capabilities section so the loaded skill matches reality. |

**User-facing change:** The agent (for case owners) can list, read, create, and update files in the case's Drive folder. Guest users see a clear permission error on write/update; reads remain available. Google Docs/Sheets/Slides surface a friendly "open in Drive or export to text first" message instead of an opaque googleapis error.

**Dev-facing change:** Three new `DataRoomService`/`GoogleDriveService` methods, a Workspace guard, four entries in the agent tool registry, an owner-role check in the AI dispatch path, and slimmer DB-persisted tool history.

---

## Design notes (read before starting)

**Per-case scoping is automatic.** `executeTool` already receives `caseId`. `DataRoomService` methods all key off `caseId`. The agent literally cannot escape its case.

**Owner-only writes.** The HTTP controller calls `DataRoomService.requireOwner(role)` before upload/update. The AI dispatch path bypasses HTTP, so we re-check role-by-userId in `AiService` for `write_drive_file` and `update_drive_file`. Reads remain open to all members. The `userId` is already present in `streamChat` — we thread it into `executeTool`. `CaseAccessService.assertAccess({kind:'user', userId}, caseId)` returns the `CaseMemberEntity`; we then call the existing `DataRoomService.requireOwner(membership.role)` static.

**fileId outside the connected folder.** The Drive token has full `auth/drive` scope. A hallucinated or stale fileId could read/write outside the case's folder. Mitigation: before `read_drive_file` and `update_drive_file`, fetch the file's parents via `drive.files.get(fileId, { fields: 'parents' })` and verify the connected folderId is one of them. Adds one Drive call per read/update; cheap and defends against drift.

**Google Workspace files.** `drive.files.get(alt:'media')` 400s for `application/vnd.google-apps.*` types — they need `files.export`. We don't add export support in this plan; instead, `getFileForDownload` short-circuits with a `BadRequestException('google_workspace_file')` after the metadata fetch (before the failing download call). The dispatch maps it to a friendly message.

**Update vs upload semantics.** Drive's `files.update` replaces the file's content in place — same `fileId`, same parent. The agent uses it to iterate on a saved artefact (mirrors how `update_production` is used today). It does NOT take a `parents` array, so we don't need a folder check on the update call itself — but we DO assert via `assertFileInConnectedFolder` to prevent out-of-folder writes.

**Binary vs text on read.** Tool results are JSON-stringified into the conversation. Putting raw binary in there will blow up context and confuse the model. Rule:

- **Text MIME types** (`text/*`, `application/json`, `application/xml`, `application/csv`): decode UTF-8, return up to `maxBytes` (default 100_000) of text. Truncate with a marker if longer. Destroy the stream on the truncation break to release the HTTP connection.
- **PDF / XLSX / images / everything else**: return `{ error: 'binary_content', mimeType, size, hint: 'Ask the user to attach this file to the chat instead.' }`. Destroy the stream without consuming it.

**Write/update encoding.** Both `write_drive_file` and `update_drive_file` accept `{ ..., content, encoding }` where `encoding` is `'utf8' | 'base64'`. Default `'utf8'`.

**DB persistence — slim read_drive_file.** A 100KB file dumped into a tool result hits the messages table verbatim and reloads on every subsequent turn. Mirror the existing production-slimming pattern: in `slimToolResult`, when the tool name is `read_drive_file`, strip the `content` field but keep `{ name, mimeType, size, truncated }`. The agent can re-call to get the body if it later needs it.

**Errors via `instanceof` first.** `driveErrorPayload` should check the NestJS exception class (`NotFoundException`, `BadRequestException`, `ServiceUnavailableException`) BEFORE narrowing by message string. That way a typo in a message string fails noisily instead of silently falling through to the generic case.

---

### Task 1: Wire `DataRoomModule` into `AiModule`

**Files:**
- Modify: `backend/src/modules/ai/ai.module.ts`

**Step 1: Import `DataRoomModule`**

```typescript
import { DataRoomModule } from '../data-room/data-room.module';
```

Add `DataRoomModule` to the `imports` array. `AuthModule` (already imported) exports `CaseAccessService`, so no extra import needed for the role check.

**Step 2: Build to confirm DI**

Run: `npm run build --prefix backend`
Expected: clean.

**Step 3: Commit**

```bash
git add backend/src/modules/ai/ai.module.ts
git commit -m "wire DataRoomModule into AiModule"
```

---

### Task 2: Drive plumbing — `updateFile`, `getFileParents`, `updateFromStream`, `assertFileInFolder`, Workspace guard (TDD)

**Files:**
- Modify: `backend/src/modules/data-room/google-drive.service.ts`
- Modify: `backend/src/modules/data-room/google-drive.service.spec.ts`
- Modify: `backend/src/modules/data-room/data-room.service.ts`
- Modify: `backend/src/modules/data-room/data-room.service.spec.ts`

**Step 1: Add failing tests for `GoogleDriveService.updateFile` and `getFileParents`**

In `google-drive.service.spec.ts`:

- Add to top-level mocks (near existing `mockFilesCreate`):

```typescript
const mockFilesUpdate = jest.fn();
```

- Extend the `jest.mock('googleapis', ...)` `files` object with `update: mockFilesUpdate`.

- Append new describe blocks:

```typescript
describe('updateFile', () => {
  it('passes fileId and Readable stream to drive.files.update', async () => {
    mockFilesUpdate.mockResolvedValue({
      data: {
        id: 'existing-id',
        name: 'report.md',
        mimeType: 'text/markdown',
        size: '42',
      },
    });
    const stream = Readable.from(['updated body']);
    const svc = makeService();
    const result = await svc.updateFile(
      'access-token',
      'existing-id',
      'text/markdown',
      stream,
    );
    expect(mockFilesUpdate).toHaveBeenCalledTimes(1);
    const args = mockFilesUpdate.mock.calls[0][0];
    expect(args.fileId).toBe('existing-id');
    expect(args.media.mimeType).toBe('text/markdown');
    expect(args.media.body).toBe(stream);
    expect(args.supportsAllDrives).toBe(true);
    expect(result).toEqual({
      id: 'existing-id',
      name: 'report.md',
      mimeType: 'text/markdown',
      size: '42',
      modifiedTime: undefined,
      webViewLink: undefined,
    });
  });
});

describe('getFileParents', () => {
  it('returns parents array from drive.files.get', async () => {
    mockFilesGet.mockResolvedValue({ data: { parents: ['folder-1', 'folder-2'] } });
    const svc = makeService();
    const parents = await svc.getFileParents('access-token', 'file-1');
    expect(mockFilesGet).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file-1',
        fields: 'parents',
        supportsAllDrives: true,
      }),
    );
    expect(parents).toEqual(['folder-1', 'folder-2']);
  });

  it('returns [] when Drive omits parents', async () => {
    mockFilesGet.mockResolvedValue({ data: {} });
    const svc = makeService();
    expect(await svc.getFileParents('access-token', 'file-1')).toEqual([]);
  });
});
```

Run: `npm test --prefix backend -- google-drive.service`
Expected: FAIL — methods don't exist.

**Step 2: Implement `updateFile` and `getFileParents`**

In `google-drive.service.ts`, below `uploadFile` (around line 237):

```typescript
async updateFile(
  accessToken: string,
  fileId: string,
  mimeType: string,
  body: Readable,
): Promise<DriveFile> {
  const drive = this.drive(accessToken);
  const { data } = await drive.files.update({
    fileId,
    media: { mimeType, body },
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return this.toDriveFile(data);
}

async getFileParents(accessToken: string, fileId: string): Promise<string[]> {
  const drive = this.drive(accessToken);
  const { data } = await drive.files.get({
    fileId,
    fields: 'parents',
    supportsAllDrives: true,
  });
  return data.parents ?? [];
}
```

Run: `npm test --prefix backend -- google-drive.service`
Expected: PASS.

**Step 3: Add the Workspace guard inside `getFileForDownload`**

In `data-room.service.ts:253`, add the mime check between metadata and download:

```typescript
async getFileForDownload(
  caseId: string,
  fileId: string,
): Promise<{ stream: Readable; name: string; mimeType: string; size: string }> {
  const conn = await this.requireConnection(caseId);
  return this.withFreshTokens(conn, async (token) => {
    const meta = await this.googleDrive.getFileMetadata(token, fileId);
    if (meta.mimeType.startsWith('application/vnd.google-apps.')) {
      // Native Workspace docs (Docs/Sheets/Slides) can't be downloaded with
      // alt=media — they need files.export with a target mime. Surface as a
      // structured BadRequest so the AI dispatch maps it to a clear message.
      throw new BadRequestException('google_workspace_file');
    }
    const stream = await this.googleDrive.downloadFile(token, fileId);
    this.logger.log(`download caseId=${caseId} fileId=${fileId} size=${meta.size}`);
    return { stream, ...meta };
  });
}
```

**Step 4: Add real `updateFromStream` and `assertFileInFolder` tests (replacing the placeholder)**

In `data-room.service.spec.ts`, extend the `mockGoogleDrive` mock harness:

```typescript
const mockGoogleDrive = {
  getAuthUrl: jest.fn(),
  exchangeCode: jest.fn(),
  refreshAccessToken: jest.fn(),
  revokeToken: jest.fn(),
  getFolder: jest.fn(),
  listFiles: jest.fn(),
  getFileMetadata: jest.fn(),
  downloadFile: jest.fn(),
  uploadFile: jest.fn(),
  updateFile: jest.fn(),
  getFileParents: jest.fn(),
};
```

Refactor `buildService` to also return the mocks (so tests can assert on them):

```typescript
async function buildService(): Promise<{
  service: DataRoomService;
  mocks: {
    repo: typeof mockRepo;
    encryption: typeof mockEncryption;
    googleDrive: typeof mockGoogleDrive;
  };
}> {
  // ...existing setup...
  return {
    service: moduleRef.get<DataRoomService>(DataRoomService),
    mocks: { repo: mockRepo, encryption: mockEncryption, googleDrive: mockGoogleDrive },
  };
}
```

(All existing tests that destructure `service` need a one-line update: `const { service } = await buildService();`. Touch only the destructure, not the test bodies.)

Append two new describe blocks at the bottom:

```typescript
describe('updateFromStream', () => {
  it('decrypts tokens, calls googleDrive.updateFile, and returns the DriveFile', async () => {
    const { service, mocks } = await buildService();

    const conn = {
      id: 'conn-1',
      caseId: 'case-1',
      folderId: 'folder-1',
      credentialsCipher: 'cipher',
      credentialsIv: 'iv',
      credentialsAuthTag: 'tag',
      status: 'active',
    };
    mocks.repo.findOneBy.mockResolvedValue(conn);
    mocks.encryption.decrypt.mockReturnValue(
      JSON.stringify({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
        scope: 'https://www.googleapis.com/auth/drive',
      }),
    );
    mocks.googleDrive.updateFile.mockResolvedValue({
      id: 'f1',
      name: 'r.md',
      mimeType: 'text/markdown',
      size: '5',
    });

    const stream = Readable.from(['hello']);
    const result = await service.updateFromStream(
      'case-1',
      'f1',
      'text/markdown',
      stream,
    );

    expect(mocks.googleDrive.updateFile).toHaveBeenCalledWith(
      'access',
      'f1',
      'text/markdown',
      stream,
    );
    expect(result).toEqual({
      id: 'f1',
      name: 'r.md',
      mimeType: 'text/markdown',
      size: '5',
    });
  });

  it('throws NotFoundException when no connection exists', async () => {
    const { service, mocks } = await buildService();
    mocks.repo.findOneBy.mockResolvedValue(null);
    await expect(
      service.updateFromStream('case-1', 'f1', 'text/markdown', Readable.from(['x'])),
    ).rejects.toThrow('connection_not_found');
  });
});

describe('assertFileInFolder', () => {
  it('passes when file parent matches the connected folder', async () => {
    const { service, mocks } = await buildService();
    mocks.repo.findOneBy.mockResolvedValue({
      id: 'conn-1',
      caseId: 'case-1',
      folderId: 'folder-1',
      credentialsCipher: 'c',
      credentialsIv: 'i',
      credentialsAuthTag: 't',
      status: 'active',
    });
    mocks.encryption.decrypt.mockReturnValue(
      JSON.stringify({
        accessToken: 'access',
        refreshToken: 'r',
        expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
        scope: 'x',
      }),
    );
    mocks.googleDrive.getFileParents.mockResolvedValue(['folder-1']);

    await expect(service.assertFileInFolder('case-1', 'f1')).resolves.toBeUndefined();
  });

  it('throws BadRequestException("file_outside_folder") when parent does not match', async () => {
    const { service, mocks } = await buildService();
    mocks.repo.findOneBy.mockResolvedValue({
      id: 'conn-1',
      caseId: 'case-1',
      folderId: 'folder-1',
      credentialsCipher: 'c',
      credentialsIv: 'i',
      credentialsAuthTag: 't',
      status: 'active',
    });
    mocks.encryption.decrypt.mockReturnValue(
      JSON.stringify({
        accessToken: 'access',
        refreshToken: 'r',
        expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
        scope: 'x',
      }),
    );
    mocks.googleDrive.getFileParents.mockResolvedValue(['some-other-folder']);

    await expect(service.assertFileInFolder('case-1', 'f1')).rejects.toThrow(
      'file_outside_folder',
    );
  });

  it('throws BadRequestException("folder_not_set") when no folder is selected', async () => {
    const { service, mocks } = await buildService();
    mocks.repo.findOneBy.mockResolvedValue({
      id: 'conn-1',
      caseId: 'case-1',
      folderId: null,
      credentialsCipher: 'c',
      credentialsIv: 'i',
      credentialsAuthTag: 't',
      status: 'active',
    });
    await expect(service.assertFileInFolder('case-1', 'f1')).rejects.toThrow(
      'folder_not_set',
    );
  });
});
```

Run: `npm test --prefix backend -- data-room.service`
Expected: FAIL — `updateFromStream` / `assertFileInFolder` don't exist.

**Step 5: Implement `updateFromStream` and `assertFileInFolder`**

In `data-room.service.ts`, below `uploadFromStream` (around line 287):

```typescript
async updateFromStream(
  caseId: string,
  fileId: string,
  mimeType: string,
  stream: Readable,
): Promise<DriveFile> {
  const conn = await this.requireConnection(caseId);
  const file = await this.withFreshTokens(conn, (token) =>
    this.googleDrive.updateFile(token, fileId, mimeType, stream),
  );
  this.logger.log(`update caseId=${caseId} fileId=${file.id} size=${file.size ?? '?'}`);
  return file;
}

async assertFileInFolder(caseId: string, fileId: string): Promise<void> {
  const conn = await this.requireConnection(caseId);
  if (!conn.folderId) {
    throw new BadRequestException('folder_not_set');
  }
  const parents = await this.withFreshTokens(conn, (token) =>
    this.googleDrive.getFileParents(token, fileId),
  );
  if (!parents.includes(conn.folderId as string)) {
    throw new BadRequestException('file_outside_folder');
  }
}
```

Run: `npm test --prefix backend -- data-room.service`
Expected: PASS.

**Step 6: Build and commit**

Run: `npm run build --prefix backend`

```bash
git add backend/src/modules/data-room/google-drive.service.ts \
        backend/src/modules/data-room/google-drive.service.spec.ts \
        backend/src/modules/data-room/data-room.service.ts \
        backend/src/modules/data-room/data-room.service.spec.ts
git commit -m "add updateFile, getFileParents, updateFromStream, assertFileInFolder, Workspace guard"
```

---

### Task 3: Add the four agent tool definitions

**Files:**
- Modify: `backend/src/modules/ai/tools/tool-definitions.ts`

**Step 1: Append the four schemas at the bottom**

```typescript
// ---------- Data Room (Google Drive) ----------

export const LIST_DRIVE_FILES_TOOL: Anthropic.Tool = {
  name: 'list_drive_files',
  description:
    "List files in the case's connected Google Drive folder. Returns id, name, mimeType, size, and modifiedTime for each file. Errors if no Drive is connected or no folder is selected — surface that to the user and ask them to connect a folder via the data room UI.",
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export const READ_DRIVE_FILE_TOOL: Anthropic.Tool = {
  name: 'read_drive_file',
  description:
    "Read the contents of a file from the case's Drive folder. Works for text-like files (text/*, application/json, application/xml, CSV) — returns decoded UTF-8 text up to maxBytes. Native Google Workspace docs (Docs/Sheets/Slides) and binary files (PDF, XLSX, images, etc.) return a structured error with a clear next step. Use list_drive_files first to get fileIds.",
  input_schema: {
    type: 'object' as const,
    properties: {
      fileId: { type: 'string', description: 'The Google Drive file ID (from list_drive_files).' },
      maxBytes: { type: 'number', description: 'Cap on returned text length. Default 100000. Hard max 500000.' },
    },
    required: ['fileId'],
  },
};

export const WRITE_DRIVE_FILE_TOOL: Anthropic.Tool = {
  name: 'write_drive_file',
  description:
    "Create a new file in the case's connected Drive folder. Use to save reports, exports, or generated artefacts. Always creates a new file — to overwrite an existing one, use update_drive_file. Owner-only: guests will receive a permission error. Returns the created file's id, name, mimeType, size, and webViewLink.",
  input_schema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'File name including extension (e.g. "summary.md").' },
      mimeType: { type: 'string', description: 'MIME type (e.g. "text/markdown", "text/csv", "application/json").' },
      content: { type: 'string', description: 'File content. UTF-8 string by default; base64-encoded if encoding="base64".' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Encoding of `content`. Default "utf8". Use "base64" for binary uploads.' },
    },
    required: ['name', 'mimeType', 'content'],
  },
};

export const UPDATE_DRIVE_FILE_TOOL: Anthropic.Tool = {
  name: 'update_drive_file',
  description:
    "Replace the contents of an existing file in the case's Drive folder. Use to iteratively refine a saved artefact (e.g. update a markdown summary as new findings come in) instead of creating a new file each time. Owner-only. The fileId must belong to the connected folder. Returns the updated file metadata.",
  input_schema: {
    type: 'object' as const,
    properties: {
      fileId: { type: 'string', description: 'The Google Drive file ID to overwrite.' },
      mimeType: { type: 'string', description: 'MIME type of the new content. Should match the file\'s existing type.' },
      content: { type: 'string', description: 'New file content. UTF-8 by default; base64 if encoding="base64".' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Encoding of `content`. Default "utf8".' },
    },
    required: ['fileId', 'mimeType', 'content'],
  },
};
```

**Step 2: Build and commit**

Run: `npm run build --prefix backend`

```bash
git add backend/src/modules/ai/tools/tool-definitions.ts
git commit -m "define list/read/write/update_drive_file agent tools"
```

---

### Task 4: Register the new tools in `AGENT_TOOLS`

**Files:**
- Modify: `backend/src/modules/ai/tools/index.ts`

Add the four constants to both export blocks AND to `AGENT_TOOLS`. Identical pattern to the existing entries.

Build, commit:

```bash
git add backend/src/modules/ai/tools/index.ts
git commit -m "register drive tools in AGENT_TOOLS"
```

---

### Task 5: Add the text-vs-binary decode helper, with stream destruction (TDD)

**Files:**
- Create: `backend/src/modules/ai/tools/drive-content.ts`
- Create: `backend/src/modules/ai/tools/drive-content.spec.ts`

**Step 1: Write the failing test**

Create `drive-content.spec.ts`:

```typescript
import { Readable } from 'stream';
import {
  decodeDriveStream,
  isTextLikeMime,
  MAX_READ_BYTES,
} from './drive-content';

function streamFrom(buf: Buffer): Readable {
  return Readable.from([buf]);
}

describe('isTextLikeMime', () => {
  it.each([
    ['text/plain', true],
    ['text/markdown', true],
    ['text/csv', true],
    ['application/json', true],
    ['application/xml', true],
    ['application/csv', true],
    ['application/pdf', false],
    ['image/png', false],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false],
    ['application/vnd.google-apps.document', false],
  ])('%s -> %s', (mime, expected) => {
    expect(isTextLikeMime(mime)).toBe(expected);
  });
});

describe('decodeDriveStream', () => {
  it('returns decoded text for text-like mime under the cap', async () => {
    const text = 'hello, drive';
    const result = await decodeDriveStream(streamFrom(Buffer.from(text)), 'text/plain', 1000);
    expect(result).toEqual({ kind: 'text', content: text, truncated: false });
  });

  it('truncates text past maxBytes and marks truncated=true', async () => {
    const text = 'a'.repeat(500);
    const result = await decodeDriveStream(streamFrom(Buffer.from(text)), 'text/plain', 100);
    expect(result.kind).toBe('text');
    if (result.kind === 'text') {
      expect(result.content.length).toBe(100);
      expect(result.truncated).toBe(true);
    }
  });

  it('clamps maxBytes to MAX_READ_BYTES', async () => {
    const text = 'a'.repeat(MAX_READ_BYTES + 1000);
    const result = await decodeDriveStream(
      streamFrom(Buffer.from(text)),
      'text/plain',
      MAX_READ_BYTES + 999_999,
    );
    if (result.kind === 'text') {
      expect(result.content.length).toBe(MAX_READ_BYTES);
      expect(result.truncated).toBe(true);
    }
  });

  it('returns kind=binary and destroys the stream for non-text mime', async () => {
    const stream = streamFrom(Buffer.from('PDFDATA'));
    const destroySpy = jest.spyOn(stream, 'destroy');
    const result = await decodeDriveStream(stream, 'application/pdf', 1000);
    expect(result).toEqual({ kind: 'binary' });
    expect(destroySpy).toHaveBeenCalled();
  });

  it('destroys the stream after a truncation break', async () => {
    const stream = streamFrom(Buffer.from('a'.repeat(500)));
    const destroySpy = jest.spyOn(stream, 'destroy');
    await decodeDriveStream(stream, 'text/plain', 100);
    expect(destroySpy).toHaveBeenCalled();
  });
});
```

Run: `npm test --prefix backend -- drive-content`
Expected: FAIL.

**Step 2: Implement the helper with stream destruction**

Create `drive-content.ts`:

```typescript
import { Readable } from 'stream';

export const MAX_READ_BYTES = 500_000;
export const DEFAULT_READ_BYTES = 100_000;

const TEXT_LIKE_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/csv',
  'application/javascript',
  'application/typescript',
]);

export function isTextLikeMime(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  return TEXT_LIKE_MIMES.has(mime);
}

export type DecodeResult =
  | { kind: 'text'; content: string; truncated: boolean }
  | { kind: 'binary' };

export async function decodeDriveStream(
  stream: Readable,
  mimeType: string,
  maxBytes: number,
): Promise<DecodeResult> {
  if (!isTextLikeMime(mimeType)) {
    // Don't consume — just close. Releases the underlying HTTP socket so it
    // doesn't sit open until GC.
    stream.destroy();
    return { kind: 'binary' };
  }

  const cap = Math.min(Math.max(1, Math.floor(maxBytes)), MAX_READ_BYTES);
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (total + buf.length > cap) {
        chunks.push(buf.subarray(0, cap - total));
        total = cap;
        truncated = true;
        break;
      }
      chunks.push(buf);
      total += buf.length;
    }
  } finally {
    // After a break (or if the iterator throws), explicitly destroy so the
    // socket closes immediately rather than waiting on GC.
    stream.destroy();
  }

  return {
    kind: 'text',
    content: Buffer.concat(chunks).toString('utf8'),
    truncated,
  };
}
```

Run: `npm test --prefix backend -- drive-content`
Expected: PASS.

Commit:

```bash
git add backend/src/modules/ai/tools/drive-content.ts backend/src/modules/ai/tools/drive-content.spec.ts
git commit -m "add drive content decoding helper with stream destruction"
```

---

### Task 6: Inject services, thread `userId`, dispatch tools, slim DB persistence

**Files:**
- Modify: `backend/src/modules/ai/ai.service.ts`

**Step 1: Imports and constructor injection**

```typescript
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataRoomService } from '../data-room/data-room.service';
import { CaseAccessService } from '../auth/case-access.service';
import { decodeDriveStream, DEFAULT_READ_BYTES } from './tools/drive-content';
import { Readable } from 'stream';
```

Extend the `from './tools'` import block to include the four new tool constants.

In the `AiService` constructor, inject both new services:

```typescript
constructor(
  private readonly llm: AnthropicProvider,
  private readonly conversationsService: ConversationsService,
  private readonly scriptExecutionService: ScriptExecutionService,
  private readonly labeledEntitiesService: LabeledEntitiesService,
  private readonly productionsService: ProductionsService,
  private readonly dataRoomService: DataRoomService,
  private readonly caseAccessService: CaseAccessService,
  @InjectRepository(MessageEntity)
  private readonly messageRepo: Repository<MessageEntity>,
  // ...existing repos unchanged
) {}
```

**Step 2: Thread `userId` into `executeTool`**

Change the signature:

```typescript
private async executeTool(
  toolUse: Anthropic.ToolUseBlock,
  userId: string,
  caseId?: string,
  investigationId?: string,
): Promise<unknown> { ... }
```

Update the single call site in `streamChat` (around line 420):

```typescript
const result = await this.executeTool(toolUse, userId, caseId, investigationId);
```

`streamChat` already takes `userId`, so this is just plumbing.

**Step 3: Add the four dispatch cases**

Place AFTER the `UPDATE_PRODUCTION_TOOL.name` case and BEFORE `default:`:

```typescript
case LIST_DRIVE_FILES_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  return this.executeListDriveFiles(caseId);
}

case READ_DRIVE_FILE_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  const input = toolUse.input as { fileId: string; maxBytes?: number };
  if (!input.fileId) return { error: 'fileId is required' };
  return this.executeReadDriveFile(caseId, input.fileId, input.maxBytes);
}

case WRITE_DRIVE_FILE_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  const input = toolUse.input as {
    name: string; mimeType: string; content: string; encoding?: 'utf8' | 'base64';
  };
  if (!input.name || !input.mimeType || typeof input.content !== 'string') {
    return { error: 'name, mimeType, and content are required' };
  }
  return this.executeWriteDriveFile(
    userId, caseId, input.name, input.mimeType, input.content, input.encoding ?? 'utf8',
  );
}

case UPDATE_DRIVE_FILE_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  const input = toolUse.input as {
    fileId: string; mimeType: string; content: string; encoding?: 'utf8' | 'base64';
  };
  if (!input.fileId || !input.mimeType || typeof input.content !== 'string') {
    return { error: 'fileId, mimeType, and content are required' };
  }
  return this.executeUpdateDriveFile(
    userId, caseId, input.fileId, input.mimeType, input.content, input.encoding ?? 'utf8',
  );
}
```

**Step 4: Add the implementations + helpers**

Add to `AiService` (alongside `executeCaseDataTool`):

```typescript
/**
 * Throws ForbiddenException if userId is not the case owner. Used to gate
 * agent-driven Drive writes so the dispatch path matches the HTTP controller's
 * `DataRoomService.requireOwner` policy.
 */
private async assertCaseOwner(userId: string, caseId: string): Promise<void> {
  const membership = await this.caseAccessService.assertAccess(
    { kind: 'user', userId },
    caseId,
  );
  // assertAccess throws if the user isn't a member at all. requireOwner
  // throws if the role is 'guest'.
  DataRoomService.requireOwner(membership?.role);
}

private async executeListDriveFiles(caseId: string): Promise<unknown> {
  try {
    const files = await this.dataRoomService.listFiles(caseId);
    return files.map((f) => ({
      id: f.id, name: f.name, mimeType: f.mimeType,
      size: f.size, modifiedTime: f.modifiedTime,
    }));
  } catch (err) {
    return this.driveErrorPayload(err);
  }
}

private async executeReadDriveFile(
  caseId: string, fileId: string, maxBytes?: number,
): Promise<unknown> {
  try {
    // Defence-in-depth: the connected token has full Drive scope, so a
    // hallucinated fileId could otherwise read anywhere in the user's Drive.
    await this.dataRoomService.assertFileInFolder(caseId, fileId);
    const { stream, name, mimeType, size } =
      await this.dataRoomService.getFileForDownload(caseId, fileId);
    const decoded = await decodeDriveStream(
      stream, mimeType, maxBytes ?? DEFAULT_READ_BYTES,
    );
    if (decoded.kind === 'binary') {
      return {
        error: 'binary_content',
        message:
          'This file is binary (PDF/XLSX/image/etc.) and cannot be returned as text. Ask the user to attach it directly to the chat using the paperclip icon.',
        name, mimeType, size,
      };
    }
    return {
      name, mimeType, size,
      truncated: decoded.truncated,
      content: decoded.content,
    };
  } catch (err) {
    return this.driveErrorPayload(err);
  }
}

private async executeWriteDriveFile(
  userId: string, caseId: string, name: string, mimeType: string,
  content: string, encoding: 'utf8' | 'base64',
): Promise<unknown> {
  try {
    await this.assertCaseOwner(userId, caseId);
    const buffer = encoding === 'base64'
      ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
    const stream = Readable.from(buffer);
    const file = await this.dataRoomService.uploadFromStream(
      caseId, name, mimeType, stream,
    );
    return {
      id: file.id, name: file.name, mimeType: file.mimeType,
      size: file.size, webViewLink: file.webViewLink,
    };
  } catch (err) {
    return this.driveErrorPayload(err);
  }
}

private async executeUpdateDriveFile(
  userId: string, caseId: string, fileId: string, mimeType: string,
  content: string, encoding: 'utf8' | 'base64',
): Promise<unknown> {
  try {
    await this.assertCaseOwner(userId, caseId);
    await this.dataRoomService.assertFileInFolder(caseId, fileId);
    const buffer = encoding === 'base64'
      ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
    const stream = Readable.from(buffer);
    const file = await this.dataRoomService.updateFromStream(
      caseId, fileId, mimeType, stream,
    );
    return {
      id: file.id, name: file.name, mimeType: file.mimeType,
      size: file.size, webViewLink: file.webViewLink,
    };
  } catch (err) {
    return this.driveErrorPayload(err);
  }
}

/**
 * Map DataRoom + googleapis errors into a structured tool result the model
 * can act on. Class-first (instanceof) so a stale message string fails loudly
 * via the generic-class branch instead of silently falling through.
 */
private driveErrorPayload(err: unknown): { error: string; message: string } {
  if (err instanceof ForbiddenException) {
    return {
      error: 'permission_denied',
      message: 'Only the case owner can write or update files in the data room. Ask the owner to perform this action.',
    };
  }
  if (err instanceof NotFoundException) {
    const msg = (err.message ?? '').toString();
    if (msg.includes('connection_not_found')) {
      return {
        error: 'no_drive_connection',
        message: 'No Google Drive is connected to this case. Ask the user to connect a folder via the data room UI.',
      };
    }
    return { error: 'not_found', message: msg || 'not_found' };
  }
  if (err instanceof BadRequestException) {
    const msg = (err.message ?? '').toString();
    if (msg.includes('folder_not_set')) {
      return {
        error: 'no_drive_folder',
        message: 'A Drive is connected but no folder has been selected. Ask the user to pick a folder via the data room UI.',
      };
    }
    if (msg.includes('google_workspace_file')) {
      return {
        error: 'google_workspace_file',
        message: 'This is a native Google Doc/Sheet/Slides file. Ask the user to open it in Drive or export it to plain text/PDF first — the agent can\'t read native Workspace formats directly.',
      };
    }
    if (msg.includes('file_outside_folder')) {
      return {
        error: 'file_outside_folder',
        message: 'That fileId belongs to a file outside the connected folder. Use list_drive_files to get a fresh list of available files.',
      };
    }
    return { error: 'bad_request', message: msg || 'bad_request' };
  }
  if (err instanceof ServiceUnavailableException) {
    return {
      error: 'drive_connection_broken',
      message: "The Drive connection is broken (token revoked or expired). Ask the user to reconnect via the data room UI.",
    };
  }
  // Bare googleapis 404 (not wrapped in a Nest exception) — surface as file_not_found.
  const e = err as { code?: number; status?: number; response?: { status?: number }; message?: string };
  const status = e?.code ?? e?.status ?? e?.response?.status;
  if (status === 404) {
    return {
      error: 'file_not_found',
      message: 'No file with that fileId in the connected folder. Call list_drive_files to refresh the available IDs.',
    };
  }
  return { error: 'drive_error', message: e?.message ?? 'unknown_error' };
}
```

**Step 5: Slim `read_drive_file` results in DB persistence**

In `slimToolResult` (line 153), extend the gate and add a branch:

```typescript
function slimToolResult(toolName: string, full: string): string {
  if (toolName === 'read_drive_file') {
    try {
      const parsed = JSON.parse(full);
      if (parsed && typeof parsed === 'object') {
        const { name, mimeType, size, truncated, error, message } = parsed as Record<string, unknown>;
        // Drop `content` — the model can re-call read_drive_file if it later
        // needs the body. Same pattern as production results.
        return JSON.stringify({ name, mimeType, size, truncated, error, message });
      }
    } catch { /* fall through */ }
    return full.length > 3000 ? full.slice(0, 3000) + '...[truncated]' : full;
  }

  if (
    toolName !== 'create_production' &&
    toolName !== 'read_production' &&
    toolName !== 'update_production'
  ) {
    return full;
  }

  // ...existing production-slimming logic unchanged
}
```

**Step 6: Build and commit**

Run: `npm run build --prefix backend`

```bash
git add backend/src/modules/ai/ai.service.ts
git commit -m "dispatch drive tools with owner check, parents check, slim DB persistence"
```

---

### Task 7: Tell the agent the new tools exist (investigator prompt)

**Files:**
- Modify: `backend/src/prompts/investigator.ts`

Add four bullets after the `update_production` line:

```
- list_drive_files: list files in the case's connected Google Drive folder. Use to discover available evidence/exhibits.
- read_drive_file: read a text file from Drive (text/markdown, JSON, CSV, XML). Returns up to 100KB of content. For PDFs/XLSX/images, ask the user to attach the file directly to chat instead. For Google Docs/Sheets/Slides, ask the user to export them first.
- write_drive_file: upload a NEW file to the case's Drive folder. OWNER-ONLY — guests will get a permission error.
- update_drive_file: REPLACE the contents of an existing Drive file. Use to iterate on a saved report instead of creating a new file. OWNER-ONLY.
```

Add a guideline near the existing data room note:

```
- When the user asks "what's in the data room?" or references documents in their Drive, use list_drive_files / read_drive_file. If no Drive is connected, tell them to connect one in the data room UI. When iterating on a saved artefact, prefer update_drive_file over write_drive_file to avoid cluttering the folder.
```

Build, commit:

```bash
git add backend/src/prompts/investigator.ts
git commit -m "document drive tools in investigator prompt"
```

---

### Task 8: Update the product-knowledge skill

**Files:**
- Modify: `backend/src/skills/product-knowledge.md`

In the `## AI Assistant` capabilities list (around line 75), add Drive tools alongside the others:

```markdown
- **Browse the data room** — list files in the case's connected Drive folder with `list_drive_files`
- **Read Drive files** — pull text-like files (markdown/JSON/CSV/XML) into context with `read_drive_file`. PDFs/XLSX/images and native Google Docs need to be exported or attached via the chat UI.
- **Write to the data room** — create new files with `write_drive_file` or overwrite existing ones with `update_drive_file`. OWNER-ONLY: guest users cannot use these.
```

Also extend the Data Room concept paragraph (line 44) with one sentence:

> The AI assistant can list, read, create, and update files in the connected folder — owner-only for writes, mirroring the UI's permission model.

Commit:

```bash
git add backend/src/skills/product-knowledge.md
git commit -m "document drive tools in product-knowledge skill"
```

---

### Task 9: End-to-end smoke test

**Step 1: Start the stack**

```bash
npm run db
npm run be
npm run fe
```

**Step 2: Pick an owner-test case**

Open a case YOU OWN that has a Drive connection with a folder set.

**Step 3: list**

Prompt: "What files are in the data room?"
Expected: agent calls `list_drive_files`, returns a list.

**Step 4: read (text)**

Drop a small `.md` or `.csv`. Prompt: "Summarize `<filename>`."
Expected: `list_drive_files` then `read_drive_file`, then summary.

**Step 5: read (binary)**

Drop a PDF. Prompt: "What does `<pdf-name>` say?"
Expected: `read_drive_file` returns `binary_content`; agent tells user to attach the PDF to chat.

**Step 6: read (Google Workspace)**

Drop a Google Doc into the folder (or use one already there). Prompt: "Read `<gdoc-name>`."
Expected: `read_drive_file` returns `google_workspace_file` with the export hint; agent relays it to the user.

**Step 7: write**

Prompt: "Save a one-line summary as `agent-test.md` to the data room."
Expected: `write_drive_file` succeeds. File appears in Drive.

**Step 8: update**

Same conversation: "Now add a second line about transaction volume."
Expected: `update_drive_file` reuses the fileId from step 7. File grows; no duplicate created.

**Step 9: stale fileId**

Manually delete the file in Drive UI. Prompt: "Append another line to that file."
Expected: `update_drive_file` returns `file_not_found` (or `file_outside_folder` if Drive's behavior differs); agent recovers via `list_drive_files`.

**Step 10: out-of-folder fileId**

Manually craft a prompt with a fileId you know is in a DIFFERENT folder of the user's Drive (e.g., copy from another folder's URL). Prompt: "Read fileId `<that-id>`."
Expected: `read_drive_file` returns `file_outside_folder`. Confirms the parents-check works.

**Step 11: guest write**

Switch to a case where you are a GUEST (or invite a test user as guest and impersonate). Prompt: "Save `guest-test.md` to the data room."
Expected: `write_drive_file` returns `permission_denied`; agent tells the user only owners can write.

**Step 12: no-connection**

Switch to a case with no Drive connected. Prompt: "List the files in the data room."
Expected: `no_drive_connection` with the connect-via-UI hint.

**Step 13: stop here and report**

If all 10 exercises pass, the feature is complete. Otherwise capture the failure (request, response, agent reasoning) and fix in a follow-up commit.

---

## What's intentionally out of scope

- **Deleting Drive files.** Too destructive without a confirmation flow. Out of scope.
- **Moving / renaming files.** `files.update` can rename via `requestBody.name`, but no clear use case yet. Add later if asked.
- **Exporting Google Workspace files** to text/PDF and feeding them to the agent. The plan surfaces a friendly error; export support is a follow-up.
- **Searching across files.** Per-case index needed. Out of scope.
- **Caching downloaded file contents.** Each `read_drive_file` re-downloads. Fine for now; revisit if a long conversation thrashes the same large file.
- **Streaming uploads from the agent for files >memory.** Today the whole `content` string lands in memory before upload. Acceptable since tool inputs are JSON-bounded by the API limit.
- **Exposing Drive read/write to `execute_script`.** Would let scripts process multi-MB Drive files without inflating the conversation. Worth doing — separate plan.
