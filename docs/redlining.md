# Redlining

`redline` is a structured production type: a **true redline** of an existing draft — a declaration, brief, memo, or letter someone else wrote — reviewed against the case's on-chain record. The server snapshots the draft's text once, verbatim, into an immutable `baseText`. The model never rewrites or regenerates the document; it proposes a set of surgical, anchored, evidence-backed edits and comments, which the analyst triages (accept/reject/modify) in the UI. Only accepted edits are exported, and DOCX export writes them as real Word tracked changes onto the original file.

Related: [ai-system.md](./ai-system.md), [data-room.md](./data-room.md), [declarations.md](./declarations.md).

## Production Type

`ProductionType` (`backend/src/database/entities/production.entity.ts`) adds `redline` alongside `report`, `chart`, `chronology`, `declaration`. Like `declaration`, it is server-seeded: `ProductionsService.create()` routes `type: 'redline'` through `RedlineIngestService.buildData()`, which requires `data.sourceFileId` (400 if missing or not a string) — everything else in the shape (`baseText`, empty `edits`/`comments`) is derived, never supplied by the caller.

Redline data is also the only production type that is **immutable-by-default and ops-only**: `PATCH /productions/:id` with a full-replace `data` payload 400s (`redline productions are ops-only`) once a production is type `redline`. The `type` field is sealed in both directions — a PATCH that would flip a production to or from `redline` 400s (`cannot change a production type to or from "redline"`), so a redline can never be converted into another type, and no other type can be converted into a redline after creation.

`PATCH /productions/:id` still accepts either `data` (full replace, rejected as above) or `ops` (atomic mutations), mutually exclusive. Redline ops (each 400s if applied to a non-redline production):

| Op | Effect |
|----|--------|
| `redline_add_edit` | Propose a new edit (`kind` replace/delete/insert_after) anchored to a verbatim quote; resolves the anchor and checks it doesn't overlap an existing live edit |
| `redline_update_edit` | Triage or revise an edit — `status`, `newText`, `basis`, `comment` (the anchor and `kind` are immutable) |
| `redline_remove_edit` | Delete an edit |
| `redline_add_comment` | Add a document-level reviewer note (`title`, `text`), not tied to any span |
| `redline_update_comment` | Edit a comment's `title`/`text` |
| `redline_remove_comment` | Delete a comment |

## Data Shape

`RedlineData` is defined in `backend/src/modules/productions/redline-data.ts`, mirrored in `contracts/schemas/productions.yaml` and the generated `api-types.ts` on both sides:

```ts
interface RedlineData {
  schemaVersion: 1;
  source: RedlineSource;   // { fileId, fileName, mimeType, kind: 'docx'|'pdf', extractedAt }
  baseText: string;        // immutable snapshot; paragraphs separated by '\n\n'
  edits: RedlineEdit[];
  comments: RedlineComment[];
}

interface RedlineEdit {
  id: string;                                            // server-generated UUID
  kind: 'replace' | 'delete' | 'insert_after';
  anchor: { text: string; start: number; end: number };  // raw char offsets into baseText
  newText: string;                                       // '' for kind 'delete'
  basis: string;                                         // the forensic justification, required
  comment?: string;                                      // optional extra drafting note
  status: 'proposed' | 'accepted' | 'rejected';          // always 'proposed' on creation
  origin: 'agent' | 'user';
}

interface RedlineComment {
  id: string;
  title: string;
  text: string;
}
```

`baseText` is snapshotted once at creation time (see Ingest below) and there is no op that touches it directly — it stays fixed for the life of the production. That immutability is what the full-replace-`data` 400 and the type-conversion 400 (above) both exist to protect: nothing can retroactively change the text every accepted edit's anchor is validated against.

## Anchor Semantics

Every edit anchors to a verbatim quote from `baseText`, resolved by `resolveAnchor()`:

- The quote is normalized before matching (`normalizeForAnchor`): curly quotes (`'` `'` `"` `"`) fold to straight ASCII, NBSP and non-breaking hyphens fold to their plain equivalents, `fi`/`fl` ligatures expand, and whitespace runs collapse to a single space.
- The normalized quote must be **at least 8 characters** (`MIN_ANCHOR_LENGTH`).
- It must match **exactly once** in the normalized `baseText`.
- It must not cross a paragraph boundary — `baseText` paragraphs are separated by `\n\n`, and a match spanning a `\n` fails.

`resolveAnchor` reports one of:

| Error | Meaning |
|-------|---------|
| `anchor_too_short` | Normalized quote is under 8 characters |
| `anchor_not_found` | No match in `baseText` |
| `anchor_ambiguous` | More than one match (`count` reports how many) — quote a longer span to disambiguate |
| `anchor_crosses_paragraphs` | The single match spans a paragraph break |

**Overlap rule:** a new `replace`/`delete` edit cannot overlap the anchor span of any existing edit that is both non-rejected and not itself `insert_after`. `insert_after` edits never participate in the overlap check — neither as the new edit nor as an obstacle — since they don't consume a span of `baseText`, they only append after one. Rejecting an edit frees its span for a later edit to reclaim.

## Ingest

`RedlineIngestService.buildData()` (`backend/src/modules/productions/redline-ingest.service.ts`) runs once, from `ProductionsService.create()`, when a redline is created with `data.sourceFileId`:

1. `DataRoomService.getFileForRedline(caseId, sourceFileId, actorUserId)` fetches the source file — `.docx` or `.pdf` only, capped at 20MB (`REDLINE_MAX_BYTES`); a missing/wrong-case file 404s (`file_not_found`), an oversized file 400s, an unsupported mime type 400s. The read is logged to `data_room_access_log` as a `download` action, same chain-of-custody trail as a manual download.
2. `extractBaseText()` (`redline-extract.ts`) converts the buffer to text: `mammoth.extractRawText()` for `.docx`, `unpdf`'s `getDocumentProxy`/`extractText` (per-page, then joined) for `.pdf`. Newlines are normalized (CRLF/CR to LF, trailing whitespace stripped per line, 3+ blank lines collapsed to one) so paragraph gaps land reliably on `\n\n`.
3. `seedRedlineData()` wraps the result into the `RedlineData` shape above with empty `edits`/`comments`.

New backend dependencies for this pipeline: `jszip` (^3.10.1), `@xmldom/xmldom` (^0.9.10), `unpdf` (^1.6.2); `mammoth` (^1.12.0) was already a dependency.

## Triage and Preview

`RedlineViewer` (`frontend/src/components/Productions/RedlineViewer.tsx`, mounted from `ProductionViewer.tsx`) is a two-pane editor: the left pane renders the marked-up document (built by `buildRedlineSegments`, `frontend/src/utils/redlineSegments.ts`) with clickable `<del>`/`<ins>` spans; the right pane lists every edit as a card — kind badge, status badge, origin (agent/user), the anchored text, the proposed `newText`, the `basis`, and any drafting comment — with Accept/Reject/Undo/Modify actions and status-count badges (proposed/accepted/rejected) in the header. A collapsible "Reviewer notes" section manages the document-level comments. When the source was a PDF, a banner flags the pane as a reconstruction of the original layout. Every mutation goes through `PATCH /productions/:id` with `redline_*` ops via `apiClient.updateProduction()`.

`GET /productions/:id/redline-preview?mode=triage|accepted` (`RedlineController`) renders the same document server-side as standalone HTML, case-access checked the same way as any other production read:

- `triage` (default): every edit shown — proposed/accepted edits render as active marks, rejected edits render their original text dimmed; every edit gets a superscript endnote marker linking to an "EDIT NOTES" section (kind, status, basis, comment), plus the reviewer-notes comments and the proposed/accepted/rejected counts.
- `accepted`: only accepted edits render as marks; proposed and rejected spans render as plain base text — no endnotes, no reviewer notes. This is the same clean, court-ready rendering export uses.

## Export

`POST /exports/productions/:id` — `redline` allows `pdf` and `docx` only.

- **PDF** always renders `renderRedlineHtml(data, { mode: 'accepted' })` through Puppeteer, Letter portrait, plain 1in margins. It never fails on unaccepted or rejected edits — those spans simply render as unmarked base text.
- **DOCX** has two paths, chosen by `source.kind`:
  - **`docx` source (gold path):** `applyTrackedChangesToDocx()` (`backend/src/modules/export/docx-redline.ts`) re-fetches the original source bytes via `DataRoomService.getFileForRedline()` and applies only the **accepted** edits directly onto the source XML as native Word tracked changes (`w:ins`/`w:del`), author `Daubert`, with a margin comment per edit carrying its `basis` (and `comment`, if present). Untouched markup stays byte-faithful.
  - **`pdf` source (reconstructed):** no original DOCX bytes exist, so export falls through to the generic `htmlToDocx()` render of the accepted-mode HTML; the filename gets a `_reconstructed` suffix so it's never mistaken for a tracked-changes redline of the real source.

Failure modes on `docx` export:

- **Zero accepted edits** → 400 (`No accepted edits to export`). PDF export is unaffected by this — it's still allowed with zero accepted edits.
- **Source file deleted from the data room** (docx-source path only) → 400 (`Source document no longer in the data room — export PDF instead`).
- **An accepted edit's anchor can't be relocated in the source XML** (ambiguous or not found when re-matched against the live document) → 400 listing every failed anchor's quoted text.

## Agent Surface

The `redlining` skill (`backend/src/skills/redlining.md`) teaches agents the review workflow: read the full source document before doing anything else, create the redline production from a data-room file, verify every factual or on-chain claim against the case record before proposing a fix, propose the smallest anchored edit with a cited `basis`, route non-textual risk flags to comments instead of edits, and never regenerate or restate the document — the analyst triages every proposal.

Both agent surfaces read the source draft the same way — `list_data_room_files` to locate it, `read_data_room_file` to pull its full contents — so the workflow in the `redlining` skill is identical on chat and MCP:

| Surface | Read | Write |
|---------|------|-------|
| Built-in chat agent | `list_data_room_files`, `read_data_room_file`, `read_production` | `create_production` (type `redline`), `update_production` (redline ops) |
| MCP (bring-your-own-agent) | `list_data_room_files`, `read_data_room_file`, `read_production` (case role asserted per call) | `create_production`, `update_production` (case role asserted per call, audited) |

See [ai-system.md](./ai-system.md) for dispatch, MCP auth, and audit details.
