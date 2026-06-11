# Agent Data-Room Reading

**One-liner:** Connect the data room to the agent's existing document-parsing pipeline so the investigator agent can list and read case evidence (PDFs, images, spreadsheets, docs) directly — no re-upload — turning the data room from a passive locker into the agent's evidence corpus.

## Problem & why now

The agent already has a full multimodal parsing pipeline — `backend/src/modules/ai/attachment-blocks.ts` (`buildAttachmentBlocks`): PDFs and images go to Claude natively, XLSX→CSV text, DOCX→text (mammoth), CSV/txt decoded, all with size caps and graceful "too big" stubs.

But that pipeline is wired **only to chat attachments** — files a user drags into a single message. The data room is a separate silo. The agent sees only a file *count* (`dataRoom: { available: true, fileCount }`, `ai.service.ts:~889`) — never the names, never the contents. A user with 20 exhibits in the room must **re-upload each one into chat** for the agent to use it.

For a forensics product whose centerpiece is the agent, the agent being blind to the case's own evidence is the glaring gap. The parsing is already built; only the bridge is missing.

## Fit with strategy

- **Evidence-grade product (Daubert):** the agent reasoning over the actual exhibits — subpoena responses, bank statements, KYC docs, CSV transaction exports — is the core forensic value, not a side feature.
- **Chain-of-custody:** every file access in the room is already logged; an AI reading an exhibit is a custody event and is logged as such (`agent_read`).
- **Reuse, not rebuild (`CLAUDE.md` — recommend the complete solution, no patches):** the multimodal extractor exists. This is a bridge from GCS-stored files into that extractor, not a new "teach the agent to read files" build.

**The bet:** the highest-leverage thing we can do with stored evidence is make it legible to the agent. Everything else (write-back, preview) is secondary.

## The idea (refined)

1. **Proactive manifest.** Replace the bare file *count* in the agent's case context with a real **manifest**: each file's `{ id, name, mimeType, size, folder path }`. The agent knows what's available without a tool round-trip and can proactively offer ("I see a subpoena response and 3 bank statements — want me to reconcile them?").
2. **`read_data_room_file` tool.** Given a `fileId` (from the manifest), the backend pulls the GCS object via the existing `StorageProvider.download(objectKey)` and runs the bytes through the **same** `buildAttachmentBlocks` extraction used for chat attachments (PDF→document block, image→image block, XLSX→CSV text, DOCX→text, CSV/txt→text). The result enters the conversation.
3. **Custody.** Each read writes an `agent_read` access-log row, actor = the requesting user.
4. **Role + tenancy.** Read requires `viewer`+ (mirrors download). The agent acts on behalf of the requesting user and is scoped to the current case only — file lookup is keyed by `{ id, caseId }`, so another case's `fileId` is structurally not found.

## Product decisions (locked — anchors for autonomous execution)

- **Read-only.** No write-back in this scope (deferred — see Out/later).
- **Proactive manifest** of `{ id, name, mimeType, size, folder }` injected into the agent's case context (the path that today returns `dataRoom: { available, fileCount }`). The agent does **not** need a separate tool call to *discover* files. A `list_data_room_files` tool may still exist for explicit refresh / folder navigation — that's an engineering call for `/plan`.
- **Reading reuses `buildAttachmentBlocks`** verbatim — same caps, same type classification, same graceful stubs, same Google-Workspace handling. **No new parsing code.**
- **Custody:** every agent read logs an `agent_read` row. This is a **new action value only** — `DataRoomAction` in `data-room-access-log.entity.ts` gains `'agent_read'`; the column is `character varying`, so **no migration is required.** Actor = requesting user.
- **Tooling registration:** the read tool goes in both `AGENT_TOOLS` and `READ_ONLY_AGENT_TOOLS` (`backend/src/modules/ai/tools/index.ts`) since it is a read.
- **DB-history slimming:** a large file's extracted content must NOT persist verbatim in message history (it would reload every turn). Mirror the existing production-slimming pattern — persist a slim stub `{ name, mimeType, size, truncated }`; keep full content in-memory for the current agent loop only.
- **Load-bearing technical decision left to `/plan`:** how an extracted PDF/image re-enters the conversation — Anthropic `tool_result` blocks carrying document/image content, vs. injecting a synthetic user turn built from `buildAttachmentBlocks` output. Both reuse the extractor; the implementer picks. (The synthetic-user-turn route is closest to the existing attachment path.)

## Scope

**In (MVP):**
- **Manifest:** replace the bare count in the agent's case-context builder with a file list (`id, name, mimeType, size, folderId`/path). Source it from the same query `listContents`/`listFiles` uses (`data-room.service.ts`).
- **`read_data_room_file` tool:** schema in `tools/tool-definitions.ts`, registered in `tools/index.ts` (both `AGENT_TOOLS` and `READ_ONLY_AGENT_TOOLS`), dispatched in `ai.service.ts` `executeTool`. Flow: `fileId` → resolve `{ id, caseId }` → `getFileForDownload` (GCS stream) → buffer → `buildAttachmentBlocks` → into conversation.
- **`agent_read` custody logging** on every read (reuse `DataRoomService` private `log()`).
- **Reuse** existing size caps / classification / Workspace stubs from `attachment-blocks.ts` — refactor it if needed so it can take in-memory bytes from a GCS download, not just an `AttachmentDto`.
- **Prompt + skill:** add the tool to `backend/src/prompts/investigator.ts` and `backend/src/skills/product-knowledge.md` so the agent knows when to use it.
- **Tests** mirroring the existing tool tests + `attachment-blocks.spec.ts`.

**Out / later:**
- **Write-back** (agent saves generated reports/exports into the room as files) — the obvious next phase. Brings a custody wrinkle: distinguishing AI work-product from original evidence.
- **Search across files** / per-case index.
- **Exposing data-room reads to `execute_script`** for multi-MB processing without inflating the conversation.
- **Caching** downloaded content across reads.

## Risks & open questions

- **Weakest assumption:** that routing a file back into the conversation *from a tool* is clean. Tool results are JSON strings today; PDFs/images are multimodal content blocks. This is the one real design fork — flagged above, resolved in `/plan`.
- **Token governance:** a case with many/large files plus an eager agent could blow context. Mitigate with on-demand single-file reads + the existing caps; consider a soft guard on simultaneous reads.
- **Native Workspace files** already in the room (e.g. an un-exported Google Doc): reuse the existing `classify()` rejection/stub — no new handling.
- **Manifest size:** a case with hundreds of files makes the manifest large. If that becomes real, cap the inline manifest (e.g. most-recent N + a `list_data_room_files` tool for the rest) — note, don't pre-build.
