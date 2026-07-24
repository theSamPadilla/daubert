---
name: redlining
description: How to review and redline a draft document (a declaration, brief, or memo someone else wrote) against the case record — creating a redline production, verifying claims, and proposing tracked-change edits
---

# Redlining

A **redline** production reviews an existing draft document — a declaration, brief, memo, or letter someone else wrote — against the case record. The server snapshots the draft's text once, verbatim, into an immutable `baseText`. You do not rewrite the document; you propose a set of surgical, evidence-backed edits and comments that the user triages in the UI. Only accepted edits are exported as native tracked changes.

Load this skill before creating or editing any redline production.

## Workflow

1. **Find the draft and read it for full context.** Check `get_case_data`'s manifest or call `list_data_room_files` to locate the file, then `read_data_room_file` to read its full contents before doing anything else. You need the whole document in context to judge factual claims and paragraph boundaries — do not propose edits from a partial read.

2. **Create the redline production.** Call `create_production` with `type: "redline"` and `data: { sourceFileId }`, where `sourceFileId` is the data-room file id from step 1 (.docx preferred, .pdf fallback). The server extracts the document's text and snapshots it into an immutable `baseText` — this is the fixed reference every anchor is matched against. You cannot edit `baseText` itself; all changes are proposed as ops layered on top of it.

3. **Verify before proposing.** Every factual or on-chain assertion in the draft — supply figures, transaction hashes, wallet characterizations, valuations, dates, counts — must be checked against the case record BEFORE you propose an edit for it. Use `get_investigation` for graph data, `query_labeled_entities` for wallet/entity attribution, `execute_script` for aggregations the graph tools can't answer directly, and `read_production` to check prior productions (declarations, chronologies, reports) for figures already vetted in this case. **No edit without a verified basis.** If you cannot verify a claim either way, do not propose a "fix" — flag it as an open item instead (see step 5).

4. **Propose edits with `redline_add_edit`.**
   - One factual issue per edit — do not bundle multiple unrelated fixes into a single anchor span.
   - Use the smallest anchor span that contains the problem, not the whole sentence or paragraph.
   - `anchorText` must be quoted VERBATIM from the document — copy it character-for-character, at least 8 characters, and entirely within a single paragraph (anchors cannot cross paragraph breaks).
   - `newText` should read in the document's own voice — match its tone and register, don't drop in a disconnected fact.
   - `basis` must cite the specific evidence that justifies the change (a tx hash, a figure from a production, a labeled-entity match) — not a vague "per case record."
   - If the server returns `anchor_ambiguous` or `anchor_not_found`, re-quote a longer exact span from the document and retry once. Do not guess at a paraphrase.

5. **Route memo-grade material to comments, not edits.** Risk flags, open items, strategic cautions, and anything that isn't a proposed textual fix belongs in a document-level `redline_add_comment` (`title`, `text`) — never stuffed into edit text or a fabricated `newText`. Comments aren't tied to a span; they're a cover note for the reviewer.

6. **Never regenerate or restate the document.** Your job is proposing changes, not producing a new draft. The user reviews and triages every proposal in the UI (accept, reject, or leave pending); only accepted edits are ultimately exported as tracked changes in the final document. Triage and cleanup use `redline_update_edit`, `redline_remove_edit`, `redline_update_comment`, and `redline_remove_comment` — see the `update_production` tool description for the full op shapes.
