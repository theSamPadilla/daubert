# Case Onboarding — Empty-State Flow to First Trace + Declaration

**One-liner:** Replace the passive empty-case state with a deterministic intake that seeds a first trace in seconds, plus a derived "getting started" checklist that guides the user to an AI-drafted, declaration-shaped report — the full evidence-in → graph → deliverable-out loop in the first session.

## Problem & why now

A first-time case owner lands on "Select or create an investigation to begin" and must discover a ~9-step, right-click-driven path across three disconnected surfaces (sidebar `+` → name investigation → right-click canvas → new trace → right-click trace → Fetch → address/chain/range → select txs → import) before anything renders. Nothing ever points at a deliverable — reports start as a blank Tiptap editor behind a separate menu. The codebase has zero onboarding affordances (no tour, checklist, sample data, or template). For a product sold on "trace fund flows and produce litigation deliverables," the first session shows neither without expert navigation.

## Fit with strategy

- The aha moment is fund flows rendering on the graph; the differentiator is the AI agent turning traced data into deliverables (`product-knowledge.md`). This flow puts both in the first session, in that order.
- Respects the role model (`docs/ROLES.md`): the intake is an owner/editor surface. Viewers keep a passive empty state.
- **The bet:** the first-session bottleneck is navigation and guidance, not capability — everything needed (fetch/import pipeline, agent `create_production`) already exists; onboarding is sequencing, not new machinery.
- **Deliberate reframe from the original ask:** we do not minimize time-to-*declaration* — a 90-second auto-declaration is a hollow artifact for a product named after an evidentiary reliability standard. We minimize time-to-first-trace (deterministic), then guide to a declaration *draft* grounded in actual traced data.

## The idea (refined)

**1. Intake card (deterministic seed).** A case with zero investigations renders an intake card in place of the empty state: paste one or more addresses or a tx hash, chain auto-detected (user-confirmable), plus a light **engagement context** block — retained side (plaintiff / defense / neutral), scope of engagement, and key allegations (all optional free text, single screen, not a wizard). Context is stored on the case (summary + structured fields as needed) and is what later makes the declaration draft read as scoped to the matter instead of generic. One submit auto-creates the investigation + trace, fetches history via the existing fetch/import pipeline, and lands the user on a populated graph. No AI on this path.

**2. Getting-started rail (derived checklist).** A dismissible checklist in the workspace, state derived entirely from case data (no new tables): ① Seed your trace ✓ → ② Label key wallets → ③ Expand the flows → ④ Draft your declaration. Each step deep-links to the relevant surface. Disappears once complete or dismissed.

**3. Declaration draft (AI handoff).** Step ④ is a one-click handoff to the investigation's AI conversation with a prefilled prompt + a new declaration-template skill. Draft structure: **caption/header** (from the engagement context) → **qualifications placeholder** → **methodology** — generated from what was *actually done* in the case (fetches/imports, script runs, annotations; `script_runs` already records the agent's work) → **findings** → **opinions** → exhibit references. Factual claims anchor to their sources where the data allows it (graph edges already carry `txHash`). The skill instructs the agent to disclose gaps honestly (unattributable flows, mixer hops, incomplete history) rather than paper over them. The agent generates a report production via existing `create_production`. Explicitly presented as a draft for the expert to own — the "it wrote up exactly what I did, with sources" moment is the payoff.

## Product decisions

Locked during ideation (anchor for autonomous execution):

1. **Shape: hybrid (C).** Deterministic intake to first graph data; AI only for the declaration draft. Not a pure wizard, not an AI concierge.
2. **Declaration = AI-drafted draft of the structured `declaration` production type** (see `declarations.md` — supersedes the earlier "declaration-shaped report" framing). Generated from traced data via the agent, using the declaration-template skill to fill the typed schema (caption → qualifications → assignment → background → findings → conclusions → exhibits); methodology/findings derive from actual case activity, not boilerplate; gaps are disclosed, not smoothed. Never presented as final.
3. **Trigger: every case with zero investigations**, not just the user's first case. It's an intake surface, not a one-time tour — and needs no per-user seen-state.
4. **Role-gated:** intake + checklist render for owners/editors only. Viewers/guests keep the current passive empty state.
5. **No new agent creation powers needed.** The deterministic path creates the investigation/trace; the agent keeps its existing tool surface (+ one new skill document).
6. **No schema changes.** Checklist state is derived (investigations exist? any labeled node? node count grown past seed? report production exists?). Case summary reuses the existing `cases.summary` column.

## Scope

- **In (MVP):**
  - Intake card on empty case (addresses/tx hash, chain auto-detect with confirm, optional engagement context: side / scope / allegations) → auto-create investigation + trace + fetch + import.
  - Getting-started rail with the four derived steps, dismissible.
  - Declaration-template skill (structured sections, methodology-from-activity, gap disclosure) + one-click prefilled AI handoff that produces a report production.
  - Role gating (owner/editor vs viewer empty states).
- **Out / later:**
  - Sample/demo case for users who arrive with no address in hand (a full fictional matter with a traceable story arc exists in the demo-flow spec — "Northwind v. Stratton" — and is the natural seed content).
  - Agent-proposed analysis plan at intake (agent reads scope/allegations and proposes next steps) — deliberately kept off the deterministic seed path for MVP.
  - First-class citations/provenance and a unified activity log — bigger product bets from the demo-flow spec; the declaration skill's txHash anchors and `script_runs`-derived methodology are the lightweight forerunners.
  - Product tour, tooltips, or multi-case onboarding progress.
  - Declaration export polish (DOCX/PDF, signature blocks, jurisdiction variants).
  - AI-led intake (agent creating investigations/traces) — revisit only if the deterministic intake proves too rigid.

## Risks & open questions

- **Weakest assumption:** the user arrives with an address or tx hash in hand. If they don't, the intake dead-ends — mitigated later by a sample case (out of scope for MVP).
- **Chain auto-detect ambiguity:** an EVM address is valid on every EVM chain. Mitigation: probe activity across supported chains (Etherscan V2 covers them with one key) and let the user confirm; Tron is unambiguous by format.
- **Declaration draft quality** depends on how labeled/expanded the graph is — the checklist ordering (label → expand → draft) exists precisely to front-load context before the draft.
- **First-impression flakiness:** the seed path must be robust to fetch failures (bad address, rate limits, zero-activity wallets) — a failed intake is worse than today's passive state. Error states need real design attention.
- Deferred deliberately: what "expand the flows" concretely nudges (counterparty fetch? quick-add?) — plan-time detail.
