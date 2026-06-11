# Agent Data-Room Reading — Implementation Plan

**Goal:** Let the investigator agent list and read case data-room files directly (PDFs, images, spreadsheets, docs) by reusing the existing `buildAttachmentBlocks` multimodal pipeline — no re-upload.

## Summary
- **What & why:** Today the agent sees only a file *count* for the data room (`dataRoom: { available, fileCount }`) and is blind to the actual evidence. This wires the room into the agent: a proactive **manifest** in case context, a `list_data_room_files` tool for explicit/folder listing, and a `read_data_room_file` tool that pulls a GCS object and runs it through the same extractor used for chat attachments. Every read is custody-logged (`agent_read`).
- **Key product decisions:**
  - **Read-only** this scope (no write-back).
  - **Proactive manifest** injected into `get_case_data` so the agent knows what's available without a tool call. Inline manifest is **capped at the 25 most-recent files** (`{id, name, mimeType, size, folder}`) with a `truncated` flag; `list_data_room_files` returns the full/folder-scoped list. (Token-governance call — idea doc flagged manifest size as a risk; cap is cheap insurance, list tool covers the rest.)
  - **Reuses `buildAttachmentBlocks` verbatim** — same caps, classification, graceful stubs. No new parsing code. Unsupported types (e.g. native Google-Workspace files) classify to nothing → the tool returns a graceful "unsupported" note.
  - **Custody:** every read logs an `agent_read` row. New action value only; column is `varchar` → **no migration** (consistent with `CLAUDE.md` migration rules).
- **Load-bearing architecture decisions:**
  - **How file content re-enters the conversation (the one real design fork, deferred to plan by the idea doc):** the `read_data_room_file` handler returns a **sentinel** `{ __agentReadBlocks, summary }`. The agent loop pushes the small JSON `summary` as the `tool_result` content (satisfying the tool_use↔tool_result pairing), then injects the `__agentReadBlocks` (document/image/text blocks from `buildAttachmentBlocks`) as a **separate** in-memory user turn, preceded by a synthetic `(file content follows)` assistant separator. **This separate-turn shape is mandatory:** the provider runs under the `compact-2026-01-12` (programmatic tool calling) beta (`anthropic.provider.ts:50`), which requires a user turn responding to a `tool_use` to contain **only** `tool_result` blocks — exactly the invariant `mergeConsecutiveRoles` (`ai.service.ts:184-217`) already protects by inserting the same kind of separator. **In-memory full** for the current loop; **persisted slim** — only the `summary` ack is saved to history (the separator and content blocks are never persisted), so a large file does not reload every turn. This reuses the same extractor as the chat-attachment path, which the comment at `ai.service.ts:338-340` anticipates ("Drive-tool reads").
  - **`DataRoomService` becomes the single source** for both the manifest and the agent read: `AiModule` imports `DataRoomModule`, `AiService` injects `DataRoomService`, and the now-redundant direct `DataRoomFileEntity` repo injection in `AiService` is removed.
  - **Memory guard:** files above `MAX_AGENT_READ_BYTES` (5 MB raw) are not downloaded/buffered — the handler returns a "too large" note using the row's `size`, before any GCS read. `buildAttachmentBlocks`' own base64 caps remain the second line of defense.
- **Risk concentration (opus tasks): Task 3** (module wiring + manifest) and **Task 4** (tool dispatch + the agent-loop content injection) — the loop change is the highest-blast-radius edit.

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task.

## Atomized Change Table

| # | File | Action | What changes |
|---|------|--------|---------------|
| 1 | `backend/src/database/entities/data-room-access-log.entity.ts` | Modify | `DataRoomAction` union gains `'agent_read'` (no migration — varchar column) |
| 2 | `backend/src/modules/data-room/data-room.service.ts` | Modify | Add `getManifest(caseId, limit?)` (files + resolved folder paths) and `getFileForAgentRead(caseId, userId, fileId, maxBytes)` (tenancy-scoped stream + `agent_read` log + too-large guard) |
| 3 | `backend/src/modules/data-room/data-room.service.spec.ts` | Modify | Tests for `getManifest` (folder-path resolution, limit/truncation) and `getFileForAgentRead` (logs `agent_read`, NotFound on cross-case, too-large path) |
| 4 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Add `LIST_DATA_ROOM_FILES_TOOL` + `READ_DATA_ROOM_FILE_TOOL`; tweak `GET_CASE_DATA_TOOL` description to mention the file manifest |
| 5 | `backend/src/modules/ai/tools/index.ts` | Modify | Export + register both new tools in `AGENT_TOOLS` **and** `READ_ONLY_AGENT_TOOLS` (both are reads) |
| 6 | `backend/src/modules/ai/tools/index.spec.ts` | Modify | Assert both new tools present in both arrays |
| 7 | `backend/src/modules/ai/ai.module.ts` | Modify | Import `DataRoomModule`; drop `DataRoomFileEntity` from `forFeature` |
| 8 | `backend/src/modules/ai/ai.service.ts` | Modify | Inject `DataRoomService` (drop `dataRoomFileRepo`); manifest in `executeCaseDataTool`; dispatch `list_data_room_files` + `read_data_room_file`; agent-loop content-block injection + `MAX_AGENT_READ_BYTES` |
| 9 | `backend/src/modules/ai/ai.service.spec.ts` | Modify | Mock `DataRoomService`; cover new dispatch + manifest |
| 10 | `backend/src/prompts/investigator.ts` | Modify | Add `list_data_room_files` + `read_data_room_file` tool bullets |
| 11 | `backend/src/skills/product-knowledge.md` | Modify | Document that the agent can list/read data-room files |

---

## Task 1: Add `agent_read` action value
**Implementer:** sonnet
**Files:** Modify `backend/src/database/entities/data-room-access-log.entity.ts` (line 4). Test: covered transitively in Task 3 (the service spec asserts an `agent_read` row is written) — no standalone test for a type union.

**Step 1: Write the failing test** — none needed in isolation; this is a one-line type widening whose behavior is verified by Task 3's `getFileForAgentRead` test (`action: 'agent_read'`). Proceed to implementation.

**Step 2: Implementation** — change line 4:
```ts
export type DataRoomAction = 'upload' | 'download' | 'delete' | 'agent_read';
```
No other change. The column is `@Column({ type: 'varchar' })` so the DB accepts the new value with no migration and dev `synchronize` is unaffected.

**Step 3: Confirm build** — `npm run build --prefix backend` compiles clean.

**Step 4: Commit** — `git add backend/src/database/entities/data-room-access-log.entity.ts && git commit -m "feat(data-room): add agent_read access-log action"` (no Co-Authored-By trailer).

---

## Task 2: `DataRoomService.getManifest` + `getFileForAgentRead`
**Implementer:** sonnet
**Files:** Modify `backend/src/modules/data-room/data-room.service.ts`. Test: `backend/src/modules/data-room/data-room.service.spec.ts`.

**Step 1: Write the failing tests** — add to `data-room.service.spec.ts`, mirroring the existing `MockRepo`/`MockStorage` pattern in that file. Add a `describe('getManifest', ...)` and `describe('getFileForAgentRead', ...)`:

```ts
describe('getManifest', () => {
  it('resolves folder paths and respects the limit/truncation', async () => {
    // folders: root "Bank Statements" (id f1), child "2024" (id f2, parent f1)
    folderRepo.find.mockResolvedValue([
      { id: 'f1', caseId: 'c1', parentFolderId: null, name: 'Bank Statements' },
      { id: 'f2', caseId: 'c1', parentFolderId: 'f1', name: '2024' },
    ]);
    fileRepo.find.mockResolvedValue([
      { id: 'a', caseId: 'c1', name: 'stmt.pdf', mimeType: 'application/pdf', size: '10', folderId: 'f2' },
      { id: 'b', caseId: 'c1', name: 'root.csv', mimeType: 'text/csv', size: '20', folderId: null },
    ]);
    fileRepo.count.mockResolvedValue(2);

    const res = await service.getManifest('c1', 25);

    expect(res.total).toBe(2);
    expect(res.truncated).toBe(false);
    expect(res.files).toEqual([
      { id: 'a', name: 'stmt.pdf', mimeType: 'application/pdf', size: 10, folder: '/Bank Statements/2024' },
      { id: 'b', name: 'root.csv', mimeType: 'text/csv', size: 20, folder: '/' },
    ]);
    // take/limit forwarded to the file query
    expect(fileRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { caseId: 'c1' }, order: { createdAt: 'DESC' }, take: 25 }),
    );
  });

  it('flags truncated when total exceeds the limit', async () => {
    folderRepo.find.mockResolvedValue([]);
    fileRepo.find.mockResolvedValue([{ id: 'a', caseId: 'c1', name: 'x', mimeType: 'text/plain', size: '1', folderId: null }]);
    fileRepo.count.mockResolvedValue(40);
    const res = await service.getManifest('c1', 1);
    expect(res.truncated).toBe(true);
    expect(res.total).toBe(40);
  });
});

describe('getFileForAgentRead', () => {
  const fileRow = { id: 'a', caseId: 'c1', name: 'doc.pdf', mimeType: 'application/pdf', size: '100', objectKey: 'org/o/case/c1/a' };

  it('streams the object and writes an agent_read audit row', async () => {
    fileRepo.findOne.mockResolvedValue(fileRow);
    storage.download.mockResolvedValue({ stream: Readable.from(['x']) });
    const res = await service.getFileForAgentRead('c1', 'u1', 'a', 5 * 1024 * 1024);
    expect(res).toMatchObject({ name: 'doc.pdf', mimeType: 'application/pdf', size: 100, tooLarge: false });
    expect(storage.download).toHaveBeenCalledWith('org/o/case/c1/a');
    expect(logRepo.save).toHaveBeenCalled();
    expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent_read', fileId: 'a', caseId: 'c1', userId: 'u1' }));
  });

  it('throws NotFound for a file from another case', async () => {
    fileRepo.findOne.mockResolvedValue(null);
    await expect(service.getFileForAgentRead('c1', 'u1', 'a', 5 * 1024 * 1024)).rejects.toThrow(NotFoundException);
  });

  it('returns tooLarge without downloading or logging when size exceeds the cap', async () => {
    fileRepo.findOne.mockResolvedValue({ ...fileRow, size: String(99 * 1024 * 1024) });
    const res = await service.getFileForAgentRead('c1', 'u1', 'a', 5 * 1024 * 1024);
    expect(res.tooLarge).toBe(true);
    expect(res.stream).toBeUndefined();
    expect(storage.download).not.toHaveBeenCalled();
    expect(logRepo.save).not.toHaveBeenCalled();
  });
});
```
Ensure `Readable` is imported in the spec (`import { Readable } from 'stream';`). **The existing `MockRepo` interface and `makeRepo()` factory in this spec do NOT have `count`** — add `count: jest.Mock` to the `MockRepo` interface and `count: jest.fn()` to the `makeRepo()` return object, or the `fileRepo.count.mockResolvedValue(...)` calls will throw `count is not a function` before the test runs.

**Step 2: Run, confirm fail** — `npm test --prefix backend -- data-room.service.spec` → fails (`getManifest`/`getFileForAgentRead` undefined).

**Step 3: Implementation** — add to `DataRoomService` (place after `getFileForDownload`, ~line 200). Add the return-type interface near the other DTOs (top of file):

```ts
/** A flat manifest entry for the AI agent: resolved folder path, numeric size. */
export interface DataRoomManifestEntry {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  folder: string; // POSIX-style path, '/' for root
}

export interface DataRoomManifest {
  files: DataRoomManifestEntry[];
  total: number;
  truncated: boolean;
}

/** Result of an agent file read. `tooLarge` short-circuits before any download. */
export interface AgentReadResult {
  tooLarge: boolean;
  name: string;
  mimeType: string;
  size: number;
  stream?: Readable;
}
```

Methods:
```ts
/**
 * Flat file manifest for the AI agent, newest-first. Each file carries a
 * resolved POSIX-style folder path. `limit` caps the returned files (for the
 * inline case-context manifest); `total`/`truncated` report the full count.
 * Not audited — building a listing isn't file access.
 */
async getManifest(caseId: string, limit?: number): Promise<DataRoomManifest> {
  const [rows, total] = await Promise.all([
    this.fileRepo.find({
      where: { caseId },
      order: { createdAt: 'DESC' },
      ...(limit ? { take: limit } : {}),
    }),
    this.fileRepo.count({ where: { caseId } }),
  ]);

  const folders = await this.folderRepo.find({ where: { caseId } });
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathFor = (folderId: string | null): string => {
    const names: string[] = [];
    let cursor = folderId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const f = byId.get(cursor);
      if (!f) break;
      names.unshift(f.name);
      cursor = f.parentFolderId;
    }
    return '/' + names.join('/');
  };

  return {
    files: rows.map((r) => ({
      id: r.id,
      name: r.name,
      mimeType: r.mimeType,
      size: Number(r.size),
      folder: pathFor(r.folderId),
    })),
    total,
    truncated: limit != null && total > limit,
  };
}

/**
 * Resolve a file for the AI agent to read. Scoped by `{ id, caseId }`
 * (cross-case reads as not found). Files larger than `maxBytes` short-circuit
 * to `{ tooLarge: true }` WITHOUT a download or audit row — nothing was read.
 * A successful read opens the storage stream and writes an `agent_read` audit
 * row (custody) before returning.
 */
async getFileForAgentRead(
  caseId: string,
  userId: string,
  fileId: string,
  maxBytes: number,
): Promise<AgentReadResult> {
  const row = await this.fileRepo.findOne({ where: { id: fileId, caseId } });
  if (!row) {
    throw new NotFoundException('file_not_found');
  }
  const size = Number(row.size);
  if (size > maxBytes) {
    return { tooLarge: true, name: row.name, mimeType: row.mimeType, size };
  }
  const { stream } = await this.storage.download(row.objectKey);
  await this.log(caseId, userId, 'agent_read', fileId);
  this.logger.log(`agent_read caseId=${caseId} fileId=${fileId}`);
  return { tooLarge: false, name: row.name, mimeType: row.mimeType, size, stream };
}
```

**Step 4: Run tests, confirm pass** — `npm test --prefix backend -- data-room.service.spec` → green.

**Step 5: Commit** — `git add backend/src/modules/data-room/data-room.service.ts backend/src/modules/data-room/data-room.service.spec.ts && git commit -m "feat(data-room): add getManifest and getFileForAgentRead for the agent"` (no Co-Authored-By trailer).

---

## Task 3: Tool definitions + registry
**Implementer:** sonnet
**Files:** Modify `backend/src/modules/ai/tools/tool-definitions.ts`, `backend/src/modules/ai/tools/index.ts`. Test: `backend/src/modules/ai/tools/index.spec.ts`.

**Step 1: Write the failing test** — extend `index.spec.ts`:
```ts
import { AGENT_TOOLS, READ_ONLY_AGENT_TOOLS } from './index';

it('exposes the data-room tools to every role (read-only and full)', () => {
  for (const set of [AGENT_TOOLS, READ_ONLY_AGENT_TOOLS]) {
    const names = set.map((t) => t.name);
    expect(names).toContain('list_data_room_files');
    expect(names).toContain('read_data_room_file');
  }
});
```

**Step 2: Run, confirm fail** — `npm test --prefix backend -- tools/index.spec` → fails.

**Step 3: Implementation** — in `tool-definitions.ts`, add after the productions section:
```ts
// ---------- Data room ----------

export const LIST_DATA_ROOM_FILES_TOOL: Anthropic.Tool = {
  name: 'list_data_room_files',
  description:
    "List all the case's data-room files (evidence locker): id, name, mimeType, size (bytes), and folder path. Use the id with read_data_room_file to read a file's contents. A summary manifest is already provided by get_case_data; use this tool to refresh it or see the full list when it was truncated.",
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export const READ_DATA_ROOM_FILE_TOOL: Anthropic.Tool = {
  name: 'read_data_room_file',
  description:
    "Read a data-room file's contents into the conversation. Pass a fileId from get_case_data's manifest or list_data_room_files. PDFs and images are read natively; spreadsheets (xlsx) and Word docs (docx) are converted to text; CSV/TXT are read as text. Very large files and unsupported types (e.g. un-exported Google-Workspace files) cannot be read inline and return a note instead. The content is provided to you for THIS turn only — it is not retained in conversation history, so call this again if you need the file in a later turn.",
  input_schema: {
    type: 'object' as const,
    properties: {
      fileId: {
        type: 'string',
        description: 'The data-room file id to read.',
      },
    },
    required: ['fileId'],
  },
};
```
Also update `GET_CASE_DATA_TOOL.description` — replace `"data room connection status"` with `"data room file manifest (names, types, sizes, folders)"`.

In `index.ts`: add both names to the two `export { ... } from './tool-definitions'` blocks (the re-export and the local import), then add them to **both** arrays:
```ts
export const AGENT_TOOLS = [
  // ...existing...
  LIST_DATA_ROOM_FILES_TOOL,
  READ_DATA_ROOM_FILE_TOOL,
  ...LABEL_TOOLS,
];

export const READ_ONLY_AGENT_TOOLS = [
  // ...existing...
  READ_PRODUCTION_TOOL,
  LIST_DATA_ROOM_FILES_TOOL,
  READ_DATA_ROOM_FILE_TOOL,
];
```

**Step 4: Run tests, confirm pass** — `npm test --prefix backend -- tools/index.spec` → green; `npm run build --prefix backend` clean.

**Step 5: Commit** — `git add backend/src/modules/ai/tools/tool-definitions.ts backend/src/modules/ai/tools/index.ts backend/src/modules/ai/tools/index.spec.ts && git commit -m "feat(ai): define list_data_room_files and read_data_room_file tools"` (no Co-Authored-By trailer).

---

## Task 4: Wire `DataRoomService` into `AiModule`/`AiService`; build the manifest
**Implementer:** opus
**Files:** Modify `backend/src/modules/ai/ai.module.ts`, `backend/src/modules/ai/ai.service.ts`, `backend/src/modules/ai/ai.service.spec.ts`.

**Step 0: Confirm `dataRoomFileRepo` has no other users** — `grep -n dataRoomFileRepo backend/src/modules/ai/ai.service.ts`. The only use is the `.count()` in `executeCaseDataTool` (~line 889). If any other use exists, KEEP the injection and only add `DataRoomService` alongside it; otherwise remove it as below.

**Step 1: Write the failing test** — in `ai.service.spec.ts` there are **TWO** `Test.createTestingModule` setups that both instantiate `AiService` and both list `{ provide: getRepositoryToken(DataRoomFileEntity), ... }` (around lines 79 and 286). In **BOTH**, remove the `DataRoomFileEntity` repo provider and add a `DataRoomService` mock — otherwise the second module fails with "Nest can't resolve dependencies of AiService". Then assert the manifest is surfaced (in the first/main suite):
```ts
// in the providers array of BOTH testing modules:
{ provide: DataRoomService, useValue: { getManifest: jest.fn(), getFileForAgentRead: jest.fn() } },
// remove from BOTH: getRepositoryToken(DataRoomFileEntity) provider

it('includes the data-room manifest in get_case_data', async () => {
  const dataRoomService = module.get(DataRoomService);
  (dataRoomService.getManifest as jest.Mock).mockResolvedValue({
    files: [{ id: 'a', name: 'x.pdf', mimeType: 'application/pdf', size: 10, folder: '/' }],
    total: 1,
    truncated: false,
  });
  const result: any = await (aiService as any).executeTool(
    toolUse('get_case_data', {}), 'case1', undefined, 'viewer',
  );
  expect(result.dataRoom).toMatchObject({ available: true, fileCount: 1, truncated: false });
  expect(result.dataRoom.files).toHaveLength(1);
});
```
(Import `DataRoomService` in the spec.)

**Step 2: Run, confirm fail** — `npm test --prefix backend -- ai.service.spec` → fails (provider/shape).

**Step 3: Implementation:**
- `ai.module.ts`: remove `DataRoomFileEntity` from `TypeOrmModule.forFeature([...])` and its import line; add `import { DataRoomModule } from '../data-room/data-room.module';` and `DataRoomModule` to `imports`.
- `ai.service.ts` constructor: remove the `@InjectRepository(DataRoomFileEntity) private readonly dataRoomFileRepo` member and the unused `DataRoomFileEntity` import; add `private readonly dataRoomService: DataRoomService,` (import from `../data-room/data-room.service`). Add a module-level const near `MAX_ITERATIONS`:
  ```ts
  const DATA_ROOM_MANIFEST_LIMIT = 25;
  const MAX_AGENT_READ_BYTES = 5 * 1024 * 1024; // 5 MB raw; buildAttachmentBlocks caps base64 beyond this
  ```
- In `executeCaseDataTool`, replace the count block:
  ```ts
  const manifest = await this.dataRoomService.getManifest(caseId, DATA_ROOM_MANIFEST_LIMIT);
  const dataRoom = {
    available: true,
    fileCount: manifest.total,
    truncated: manifest.truncated,
    files: manifest.files,
  };
  ```

**Step 4: Run tests, confirm pass** — `npm test --prefix backend -- ai.service.spec` → green; `npm run build --prefix backend` clean.

**Step 5: Commit** — `git add backend/src/modules/ai/ai.module.ts backend/src/modules/ai/ai.service.ts backend/src/modules/ai/ai.service.spec.ts && git commit -m "feat(ai): inject DataRoomService and surface the file manifest in get_case_data"` (no Co-Authored-By trailer).

---

## Task 5: Dispatch the read/list tools + agent-loop content injection
**Implementer:** opus
**Files:** Modify `backend/src/modules/ai/ai.service.ts`. Test: `backend/src/modules/ai/ai.service.spec.ts`.

**Step 1: Write the failing tests** — add to `ai.service.spec.ts`:
```ts
it('list_data_room_files returns the manifest', async () => {
  const dataRoomService = module.get(DataRoomService);
  (dataRoomService.getManifest as jest.Mock).mockResolvedValue({ files: [{ id: 'a', name: 'x', mimeType: 'text/csv', size: 1, folder: '/' }], total: 1, truncated: false });
  const res: any = await (aiService as any).executeTool(toolUse('list_data_room_files', {}), 'case1', undefined, 'viewer');
  expect(res.files).toHaveLength(1);
  expect(dataRoomService.getManifest).toHaveBeenCalledWith('case1'); // no limit = full list
});

it('read_data_room_file returns a sentinel with content blocks for a supported file', async () => {
  const dataRoomService = module.get(DataRoomService);
  const { Readable } = require('stream');
  // a tiny valid CSV streamed back
  (dataRoomService.getFileForAgentRead as jest.Mock).mockResolvedValue({
    tooLarge: false, name: 'data.csv', mimeType: 'text/csv', size: 3, stream: Readable.from([Buffer.from('a,b')]),
  });
  const res: any = await (aiService as any).executeTool(toolUse('read_data_room_file', { fileId: 'a' }), 'case1', undefined, 'viewer');
  expect(res.__agentReadBlocks).toBeDefined();
  expect(Array.isArray(res.__agentReadBlocks)).toBe(true);
  expect(res.__agentReadBlocks.length).toBeGreaterThan(0);
  expect(res.summary).toMatchObject({ name: 'data.csv', mimeType: 'text/csv' });
});

it('read_data_room_file returns a too-large note without content blocks', async () => {
  const dataRoomService = module.get(DataRoomService);
  (dataRoomService.getFileForAgentRead as jest.Mock).mockResolvedValue({ tooLarge: true, name: 'big.pdf', mimeType: 'application/pdf', size: 99 * 1024 * 1024 });
  const res: any = await (aiService as any).executeTool(toolUse('read_data_room_file', { fileId: 'a' }), 'case1', undefined, 'viewer');
  expect(res.__agentReadBlocks).toBeUndefined();
  expect(res.error || res.note).toBeTruthy();
});

it('read_data_room_file returns an unsupported note when the extractor yields no blocks', async () => {
  const dataRoomService = module.get(DataRoomService);
  const { Readable } = require('stream');
  (dataRoomService.getFileForAgentRead as jest.Mock).mockResolvedValue({
    tooLarge: false, name: 'sheet.gdoc', mimeType: 'application/vnd.google-apps.document', size: 5, stream: Readable.from([Buffer.from('x')]),
  });
  const res: any = await (aiService as any).executeTool(toolUse('read_data_room_file', { fileId: 'a' }), 'case1', undefined, 'viewer');
  expect(res.__agentReadBlocks).toBeUndefined();
  expect(res.error || res.note).toBeTruthy();
});
```

**Step 2: Run, confirm fail** — `npm test --prefix backend -- ai.service.spec` → fails.

**Step 3: Implementation:**

(a) Add a private `streamToBuffer` helper and the two dispatch cases in `executeTool` (after the production cases, before `default`):
```ts
case LIST_DATA_ROOM_FILES_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  return this.dataRoomService.getManifest(caseId); // full manifest: { files, total, truncated }
}

case READ_DATA_ROOM_FILE_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  const { fileId } = toolUse.input as { fileId?: string };
  if (!fileId) return { error: 'fileId is required.' };
  return this.executeReadDataRoomFile(caseId, userId, fileId);
}
```
Note: the dispatch needs `userId`. `executeTool` does NOT currently receive `userId` — thread it through. `streamChat` already has `userId`; add a `userId: string` parameter to `executeTool` and pass it at the single call site (`await this.executeTool(toolUse, caseId, investigationId, viewerRole)` → add `userId`). `list_data_room_files` returns the full manifest unchanged (no folder filter — the schema in Task 3 has no `folderId` param).

(b) `executeReadDataRoomFile`:
```ts
private async executeReadDataRoomFile(
  caseId: string,
  userId: string,
  fileId: string,
): Promise<unknown> {
  let read;
  try {
    read = await this.dataRoomService.getFileForAgentRead(caseId, userId, fileId, MAX_AGENT_READ_BYTES);
  } catch (e) {
    if (e instanceof NotFoundException) return { error: 'File not found in this case.' };
    throw e;
  }
  if (read.tooLarge) {
    return {
      error: `File "${read.name}" is too large to read inline (${(read.size / (1024 * 1024)).toFixed(1)} MB). Ask the user to extract the relevant portion, or use execute_script for bulk processing.`,
      name: read.name, mimeType: read.mimeType, size: read.size,
    };
  }
  const buffer = await streamToBuffer(read.stream!);
  const blocks = await buildAttachmentBlocks([
    { name: read.name, mediaType: read.mimeType, data: buffer.toString('base64') },
  ]);
  if (blocks.length === 0) {
    return {
      error: `File "${read.name}" (${read.mimeType}) is not a readable type. Supported: PDF, images, xlsx, docx, csv, txt.`,
      name: read.name, mimeType: read.mimeType,
    };
  }
  return {
    __agentReadBlocks: blocks,
    summary: {
      name: read.name,
      mimeType: read.mimeType,
      size: read.size,
      note: 'File content provided below for this turn only; it is not retained in history. Call read_data_room_file again if you need it later.',
    },
  };
}
```
Add `streamToBuffer` as a module-level helper:
```ts
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
```
(Import `Readable` from `'stream'` and `NotFoundException` from `@nestjs/common` if not already imported.)

(c) **Agent-loop content injection** — modify the tool loop (`ai.service.ts:523-592`). Introduce an `extraUserBlocks` accumulator and detect the sentinel:
```ts
const toolResults: Anthropic.ToolResultBlockParam[] = [];
const slimResults: Anthropic.ToolResultBlockParam[] = [];
const extraUserBlocks: Anthropic.Beta.BetaContentBlockParam[] = [];
for (const toolUse of toolUseBlocks) {
  yield { type: 'tool_start', data: { name: toolUse.name, input: toolUse.input } };
  const result = await this.executeTool(toolUse, caseId, investigationId, viewerRole, userId);
  yield { type: 'tool_done', data: { name: toolUse.name } };

  if (toolUse.name === EXECUTE_SCRIPT_TOOL.name) { yield { type: 'graph_updated', data: {} }; }
  if (toolUse.name === CREATE_PRODUCTION_TOOL.name || toolUse.name === UPDATE_PRODUCTION_TOOL.name) {
    yield { type: 'production_updated', data: {} };
  }

  // read_data_room_file injects file content as a SEPARATE user turn (see
  // below) — NOT mixed into the tool_result turn. The tool_result itself
  // carries only the slim summary; the heavy document/image blocks live in
  // memory for this loop only and are never persisted (otherwise the file
  // would reload every turn).
  if (result && typeof result === 'object' && '__agentReadBlocks' in (result as any)) {
    const r = result as { __agentReadBlocks: Anthropic.Beta.BetaContentBlockParam[]; summary: unknown };
    const summary = JSON.stringify(r.summary);
    toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: summary });
    slimResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: summary });
    extraUserBlocks.push(...r.__agentReadBlocks);
    continue;
  }

  const fullContent = JSON.stringify(result);
  toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: fullContent });
  slimResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: slimToolResult(toolUse.name, fullContent) });
}
```
Then, where the in-memory history is appended (currently `messages.push({ role: 'assistant', content: responseContent }); if (toolResults.length > 0) messages.push({ role: 'user', content: toolResults });`), keep the tool_result turn pure and add the file content as its OWN user turn, bridged by a synthetic assistant separator. **The `compact-2026-01-12` beta requires a tool-responding user turn to contain only tool_result blocks** — so the document/image blocks CANNOT be appended to the tool_result turn; they must be a separate turn (exactly the repair `mergeConsecutiveRoles` performs at lines 209-216):
```ts
messages.push({ role: 'assistant', content: responseContent });
if (toolResults.length > 0) {
  messages.push({ role: 'user', content: toolResults });
}
if (extraUserBlocks.length > 0) {
  // The beta forbids non-tool_result blocks in a tool-responding user turn,
  // so the file content goes in its own user turn, separated from the
  // tool_result turn by a synthetic assistant message (same pattern as
  // mergeConsecutiveRoles). In-memory only — never persisted.
  messages.push({ role: 'assistant', content: [{ type: 'text', text: '(file content follows)' }] });
  messages.push({ role: 'user', content: extraUserBlocks });
}
```
The persisted save (`slimResults`) is unchanged — it never includes `extraUserBlocks` or the separator. History retains only the summary ack, exactly as intended. Resulting in-memory shape: `assistant(tool_use) → user(tool_result) → assistant("(file content follows)") → user(document/image blocks)`, which alternates roles and keeps every tool_result turn pure.

**Step 4: Run tests, confirm pass** — `npm test --prefix backend -- ai.service.spec` and `-- data-room` → green; `npm run build --prefix backend` clean.

**Step 5: Commit** — `git add backend/src/modules/ai/ai.service.ts backend/src/modules/ai/ai.service.spec.ts && git commit -m "feat(ai): dispatch data-room read/list tools and inject file content into the agent loop"` (no Co-Authored-By trailer).

---

## Task 6: Prompt + skill documentation
**Implementer:** sonnet
**Files:** Modify `backend/src/prompts/investigator.ts`, `backend/src/skills/product-knowledge.md`. No code test (prose); verify build + the full suite stays green.

**Step 1** — in `investigator.ts`, add two bullets to the tool list (mirror the existing `- <tool>: <summary>` style), after the data-related tools:
```
- list_data_room_files: list the case's evidence files (id, name, type, size, folder). A manifest is already in get_case_data; use this to refresh or see the full list when truncated.
- read_data_room_file: read a data-room file's contents (PDF, image, xlsx, docx, csv, txt) into the conversation by fileId. Large/unsupported files return a note. Content is provided for the current turn only — re-read if needed later.
```
If `investigator.ts` has a guideline section, add one line: prefer reading an existing data-room exhibit over asking the user to re-upload it.

**Step 2** — in `product-knowledge.md`, under the AI capabilities section, add:
```
- **Reads case evidence:** the agent can list the data room and read file contents directly (PDFs, images, spreadsheets, Word docs, CSV/text) without re-upload. Each read is access-logged as `agent_read` for chain of custody. Very large files and un-exported Google-Workspace files can't be read inline.
```

**Step 3: Run the full backend suite + build** — `npm test --prefix backend` (all green) and `npm run build --prefix backend` (clean).

**Step 4: Commit** — `git add backend/src/prompts/investigator.ts backend/src/skills/product-knowledge.md && git commit -m "docs(ai): teach the agent about data-room list/read tools"` (no Co-Authored-By trailer).

---

## Engineering decisions (logged, not blocking)
- **`list_data_room_files` has no `folderId` param** — the manifest exposes folder *paths*, not ids, so a precise id filter would need extra plumbing for marginal value. The tool returns the full manifest; the agent can read folder paths from the entries. (Task 3 schema omits `folderId`; Task 5 dispatch returns the full manifest.)
- **Inline manifest cap = 25**, full list via `list_data_room_files`. Adjustable constant.
- **`MAX_AGENT_READ_BYTES = 5 MB`** raw — above the largest `buildAttachmentBlocks` base64 cap, so anything that would only produce a size-stub is rejected before download.
- **Per-task commits** are intentional for this run (fullsend autonomous build), overriding the repo default of "don't commit" — the operator invoked `/fullsend`, which builds-and-merges.
