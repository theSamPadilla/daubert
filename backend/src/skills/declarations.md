---
name: declarations
description: How to draft court-ready expert declarations and affirmations across five jurisdiction formats (CA declaration, NY affirmation, Federal § 1746, TX unsworn declaration, FL § 92.525) — the declaration production type, its structured ops, exhibit conventions, and drafting guidance
---

# Declarations

A **declaration** production is a court-ready expert declaration or affirmation: a structured legal document that a testifying expert signs under penalty of perjury. Unlike a report (freeform HTML), a declaration is a **typed structure** the server renders into jurisdiction-correct court format. You fill typed slots; the renderer produces the numbering, letters, oath, caption chrome, and exhibit references.

Load this skill before drafting or editing any declaration.

## The atomic model: structure in, formatting out

Everything below is **computed at render** from structure. You must NEVER write any of it into paragraph text:

- **Paragraph numbers are automatic and continuous** across the whole document, starting at ¶ 1 and never restarting per section. NEVER write "¶ 12", "12.", "As stated in paragraph 8", or "in the preceding paragraph reference by number" into text. If you need to cross-reference, describe it ("as described above"), do not number it.
- **Section letters (A., B., C. …) are automatic**, assigned in section order and prefixed to the (uppercased) heading at render. NEVER put "A." or "SECTION B" into a heading — pass just the title, e.g. `"EXPERT BACKGROUND"`.
- **Sub-items are automatically lettered** a., b., c. within a paragraph. Pass `subItems: [{ text }]` — do not letter them yourself.
- **Exhibit references are automatic.** Attach `exhibitIds: [<id>]` to a paragraph and the renderer emits `See Exhibit B1.` (single) or `See Exhibits B1, B2.` (multiple), with the label bold + underlined, after the paragraph text. NEVER hand-write "See Exhibit B5" or "(Ex. B)" into text.
- **Footnotes render as endnotes** automatically. Pass `footnotes: [{ text }]`; the renderer superscripts a marker in the text and collects the notes as endnotes before the signature block. (Per-page footnotes are not available — they render as endnotes, a known deviation.)
- **The oath / perjury language is automatic** per format (see below). Do not write the opening "I, <name>, declare…" line or the closing perjury/dated block into a paragraph — the renderer emits them. Never write oath or perjury text yourself, in any format.

The structure is: a **caption** (court chrome), a **declarantName**, an ordered list of typed **sections** each holding **paragraphs**, an **exhibit registry**, and an **execution** block (place / date / signature name).

## Creating a declaration

Use `create_production` with `type: "declaration"` and pass only:

```json
{
  "formatId": "ca-declaration" | "ny-affirmation" | "federal-1746" | "tx-declaration" | "fl-declaration",
  "caption": { ... },
  "declarantName": "..."
}
```

`formatId` selects the jurisdiction format. The server seeds a default section skeleton — qualifications, assignment, summary of opinions, background, findings, conclusions — plus empty exhibit and execution blocks. Do NOT pass `sections` or `exhibits` at create time; build all content afterward with `update_production` declaration ops. `caption` and `declarantName` are optional at create and can be set later via ops.

**`tx-declaration` is the one exception:** Texas's jurat (Tex. CPRC § 132.001) recites the declarant's date of birth and address alongside their name, so you MUST also pass `declarantDateOfBirth` and `declarantAddress` when creating a `tx-declaration` (or set them before rendering). No other format needs these fields.

## Building content: the declaration ops

All content is built by `update_production` with declaration ops (see the tool description for exact field shapes). The eight ops:

- `declaration_set_caption { caption }` — partial-merge caption fields: `attorneyBlock`, `court`, `county`, `plaintiff`, `defendant`, `caseNumber`, `documentTitle`, `hearingInfo`.
- `declaration_set_execution { execution }` — partial-merge `place`, `date`, `signatureName`.
- `declaration_add_section { kind, heading, afterSectionId? }` — `kind` ∈ qualifications | assignment | summary_of_opinions | background | authentication | findings | conclusions | recommendations | custom.
- `declaration_add_paragraph { sectionId, text, subItems?, exhibitIds?, footnotes?, afterParagraphId? }`.
- `declaration_update_paragraph { paragraphId, text?, subItems?, exhibitIds?, footnotes? }`.
- `declaration_remove_paragraph { paragraphId }`.
- `declaration_add_exhibit { description, label?, source? }` — omit `label` to auto-assign the next letter (A, B, C…).
- `declaration_update_exhibit { exhibitId, label?, description?, source? }`.

Read the production first (`read_production`) to get section ids, paragraph ids, and exhibit ids before updating — ids are server-generated UUIDs, and paragraph/exhibit ops need them. Sequence ops in a single `update_production` call when possible; they apply in array order (a later op sees the effect of earlier ops in the same call).

## Format differences

`formatId` is chosen at creation and drives the caption chrome, oath/perjury language, and numbering. You write the same section/paragraph content across all five formats; the renderer applies the jurisdiction-specific presentation. **The agent never writes oath or perjury text** — it is rendered automatically per format from the `execution` block (`place`, `date`, `signatureName`) and `declarantName`.

### CA declaration (`ca-declaration`)

- **Caption:** attorney block in the left gutter, a caption box (court, county, plaintiff v. defendant), case number, document title, and hearing info, rendered on 28-line numbered pleading paper with a footer title on every page.
- **Opening (rendered automatically):** `I, <declarantName>, declare:`
- **Closing perjury block (rendered automatically):** `I declare under penalty of perjury under the laws of the State of California that the foregoing is true and correct. Executed <date>, at <place>.`
- Populate `caption.attorneyBlock` (multiline firm/counsel block), `court` (e.g. "SUPERIOR COURT OF THE STATE OF CALIFORNIA"), `county` (e.g. "COUNTY OF SAN FRANCISCO"), `plaintiff`, `defendant`, `caseNumber` (e.g. "Case No. CGC-24-620900"), `documentTitle` ("DECLARATION OF … IN SUPPORT OF …"), and `hearingInfo`. Set `execution.place` and `execution.date` for the Executed clause.

### NY affirmation (`ny-affirmation`)

- **Caption:** simpler box — court/county header, plaintiff "- against -" defendant, Index No. and document title. No attorney gutter block; leave `attorneyBlock` empty.
- **Opening (rendered automatically), perjury up front:** `I, <declarantName>, declare under penalty of perjury and pursuant to C.P.L.R. § 2106, that the following is true and correct:`
- **Closing (rendered automatically):** `Dated: <place>, <date>`
- Populate `caseNumber` as "Index No.: …". Set `execution.place` and `execution.date` for the Dated line.

### Federal declaration (`federal-1746`)

- **Caption:** federal court header (district, plaintiff v. defendant, case/docket number, document title).
- **Opening (rendered automatically):** `I, <declarantName>, declare as follows:`
- **Closing perjury block (rendered automatically):** `I declare under penalty of perjury under the laws of the United States of America that the foregoing is true and correct. Executed on <date>.` — this is 28 U.S.C. § 1746, which does not require a place, only a date.
- Populate the caption fields as for a federal district court filing. Set `execution.date` for the Executed clause; `execution.place` is optional/unused by this format's closing line.

### Texas unsworn declaration (`tx-declaration`)

- **Caption:** Texas caption chrome (court, cause number, style of the case, document title).
- **Opening (rendered automatically):** `I, <declarantName>, declare as follows:`
- **Closing jurat (rendered automatically) — requires DOB and address:** Tex. Civ. Prac. & Rem. Code § 132.001(d) prescribes a jurat that recites the declarant's name, **date of birth**, and **address** before the penalty-of-perjury statement: `My name is <name>, my date of birth is <declarantDateOfBirth>, and my address is <declarantAddress>. I declare under penalty of perjury that the foregoing is true and correct. Executed on <date>.`
- **You MUST populate `declarantDateOfBirth` and `declarantAddress`** (top-level fields alongside `declarantName`) — without them the jurat is incomplete. Ask the user for these if they aren't already known; do not invent them.
- Set `execution.date` for the declaration date.

### Florida declaration (`fl-declaration`)

- **Caption:** Florida caption chrome (court, case number, document title, parties).
- **Opening (rendered automatically):** `I, <declarantName>, declare as follows:`
- **Closing perjury block (rendered automatically), per § 92.525:** `Under penalties of perjury, I declare that I have read the foregoing and that the facts stated in it are true. Executed on <date>.`
- Populate the caption fields as for a Florida filing. Set `execution.date` for the Executed clause.

## Section-by-section drafting guidance

Draft the expert's voice: precise, measured, first-person ("I reviewed…", "In my opinion…"). Each section is a typed `kind` with a plain heading (no letter — the renderer adds it).

**Qualifications** (`qualifications`) — the declarant's expert background. **Call `get_declarants` first** and pull the matching declarant's profile if one exists; its `qualifications` paragraphs are the reusable qualifications (credentials, prior testimony, hourly rate + non-contingency disclosure, engagement reference). Add them as paragraphs rather than re-inventing. Register the CV as an exhibit if the declarant has a `cv_exhibit` reference. `get_declaration_library` no longer holds declarant profiles — it is for **boilerplate** blocks only (chain primers, authentication language).

**Assignment / scope** (`assignment`) — who retained the declarant, and the questions to opine on as **lettered sub-items** (`subItems`): the specific questions the expert was asked to answer. Then a paragraph listing the **materials reviewed**, and a **right-to-supplement** paragraph ("My analysis is ongoing; I reserve the right to supplement or amend these opinions as additional information becomes available."). Cite the engagement/data as exhibits where appropriate.

**Summary of opinions** (`summary_of_opinions`) — a short, plain statement of the conclusions, expanded later in findings. Often mirrors the conclusions as a preview.

**Background** (`background`) — a technical primer written for a **lay judge**: explain the relevant chain (e.g. how Solana/Ethereum transactions, addresses, and explorers work) in accessible terms, only as much as the findings require. **Pull from library `boilerplate` blocks (primers) via `get_declaration_library`** when available — chain primers are formulaic modules meant to be reused verbatim. Do not assume the reader knows blockchain terminology.

**Authentication** (`authentication`) — paragraphs establishing that the exhibits are what they purport to be: "The records attached as [exhibit] are true and correct copies obtained from <explorer> on <date>… I independently verified the transaction via <method> (e.g. an RPC `getTransaction` call / the block explorer's record)." One per exhibit group. Reference the exhibits via `exhibitIds`.

**Findings** (`findings`) — the analytical core. Use **argumentative headings that STATE the finding**, not neutral labels — e.g. "FUNDS FROM THE HACK WERE ROUTED THROUGH A MIXER," not "Analysis of Fund Flow." **Define wallet shorthands on first use**: introduce a wallet as "the wallet ending dK4GrZ (the 'dK4GrZ Wallet')" and use "the dK4GrZ Wallet" thereafter. Every factual claim tied to a transaction or record should **cite an exhibit via `exhibitIds`** — never a hand-written reference. Walk the flow of funds step by step, each step grounded in an exhibit.

**Conclusions** (`conclusions`) — an "it is my opinion that:" paragraph followed by **lettered sub-items** (`subItems`), one opinion each (a., b., c. …), tracking back to the assignment's questions.

**Recommendations** (`recommendations`, optional) — any recommendations to the court.

**Custom** (`custom`) — anything that doesn't fit the typed kinds.

## Exhibit conventions

Exhibits are a registry: each has an auto- or hand-assigned label (A, B, B1…), a description, and an optional `source`. The primary workflow is **agent-driven insertion from graph evidence**.

When the user says something like *"add transaction 0xabc… to the declaration with an explanation of the transfer"*:

1. **Fetch the transaction from the graph** with `get_investigation` (or the case graph data) — get the from/to addresses, token, amount, timestamp, chain, and the explorer URL.
2. **Write the finding paragraph** into the appropriate `findings` section describing the transfer in the expert's voice (who sent what to whom, when, why it matters). Do not write the exhibit reference into the text.
3. **Register the exhibit** with `declaration_add_exhibit`, description summarizing the record, and `source: { kind: "transaction", txHash: "0xabc…", chain: "ethereum", url: "<explorerUrl>" }`. Omit `label` to auto-letter it.
4. **Reference the exhibit's returned id** from the paragraph via `declaration_update_paragraph` (or set `exhibitIds` when you add the paragraph, if the exhibit already exists). The renderer emits "See Exhibit <label>." automatically.

`source.kind` is `transaction` (on-chain record — set `txHash`, `chain`, `url`), `url` (a web/explorer page — set `url`), `file` (a data-room document — set `note` to identify it), or `other` (set `note`). Use `null` for an exhibit with no linkable source yet.

## Honesty rules

The declaration carries the expert's name and perjury oath — accuracy and candor are non-negotiable.

- **Disclose gaps explicitly.** If funds enter a mixer and cannot be followed, if a flow is unattributable, or if transaction history is incomplete, say so in plain terms. Do not paper over uncertainty.
- **Never overstate.** Distinguish what the on-chain data shows from inference. Use hedged language where the evidence is circumstantial ("consistent with", "indicates", "I was unable to determine").
- **The draft is for the expert to own and edit.** Produce a faithful, well-structured draft grounded in the evidence; the testifying expert reviews, corrects, and signs it. Do not invent facts, credentials, or citations to fill a slot — leave it for the expert or ask the user.
