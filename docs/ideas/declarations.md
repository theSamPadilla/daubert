# Declarations as a First-Class Production Type

**One-liner:** A structured `declaration` production type that renders court-ready expert declarations/affirmations — typed sections of auto-numbered paragraphs, an exhibit registry wired to graph evidence, jurisdiction-correct chrome — fed by an org-level library of reusable declarant profiles and boilerplate.

## Problem & why now

The onboarding north star is "first trace → declaration," but today a declaration is a blank HTML report in a freeform Tiptap editor. Analysis of four real filings (two of them Incite's own — Widmann NY affirmation + CA declaration — plus the opposing expert's declaration in the same matter) shows the genre is rigid and highly standardizable, and that freeform HTML structurally cannot deliver it: continuous paragraph numbering across sections, lettered sub-paragraphs, exhibit cross-reference integrity ("See Exhibits B5, B6"), footnotes with accessed-dates, and California 28-line pleading paper are all unenforceable in a rich-text blob.

## Fit with strategy

- The declaration is the product's endgame deliverable — the thing the Daubert name promises. Making it first-class is higher leverage than any onboarding polish; the onboarding idea's step ④ ([[case-onboarding]]) now targets this type instead of a freeform report.
- The agent already has `create_production`/`update_production`; a structured schema makes AI drafting *more* reliable, not less — the agent fills typed slots instead of a blank page.
- Org-scoped reuse fits the multi-org model: the examples show Widmann's qualifications paragraphs recycled near-verbatim across matters, and chain primers/authentication language are formulaic modules.

## The format, standardized (from the examples)

Three layers:

1. **Jurisdiction chrome** — caption block + oath variant. CA declaration: attorney block, caption box, case no., document title, hearing info, 28-line numbered pleading paper, footer title on every page, perjury clause at the end ("under the laws of the State of California… Executed this [day] of [month] [year], at [place]"). NY affirmation: simpler caption ("- against -", Index No.), perjury language up front citing CPLR § 2106.
2. **Reusable blocks** (org library) — declarant profile (qualifications ¶s, CV as exhibit, prior-testimony list, hourly rate + non-contingency disclosure, engagement letter ref); per-chain technical primers (the Solana/PoS explainer for the court); evidence-authentication boilerplate ("true and correct copies obtained from [explorer]… verified via RPC getTransaction").
3. **Case-specific content** — assignment/scope (who retained, lettered opine-on questions, materials reviewed, right-to-supplement), summary of opinions, findings sections with argumentative headings that state the finding, defined shorthands ("the dK4GrZ Wallet"), conclusions ("it is my opinion that: a. b. c."), optional recommendations to the court.

The atomic unit throughout is the **continuously numbered paragraph** (with lettered sub-paragraphs and footnotes), grouped into typed sections.

## The idea (refined)

- **New production type `declaration`** with structured JSONB: caption fields, jurisdiction variant, declarant ref, `sections[]` (typed: qualifications | assignment | summary-of-opinions | background | authentication | findings | conclusions | recommendations | custom), each holding paragraphs with auto-managed continuous numbering, sub-paragraphs, and footnotes; an **exhibit registry** (auto-lettered entries: label, description, source ref — txHash/explorer link, data-room file, or upload); execution block (place, date, oath text per variant, signature line).
- **Renderer**: faithful HTML/print-CSS output per jurisdiction variant (including CA pleading paper + per-page footer title) with PDF export.
- **Section-aware editor**: paragraph-level editing, exhibit references as chips that stay consistent when exhibits reorder; not freeform rich text.
- **Org library**: declarant profiles and boilerplate blocks stored per-org, insertable into any case's declaration.
- **Agent-driven composition**: the primary flow for evidence content is conversational — "add transaction XYZ to my declaration with an explanation of the transfer" → the agent writes the finding paragraph, registers the exhibit, and fills its source data (explorer URL, raw record) from the graph, keeping cross-references consistent. Full-draft generation (the onboarding handoff) fills the same schema.

## Product decisions

1. **Structured production type, not a template on `report`.** The schema is the product; formatting guarantees come from the renderer, not user discipline.
2. **Org-level reusable library** for declarant profiles and boilerplate blocks — matches real reuse patterns across matters; nothing firm-specific hardcoded into the product.
3. **Exhibits: manual registry + agent-driven insertion.** The user can register exhibits by hand; the primary path is asking the agent to add a transaction/finding, which auto-fills the exhibit's source ref from graph data. Batch auto-generation of exhibit artifacts (explorer screenshots, raw RPC dumps) is later.
4. **Jurisdiction variants at MVP: CA declaration + NY affirmation** — both formats are in hand from real examples. Variant is a property of the document, chosen at creation.
5. **Onboarding integration:** [[case-onboarding]] step ④ produces this type via the declaration skill.

## Scope

- **In (MVP):**
  - `declaration` production type + schema; section-aware editor; exhibit registry.
  - Renderer for the two jurisdiction variants with print-faithful output + PDF export.
  - Org library: declarant profiles + boilerplate blocks (create, edit, insert).
  - Agent support: declaration-aware ops on `create_production`/`update_production` (add paragraph, add finding + exhibit, insert library block) + declaration-template skill.
- **Out / later:**
  - Batch auto-exhibit artifact generation (explorer screenshots, raw RPC data captures) and storage of those artifacts (likely data room).
  - DOCX export, e-signature, redlining/version compare.
  - Additional jurisdiction variants (e.g., federal 28 U.S.C. § 1746) — additive once the variant abstraction exists.
  - Rebuttal scaffolds (structured response to an opposing expert's report, as in the Shaulova second affirmation).

## Risks & open questions

- **Weakest assumption:** experts will finish the document inside Daubert. Litigation workflows gravitate to Word at the end; if that holds, PDF-only export caps adoption and DOCX moves from "later" to "soon." Watch for this in first real use.
- Pleading-paper fidelity in HTML/print CSS (line numbers aligned to text lines) is finicky; budget real effort or the output looks amateur — worse than no feature in this market.
- Exhibit source artifacts: registry stores refs at MVP, but a filed declaration needs the actual exhibit pages — the gap between "link to Solscan" and "Exhibit B5 as filed" is deferred, deliberately.
- Schema churn as more jurisdictions/document kinds (affirmations, reports, rebuttals) arrive — the section/variant abstractions need to absorb them without migrations to existing documents.
