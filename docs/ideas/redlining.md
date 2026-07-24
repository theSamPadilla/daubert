# AI-Driven Redlining

**One-liner:** Review counsel's draft filings against the case's on-chain record and return a true redline — anchored tracked-change edits, each carrying its forensic basis — as a new production type.

## Problem & why now

Tested manually via claude.ai against the July 10, 2026 MTC letter (Sun v. Geffen). The substance was excellent — it caught a supply figure off ~1,000x in fn. 1, a JustLend deposit mischaracterized as "public liquidity" in fn. 24, and a fn. 25 citation that contradicted the brief's own pump-and-dump theory — all by cross-checking the letter against the case's traced record. But the output was a *memo about edits*, not a redline. The failure is structural, not promptable:

1. **No faithful substrate** — the model only had a PDF, and an LLM cannot reproduce 7 pages verbatim-except-for-edits without drift.
2. **No redline-capable medium** — chat output has no concept of tracked changes; real redlines are Word revisions (`w:ins`/`w:del`) or deterministic diffs.

Lawyers need the artifact they already know: the draft itself with tracked changes and margin comments, which they accept/reject in Word.

## Fit with strategy

The productions arc (reports, chronologies, declarations) points one direction: Daubert → court artifact. Redlining is the reverse: counsel's draft → checked against the case record. Same moat, new direction — generic tools (Word Compare, Litera, Harvey) can diff text, but none can verify a footnote's transaction hash against the actual trace, the labeled-entity registry, or prior internal productions. It reuses the declaration playbook wholesale: typed production, atomic ops, both agent surfaces (chat + MCP), the export module, the productions workspace.

## The idea (refined)

- **New production type `redline`.** Base document comes from the data room (DOCX preferred, PDF fallback). Base text is extracted server-side and stored **immutable** with the production — the snapshot the whole redline anchors to.
- **The model never regenerates the document.** It proposes atomic anchored ops: `{ anchor: exact quoted span, op: replace | delete | insert_after, newText, basis, comment }`. The backend validates each anchor resolves to *exactly one* location in the base text (after normalization for quotes/ligatures/whitespace). Ambiguous or unmatched anchors are rejected and the agent retries with a longer quote — self-correcting by construction.
- **Document-level comments** (unanchored) capture memo-grade material — risk register, open items, drafting cautions — as a cover note instead of losing it.
- **Triage UI** in the productions workspace: one card per proposed edit showing anchored context, proposed text, and basis, with accept / reject / modify. Per-op `status` field.
- **Export:**
  - DOCX source → the *same DOCX* back with real OOXML tracked revisions and margin comments carrying the basis, containing only accepted edits, authored as Daubert. Counsel retains final accept/reject in Word.
  - PDF source → a reconstructed redline (rendered text with strike/insert marks + comment rail), clearly labeled as a reconstruction, exportable to PDF/DOCX.
- **`redlining` skill** teaches both agent surfaces the workflow: read the draft from the data room, cross-check every on-chain factual assertion (figures, tx hashes, characterizations) against case data *before* proposing an edit, quote anchors exactly, attach basis refs.

## Product decisions

- **Input contract: DOCX-first, PDF fallback.** DOCX is the gold path (drafts live in Word); PDFs are accepted but produce a labeled reconstruction, never a facsimile claim.
- **Review model: in-app triage.** The analyst curates every AI-proposed edit before export; unvetted model output never reaches counsel. Export emits accepted edits *as tracked changes* — Daubert never silently applies an edit or produces a "clean" rewritten document.
- **Every anchored edit carries a basis** (free text + optional refs to transactions/productions), surfaced as margin comments in the DOCX export.
- **Not a document editor.** Scope is review-and-redline of drafts against the case record — no collaborative editing, no Word competitor ambitions.

## Engineering decisions made

- Redline is a production type reusing the existing ops pattern (like `chronology`/`declaration`), not a standalone module.
- Base text is snapshotted into the production at creation, not re-read from the data room (the redline must stay coherent if the file changes).
- Anchor validation is server-side, exact-match-after-normalization, uniqueness required — never fuzzy-guess a location.

## Scope

- **In (MVP):** `redline` production type + ops; DOCX and PDF text extraction into the immutable base; anchor validation; triage UI with per-edit status; DOCX tracked-changes export for DOCX sources; reconstructed redline preview + export for PDF sources; `redlining` skill; MCP parity via existing `create_production`/`update_production`.
- **Out / later:** deterministic two-version compare mode (upload original + revised, diff them); multi-round redlines (redline of a redline); collaborative/live editing; a dedicated verification engine that re-runs scripts per basis (the agent can verify in-loop with `execute_script`; no separate machinery).

## Risks & open questions

- **Weakest assumption:** writing tracked changes into an existing DOCX while preserving formatting (footnotes especially — where the highest-value corrections live) is tractable via direct OOXML manipulation. `html-to-docx` cannot do this; it needs XML surgery on the source file. If footnote/numbering handling proves intractable, the gold path degrades to reconstruction-for-DOCX-too — the feature survives but loses its headline. **The plan should front-load a spike on this.**
- **Anchor robustness:** smart quotes, ligatures, PDF hyphenation and footnote markers. The normalization layer is load-bearing; it must guarantee uniqueness or reject.
- **Long documents:** 7 pages is comfortable in one pass; a 40-page brief needs chunked review agent-side. The ops layer is indifferent, but the skill should teach section-by-section review.
- **Confidentiality:** drafts are privileged work product; they enter through the existing data room and inherit its chain-of-custody. No new storage surface.
