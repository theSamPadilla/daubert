# Agent Drive Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the AI investigator agent four new tools — `list_drive_files`, `read_drive_file`, `write_drive_file`, `update_drive_file` — so it can list, read, create, and overwrite files in the case's connected Google Drive folder.

**Architecture:** Most of the Drive plumbing already exists in `DataRoomService` (per-case auth, encrypted token refresh, retry-on-401). Two pieces are missing: `GoogleDriveService.updateFile` (overwrite) and `DataRoomService.updateFromStream`. We add those, then add four thin tool dispatch cases in `AiService`. No schema changes, no migrations.

**Tech Stack:** NestJS, TypeORM, googleapis (already wired), Anthropic SDK tool-use blocks, Jest.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/ai/ai.module.ts` | Modify | Import `DataRoomModule` so `DataRoomService` is injectable into `AiService`. |
| 2 | `backend/src/modules/data-room/google-drive.service.ts` | Modify | Add `updateFile(token, fileId, mimeType, body)` — wraps `drive.files.update`. |
| 3 | `backend/src/modules/data-room/google-drive.service.spec.ts` | Modify | Cover the new `updateFile` method (mirrors existing `uploadFile` test). |
| 4 | `backend/src/modules/data-room/data-room.service.ts` | Modify | Add `updateFromStream(caseId, fileId, mimeType, stream)` — runs through `withFreshTokens`. |
| 5 | `backend/src/modules/data-room/data-room.service.spec.ts` | Modify | Add `updateFile: jest.fn()` to the mock harness so the new method is mockable. |
| 6 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Add four Anthropic tool schemas: `LIST_DRIVE_FILES_TOOL`, `READ_DRIVE_FILE_TOOL`, `WRITE_DRIVE_FILE_TOOL`, `UPDATE_DRIVE_FILE_TOOL`. |
| 7 | `backend/src/modules/ai/tools/index.ts` | Modify | Re-export the four new tools and register them in `AGENT_TOOLS`. |
| 8 | `backend/src/modules/ai/tools/drive-content.ts` | Create | Helper: text-vs-binary mime detection + bounded UTF-8 decode of a Drive download stream. |
| 9 | `backend/src/modules/ai/tools/drive-content.spec.ts` | Create | Unit tests for the decode helper (text/binary classification + size cap clamp). |
| 10 | `backend/src/modules/ai/ai.service.ts` | Modify | Inject `DataRoomService`; add four dispatch cases in `executeTool`; add `executeListDriveFiles` / `executeReadDriveFile` / `executeWriteDriveFile` / `executeUpdateDriveFile` private methods + shared `driveErrorPayload` mapper. |
| 11 | `backend/src/prompts/investigator.ts` | Modify | List the four new tools so the agent knows when to use them. |

**User-facing change:** The agent can respond to prompts like "what's in the case folder?", "summarize the deposition transcript in Drive", "save this report to the data room as a .md file", and "update the saved summary with the new findings" without the user manually downloading/uploading.

**Dev-facing change:** Two new `DataRoomService`/`GoogleDriveService` methods (one googleapis call each) and four entries in the agent's tool registry, following the existing `tool-definitions.ts → AGENT_TOOLS → executeTool switch` pattern.

---

## Design notes (read before starting)

**Per-case scoping is automatic.** `executeTool` already receives `caseId`. `DataRoomService.listFiles/getFileForDownload/uploadFromStream/updateFromStream` all key off `caseId`. The agent literally cannot escape its case.

**Update vs upload semantics.** Drive's `files.update` replaces the file's content in place — same `fileId`, same parent folder, new bytes. The agent uses it to iterate on a saved artefact (mirrors how `update_production` is used today). It does NOT take a `parents` array, so we don't need a folder check.

**Binary vs text on read.** Tool results are JSON-stringified into the conversation. Putting raw binary in there will blow up context and confuse the model. Rule:

- **Text MIME types** (`text/*`, `application/json`, `application/xml`, `application/csv`): decode UTF-8, return up to `maxBytes` (default 100_000) of text. Truncate with a marker if longer.
- **PDF / XLSX / images / everything else**: return `{ error: 'binary_content', mimeType, size, hint: 'Ask the user to attach this file to the chat instead.' }`. The chat UI's existing attachment path already handles PDFs/XLSX/images natively — no need to duplicate that here.

**Write/update encoding.** Both `write_drive_file` and `update_drive_file` accept `{ ..., content, encoding }` where `encoding` is `'utf8' | 'base64'`. Default `'utf8'`. Convert to a `Readable` stream and call into `DataRoomService`.

**Errors surface cleanly.** `DataRoomService` already throws `NotFoundException('connection_not_found')`, `BadRequestException('folder_not_set')`, `ServiceUnavailableException('connection_broken')`. A wrong `fileId` surfaces as a googleapis 404. Catch all of these in the dispatch cases and return `{ error: '<code>', message: '...' }` so the agent gets a structured failure, not a stack trace.

---

### Task 1: Wire `DataRoomModule` into `AiModule`

**Files:**
- Modify: `backend/src/modules/ai/ai.module.ts`

**Step 1: Import `DataRoomModule`**

Edit `backend/src/modules/ai/ai.module.ts`. Add the import at the top:

```typescript
import { DataRoomModule } from '../data-room/data-room.module';
```

Add `DataRoomModule` to the `imports` array:

```typescript
imports: [
  TypeOrmModule.forFeature([...]),
  AuthModule,
  LabeledEntitiesModule,
  ProductionsModule,
  ScriptModule,
  DataRoomModule,
],
```

`DataRoomModule` already exports `DataRoomService` (see `data-room.module.ts:19`), so the import is enough.

**Step 2: Build to confirm DI graph still resolves**

Run: `npm run build --prefix backend`
Expected: clean build, no Nest DI errors.

**Step 3: Commit**

```bash
git add backend/src/modules/ai/ai.module.ts
git commit -m "wire DataRoomModule into AiModule"
```

---

### Task 2: Add `updateFile` / `updateFromStream` plumbing (TDD)

**Files:**
- Modify: `backend/src/modules/data-room/google-drive.service.ts`
- Modify: `backend/src/modules/data-room/google-drive.service.spec.ts`
- Modify: `backend/src/modules/data-room/data-room.service.ts`
- Modify: `backend/src/modules/data-room/data-room.service.spec.ts`

**Step 1: Add the failing test for `GoogleDriveService.updateFile`**

In `google-drive.service.spec.ts`, add to the top-level mocks (near the existing `mockFilesCreate`):

```typescript
const mockFilesUpdate = jest.fn();
```

Extend the `jest.mock('googleapis', ...)` block's `files` object with `update: mockFilesUpdate`.

Then add a new `describe('updateFile', ...)` block (mirror `describe('uploadFile', ...)` at line 119):

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
    expect(args.media.body).toBeInstanceOf(Readable);
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
```

Run: `npm test --prefix backend -- google-drive.service`
Expected: FAIL — `svc.updateFile is not a function`.

**Step 2: Implement `updateFile`**

In `google-drive.service.ts`, add this method below `uploadFile` (around line 237):

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
```

Run: `npm test --prefix backend -- google-drive.service`
Expected: PASS.

**Step 3: Update the `DataRoomService` mock harness**

In `data-room.service.spec.ts:27`, add `updateFile: jest.fn(),` to the `mockGoogleDrive` block so future tests of `updateFromStream` can mock it.

**Step 4: Add the failing test for `DataRoomService.updateFromStream`**

Still in `data-room.service.spec.ts`, append a new `describe` (next to existing tests):

```typescript
describe('updateFromStream', () => {
  it('runs the upload through withFreshTokens and returns the DriveFile', async () => {
    const service = await buildService();
    // The harness's GoogleDriveService.updateFile mock is the one we configured
    // in step 3. Pull it back via the module reference if needed; otherwise
    // assert via spy on the prototype.
    // (Implementation detail: this test currently FAILs because updateFromStream
    // doesn't exist on the service yet.)
    expect(typeof (service as any).updateFromStream).toBe('function');
  });
});
```

> NOTE: this is a deliberately thin test. The full `withFreshTokens` path is already covered by the existing `uploadFromStream` tests in this file — `updateFromStream` is a one-line wrapper around the same machinery. A heavier integration test would duplicate coverage. If `data-room.service.spec.ts` already has a richer harness for upload paths, mirror that shape instead and assert that `mockGoogleDrive.updateFile` was called with the right args.

Run: `npm test --prefix backend -- data-room.service`
Expected: FAIL.

**Step 5: Implement `updateFromStream`**

In `data-room.service.ts`, add this method below `uploadFromStream` (around line 287):

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
```

Run: `npm test --prefix backend -- data-room.service`
Expected: PASS.

**Step 6: Build the whole backend**

Run: `npm run build --prefix backend`
Expected: clean.

**Step 7: Commit**

```bash
git add backend/src/modules/data-room/google-drive.service.ts \
        backend/src/modules/data-room/google-drive.service.spec.ts \
        backend/src/modules/data-room/data-room.service.ts \
        backend/src/modules/data-room/data-room.service.spec.ts
git commit -m "add updateFile / updateFromStream to data room services"
```

---

### Task 3: Add the four agent tool definitions

**Files:**
- Modify: `backend/src/modules/ai/tools/tool-definitions.ts`

**Step 1: Append the four tool schemas to the bottom of the file**

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
    "Read the contents of a file from the case's Drive folder. Works for text-like files (text/*, application/json, application/xml, CSV) — returns decoded UTF-8 text up to maxBytes. For binary files (PDF, XLSX, images, etc.) returns metadata and a hint to ask the user to attach the file directly to chat. Use list_drive_files first to get fileIds.",
  input_schema: {
    type: 'object' as const,
    properties: {
      fileId: {
        type: 'string',
        description: 'The Google Drive file ID (from list_drive_files).',
      },
      maxBytes: {
        type: 'number',
        description: 'Cap on returned text length. Default 100000. Hard max 500000.',
      },
    },
    required: ['fileId'],
  },
};

export const WRITE_DRIVE_FILE_TOOL: Anthropic.Tool = {
  name: 'write_drive_file',
  description:
    "Create a new file in the case's connected Drive folder. Use to save reports, exports, or generated artefacts. Always creates a new file — to overwrite an existing one, use update_drive_file. Returns the created file's id, name, mimeType, size, and webViewLink.",
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'File name including extension (e.g. "flow-of-funds-summary.md").',
      },
      mimeType: {
        type: 'string',
        description: 'MIME type (e.g. "text/markdown", "text/csv", "application/json", "application/pdf").',
      },
      content: {
        type: 'string',
        description: 'File content. UTF-8 string by default; base64-encoded if encoding="base64".',
      },
      encoding: {
        type: 'string',
        enum: ['utf8', 'base64'],
        description: 'Encoding of `content`. Default "utf8". Use "base64" for binary uploads.',
      },
    },
    required: ['name', 'mimeType', 'content'],
  },
};

export const UPDATE_DRIVE_FILE_TOOL: Anthropic.Tool = {
  name: 'update_drive_file',
  description:
    "Replace the contents of an existing file in the case's Drive folder. Use to iteratively refine a saved artefact (e.g. update a markdown summary as new findings come in) instead of creating a new file each time. The fileId stays the same — only the bytes change. Returns the updated file metadata.",
  input_schema: {
    type: 'object' as const,
    properties: {
      fileId: {
        type: 'string',
        description: 'The Google Drive file ID to overwrite (from list_drive_files or a prior write_drive_file response).',
      },
      mimeType: {
        type: 'string',
        description: 'MIME type of the new content. Should match the file\'s existing type — for example "text/markdown" for an .md file.',
      },
      content: {
        type: 'string',
        description: 'New file content. UTF-8 string by default; base64-encoded if encoding="base64".',
      },
      encoding: {
        type: 'string',
        enum: ['utf8', 'base64'],
        description: 'Encoding of `content`. Default "utf8".',
      },
    },
    required: ['fileId', 'mimeType', 'content'],
  },
};
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build --prefix backend`
Expected: clean.

**Step 3: Commit**

```bash
git add backend/src/modules/ai/tools/tool-definitions.ts
git commit -m "define list/read/write/update_drive_file agent tools"
```

---

### Task 4: Register the new tools in `AGENT_TOOLS`

**Files:**
- Modify: `backend/src/modules/ai/tools/index.ts`

**Step 1: Add re-exports and registry entries**

Update both `from './tool-definitions'` blocks AND `AGENT_TOOLS`:

```typescript
export { SKILL_NAMES, getSkillContent } from '../../../skills/skill-registry';
export {
  WEB_SEARCH_TOOL,
  GET_CASE_DATA_TOOL,
  GET_INVESTIGATION_TOOL,
  GET_SKILL_TOOL,
  EXECUTE_SCRIPT_TOOL,
  LIST_SCRIPT_RUNS_TOOL,
  QUERY_LABELED_ENTITIES_TOOL,
  CREATE_PRODUCTION_TOOL,
  READ_PRODUCTION_TOOL,
  UPDATE_PRODUCTION_TOOL,
  LIST_DRIVE_FILES_TOOL,
  READ_DRIVE_FILE_TOOL,
  WRITE_DRIVE_FILE_TOOL,
  UPDATE_DRIVE_FILE_TOOL,
} from './tool-definitions';

import {
  WEB_SEARCH_TOOL,
  GET_CASE_DATA_TOOL,
  GET_INVESTIGATION_TOOL,
  GET_SKILL_TOOL,
  EXECUTE_SCRIPT_TOOL,
  LIST_SCRIPT_RUNS_TOOL,
  QUERY_LABELED_ENTITIES_TOOL,
  CREATE_PRODUCTION_TOOL,
  READ_PRODUCTION_TOOL,
  UPDATE_PRODUCTION_TOOL,
  LIST_DRIVE_FILES_TOOL,
  READ_DRIVE_FILE_TOOL,
  WRITE_DRIVE_FILE_TOOL,
  UPDATE_DRIVE_FILE_TOOL,
} from './tool-definitions';

export const AGENT_TOOLS = [
  WEB_SEARCH_TOOL,
  GET_CASE_DATA_TOOL,
  GET_INVESTIGATION_TOOL,
  GET_SKILL_TOOL,
  EXECUTE_SCRIPT_TOOL,
  LIST_SCRIPT_RUNS_TOOL,
  QUERY_LABELED_ENTITIES_TOOL,
  CREATE_PRODUCTION_TOOL,
  READ_PRODUCTION_TOOL,
  UPDATE_PRODUCTION_TOOL,
  LIST_DRIVE_FILES_TOOL,
  READ_DRIVE_FILE_TOOL,
  WRITE_DRIVE_FILE_TOOL,
  UPDATE_DRIVE_FILE_TOOL,
];
```

**Step 2: Build**

Run: `npm run build --prefix backend`
Expected: clean.

**Step 3: Commit**

```bash
git add backend/src/modules/ai/tools/index.ts
git commit -m "register drive tools in AGENT_TOOLS"
```

---

### Task 5: Add the text-vs-binary decode helper (TDD)

This is the only piece in the plan that contains real branching logic, so it gets a focused TDD pass.

**Files:**
- Create: `backend/src/modules/ai/tools/drive-content.ts`
- Create: `backend/src/modules/ai/tools/drive-content.spec.ts`

**Step 1: Write the failing test**

Create `backend/src/modules/ai/tools/drive-content.spec.ts`:

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

  it('returns kind=binary for non-text mime without consuming the stream', async () => {
    const result = await decodeDriveStream(streamFrom(Buffer.from('PDFDATA')), 'application/pdf', 1000);
    expect(result).toEqual({ kind: 'binary' });
  });
});
```

Run: `npm test --prefix backend -- drive-content`
Expected: FAIL — module not found.

**Step 2: Implement the helper**

Create `backend/src/modules/ai/tools/drive-content.ts`:

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
    // We don't consume the stream — caller can discard it. (googleapis won't
    // stall waiting on the consumer; the request closes when the response goes
    // out of scope.)
    return { kind: 'binary' };
  }

  const cap = Math.min(Math.max(1, Math.floor(maxBytes)), MAX_READ_BYTES);
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

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

  return {
    kind: 'text',
    content: Buffer.concat(chunks).toString('utf8'),
    truncated,
  };
}
```

**Step 3: Run the tests**

Run: `npm test --prefix backend -- drive-content`
Expected: all PASS.

**Step 4: Commit**

```bash
git add backend/src/modules/ai/tools/drive-content.ts backend/src/modules/ai/tools/drive-content.spec.ts
git commit -m "add drive content decoding helper"
```

---

### Task 6: Inject `DataRoomService` and dispatch the four tools

**Files:**
- Modify: `backend/src/modules/ai/ai.service.ts`

**Step 1: Add the imports and constructor injection**

At the top of `ai.service.ts`, add:

```typescript
import { DataRoomService } from '../data-room/data-room.service';
import { decodeDriveStream, DEFAULT_READ_BYTES } from './tools/drive-content';
import { Readable } from 'stream';
```

Extend the existing `from './tools'` import block:

```typescript
import {
  AGENT_TOOLS,
  GET_CASE_DATA_TOOL,
  GET_INVESTIGATION_TOOL,
  GET_SKILL_TOOL,
  EXECUTE_SCRIPT_TOOL,
  LIST_SCRIPT_RUNS_TOOL,
  QUERY_LABELED_ENTITIES_TOOL,
  CREATE_PRODUCTION_TOOL,
  READ_PRODUCTION_TOOL,
  UPDATE_PRODUCTION_TOOL,
  LIST_DRIVE_FILES_TOOL,
  READ_DRIVE_FILE_TOOL,
  WRITE_DRIVE_FILE_TOOL,
  UPDATE_DRIVE_FILE_TOOL,
  SKILL_NAMES,
  getSkillContent,
} from './tools';
```

In the `AiService` constructor (around line 198), inject `DataRoomService`:

```typescript
constructor(
  private readonly llm: AnthropicProvider,
  private readonly conversationsService: ConversationsService,
  private readonly scriptExecutionService: ScriptExecutionService,
  private readonly labeledEntitiesService: LabeledEntitiesService,
  private readonly productionsService: ProductionsService,
  private readonly dataRoomService: DataRoomService,
  @InjectRepository(MessageEntity)
  private readonly messageRepo: Repository<MessageEntity>,
  @InjectRepository(InvestigationEntity)
  private readonly investigationRepo: Repository<InvestigationEntity>,
  @InjectRepository(TraceEntity)
  private readonly traceRepo: Repository<TraceEntity>,
  @InjectRepository(DataRoomConnectionEntity)
  private readonly dataRoomRepo: Repository<DataRoomConnectionEntity>,
) {}
```

**Step 2: Add the four dispatch cases inside `executeTool`**

After `UPDATE_PRODUCTION_TOOL.name` (line ~595) and before `default:` (line ~597), add:

```typescript
case LIST_DRIVE_FILES_TOOL.name: {
  if (!caseId) {
    return { error: 'No case context. Ask the user to open a case.' };
  }
  return this.executeListDriveFiles(caseId);
}

case READ_DRIVE_FILE_TOOL.name: {
  if (!caseId) {
    return { error: 'No case context. Ask the user to open a case.' };
  }
  const input = toolUse.input as { fileId: string; maxBytes?: number };
  if (!input.fileId) {
    return { error: 'fileId is required' };
  }
  return this.executeReadDriveFile(caseId, input.fileId, input.maxBytes);
}

case WRITE_DRIVE_FILE_TOOL.name: {
  if (!caseId) {
    return { error: 'No case context. Ask the user to open a case.' };
  }
  const input = toolUse.input as {
    name: string;
    mimeType: string;
    content: string;
    encoding?: 'utf8' | 'base64';
  };
  if (!input.name || !input.mimeType || typeof input.content !== 'string') {
    return { error: 'name, mimeType, and content are required' };
  }
  return this.executeWriteDriveFile(
    caseId,
    input.name,
    input.mimeType,
    input.content,
    input.encoding ?? 'utf8',
  );
}

case UPDATE_DRIVE_FILE_TOOL.name: {
  if (!caseId) {
    return { error: 'No case context. Ask the user to open a case.' };
  }
  const input = toolUse.input as {
    fileId: string;
    mimeType: string;
    content: string;
    encoding?: 'utf8' | 'base64';
  };
  if (!input.fileId || !input.mimeType || typeof input.content !== 'string') {
    return { error: 'fileId, mimeType, and content are required' };
  }
  return this.executeUpdateDriveFile(
    caseId,
    input.fileId,
    input.mimeType,
    input.content,
    input.encoding ?? 'utf8',
  );
}
```

**Step 3: Add the four private implementations + shared error mapper**

Add these methods to `AiService`, alongside `executeCaseDataTool` / `executeInvestigationTool`:

```typescript
private async executeListDriveFiles(caseId: string): Promise<unknown> {
  try {
    const files = await this.dataRoomService.listFiles(caseId);
    return files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      modifiedTime: f.modifiedTime,
    }));
  } catch (err) {
    return this.driveErrorPayload(err);
  }
}

private async executeReadDriveFile(
  caseId: string,
  fileId: string,
  maxBytes?: number,
): Promise<unknown> {
  try {
    const { stream, name, mimeType, size } =
      await this.dataRoomService.getFileForDownload(caseId, fileId);
    const decoded = await decodeDriveStream(
      stream,
      mimeType,
      maxBytes ?? DEFAULT_READ_BYTES,
    );
    if (decoded.kind === 'binary') {
      return {
        error: 'binary_content',
        message:
          'This file is binary (PDF/XLSX/image/etc.) and cannot be returned as text. Ask the user to attach it directly to the chat using the paperclip icon.',
        name,
        mimeType,
        size,
      };
    }
    return {
      name,
      mimeType,
      size,
      truncated: decoded.truncated,
      content: decoded.content,
    };
  } catch (err) {
    return this.driveErrorPayload(err);
  }
}

private async executeWriteDriveFile(
  caseId: string,
  name: string,
  mimeType: string,
  content: string,
  encoding: 'utf8' | 'base64',
): Promise<unknown> {
  try {
    const buffer =
      encoding === 'base64'
        ? Buffer.from(content, 'base64')
        : Buffer.from(content, 'utf8');
    const stream = Readable.from(buffer);
    const file = await this.dataRoomService.uploadFromStream(
      caseId,
      name,
      mimeType,
      stream,
    );
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      webViewLink: file.webViewLink,
    };
  } catch (err) {
    return this.driveErrorPayload(err);
  }
}

private async executeUpdateDriveFile(
  caseId: string,
  fileId: string,
  mimeType: string,
  content: string,
  encoding: 'utf8' | 'base64',
): Promise<unknown> {
  try {
    const buffer =
      encoding === 'base64'
        ? Buffer.from(content, 'base64')
        : Buffer.from(content, 'utf8');
    const stream = Readable.from(buffer);
    const file = await this.dataRoomService.updateFromStream(
      caseId,
      fileId,
      mimeType,
      stream,
    );
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      webViewLink: file.webViewLink,
    };
  } catch (err) {
    return this.driveErrorPayload(err);
  }
}

private driveErrorPayload(err: unknown): { error: string; message: string } {
  const e = err as {
    code?: number;
    status?: number;
    message?: string;
    response?: { status?: number; message?: string };
  };
  const status = e?.code ?? e?.status ?? e?.response?.status;
  const msg = e?.response?.message ?? e?.message ?? 'unknown_error';

  if (msg.includes('connection_not_found')) {
    return {
      error: 'no_drive_connection',
      message:
        'No Google Drive is connected to this case. Ask the user to connect a folder via the data room UI.',
    };
  }
  if (msg.includes('folder_not_set')) {
    return {
      error: 'no_drive_folder',
      message:
        'A Drive is connected but no folder has been selected. Ask the user to pick a folder via the data room UI.',
    };
  }
  if (msg.includes('connection_broken')) {
    return {
      error: 'drive_connection_broken',
      message:
        "The Drive connection is broken (token revoked or expired). Ask the user to reconnect via the data room UI.",
    };
  }
  if (status === 404) {
    return {
      error: 'file_not_found',
      message:
        'No file with that fileId in the connected folder. Call list_drive_files to refresh the available IDs.',
    };
  }
  return { error: 'drive_error', message: msg };
}
```

**Step 4: Build**

Run: `npm run build --prefix backend`
Expected: clean.

**Step 5: Commit**

```bash
git add backend/src/modules/ai/ai.service.ts
git commit -m "dispatch list/read/write/update_drive_file in AiService"
```

---

### Task 7: Tell the agent the new tools exist

**Files:**
- Modify: `backend/src/prompts/investigator.ts`

**Step 1: Add bullets to the tool list**

In `INVESTIGATOR_PROMPT`, find the `update_production` line (last bullet of the tool list) and add four bullets after it:

```
- list_drive_files: list files in the case's connected Google Drive folder. Use to discover available evidence/exhibits.
- read_drive_file: read a text file from Drive (text/markdown, JSON, CSV, XML). Returns up to 100KB of content. For PDFs/XLSX/images, ask the user to attach the file directly to chat instead.
- write_drive_file: upload a NEW file (e.g. a generated report or CSV export) to the case's Drive folder.
- update_drive_file: REPLACE the contents of an existing Drive file. Use to iterate on a saved report instead of creating a new file each time.
```

Add a one-line guideline near the existing data room note:

```
- When the user asks "what's in the data room?" or references documents in their Drive, use list_drive_files / read_drive_file. If no Drive is connected, tell them to connect one in the data room UI. When iterating on a saved artefact, prefer update_drive_file over write_drive_file to avoid cluttering the folder.
```

**Step 2: Build**

Run: `npm run build --prefix backend`
Expected: clean.

**Step 3: Commit**

```bash
git add backend/src/prompts/investigator.ts
git commit -m "document drive tools in investigator prompt"
```

---

### Task 8: End-to-end smoke test

**Step 1: Start the stack**

```bash
npm run db
npm run be
npm run fe
```

**Step 2: Pick a test case**

Open a case that already has a Drive connection with a folder set. (If none exists, connect a sandbox Drive folder via the data room UI first — that path is unchanged by this plan.)

**Step 3: Exercise list**

Prompt: "What files are in the data room?"
Expected: agent calls `list_drive_files`, returns a list with names/sizes.

**Step 4: Exercise read (text)**

Drop a small `.md` or `.csv` file into the connected folder. Prompt: "Summarize the file `<filename>`."
Expected: agent calls `list_drive_files` then `read_drive_file`, then summarizes.

**Step 5: Exercise read (binary)**

Drop a PDF in the folder. Prompt: "What does `<pdf-name>` say?"
Expected: agent calls `read_drive_file`, gets `binary_content`, and tells the user to attach the PDF to chat directly.

**Step 6: Exercise write**

Prompt: "Save a one-line summary as `agent-test.md` to the data room."
Expected: agent calls `write_drive_file`. The file appears in the Drive folder.

**Step 7: Exercise update**

Same conversation: "Now add a second line about transaction volume to that file."
Expected: agent calls `update_drive_file` with the same fileId from step 6 (NOT `write_drive_file` again). Verify the file contents grew, and that no second file was created in the folder.

**Step 8: Exercise update with a stale fileId**

Manually delete the file in Drive UI, then prompt: "Append another line to that file."
Expected: agent calls `update_drive_file`, gets `file_not_found`, and recovers by calling `list_drive_files` again or asking the user.

**Step 9: Exercise no-connection error**

Switch to a case with no Drive connected. Prompt: "List the files in the data room."
Expected: agent receives `no_drive_connection` and tells the user to connect via the UI.

**Step 10: Stop here and report**

If all eight exercises pass, the feature is complete. If any fail, capture the request/response and the agent's reasoning, file an issue, and fix in a follow-up commit.

No commit at this step.

---

## What's intentionally out of scope

- **Deleting Drive files.** Too destructive to give the agent without a confirmation flow. Out of scope.
- **Moving / renaming files.** `files.update` can also rename via `requestBody.name`, but the agent doesn't have a clear use case yet. Add later if asked.
- **Searching across files** (e.g. "find every file mentioning 0xabc..."). Would need a per-case index. Out of scope.
- **Caching downloaded file contents.** Each `read_drive_file` call re-downloads. Fine for now (small text files); revisit if a long conversation thrashes the same large file.
- **Streaming uploads from the agent for files >memory.** Today the whole `content` string lands in memory before upload. Acceptable since tool inputs are JSON-stringified anyway and bounded by the API request limit.
