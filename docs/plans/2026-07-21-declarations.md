# Declarations Production Type — Implementation Plan

**Goal:** Add a structured `declaration` production type that renders court-ready expert declarations (CA declaration + NY affirmation variants), with an org-level reusable library and agent-driven composition.

## Summary

- **What & why:** Today a "declaration" is a blank HTML report; the format (analyzed from four real filings in `docs/ideas/declarations.md`) demands continuous paragraph numbering, exhibit cross-reference integrity, and jurisdiction-specific chrome that freeform HTML can't guarantee. This adds a typed schema, a section-aware editor, faithful PDF/DOCX export, an org library of declarant profiles/boilerplate, and agent ops so the AI can compose declarations reliably.
- **Key product decisions** (locked in ideation): structured type, not a template; org-level reuse library; exhibits = manual registry + agent-driven insertion with graph-sourced refs; MVP variants = `ca-declaration` + `ny-affirmation`.
- **Load-bearing architecture decisions:**
  - Declaration content lives in `production.data` JSONB (schema in contracts → generated types both sides); surgical edits via the existing atomic-ops system in `ProductionsService.applyOps()`.
  - The backend export template (`templates/declaration.ts`, Puppeteer) is the **source of truth** for filed output; the in-app editor is a working view, not print-faithful. CA pleading-paper line numbers use the print-repeating `position: fixed` gutter technique.
  - One org-scoped entity (`declaration_library_blocks`) covers both declarant profiles and boilerplate via a `kind` discriminator — one service/controller/UI instead of two.
  - DOCX export included at MVP (html-to-docx already in the export module — near-free, defuses the "experts finish in Word" risk). Footnotes render as endnotes before the signature block (per-page CSS footnotes aren't feasible in Puppeteer) — known deviation, revisit later.
- **Risk concentration (opus tasks):** Task 3 (ops engine), Task 5 (agent tools + drafting skill), Task 6 (court-format renderer).

## Engineering decisions made

- Library roles: org `member`+ can read **and** write library blocks (admins implicitly). Firm assets curated by the team; tighten later if needed.
- Exhibit labels are explicit strings (real filings use grouped labels like "B1"); `declaration_add_exhibit` auto-suggests the next unused letter when omitted.
- Paragraph/section/exhibit ids are server-generated UUIDs; numbering (¶ numbers, section letters) is always **computed at render**, never stored.
- Frontend autosave mirrors ReportEditor: debounced full-`data` PATCH. Ops are for the agent; the editor sends whole-document state.
- New read-only agent tool `get_declaration_library` (case → org lookup) rather than overloading `get_case_data`.
- Naming caution: the codebase already has an unrelated "exhibit" feature (`ExhibitBuilder.tsx` / `exhibit-composer.ts` — combining productions into one export PDF). The new `DeclarationExhibit` (court exhibit registry inside a declaration) is a different concept; keep the `Declaration` prefix on all new symbols/components to avoid collision.

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task. Do NOT commit — leave all changes in the working tree and run `git status` at the end of each task.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `contracts/schemas/productions.yaml` | Modify | `declaration` type + full DeclarationData schema → typed on both sides |
| 2 | `contracts/schemas/declaration-library.yaml` | Create | Library block schemas (profile/boilerplate) |
| 3 | `contracts/paths/declaration-library.yaml` | Create | Org-scoped library CRUD endpoints |
| 4 | `contracts/openapi.yaml` | Modify | Register new schemas/paths |
| 5 | `backend/src/database/entities/declaration-library-block.entity.ts` | Create | Org-scoped reusable profiles + boilerplate |
| 6 | `backend/src/database/entities/index.ts` | Modify | Register new entity |
| 7 | `backend/src/database/entities/production.entity.ts` | Modify | `DECLARATION` enum value |
| 8 | `backend/src/modules/productions/declaration-data.ts` | Create | Seed skeleton + shared helpers (numbering, label suggestion) |
| 9 | `backend/src/modules/productions/productions.service.ts` | Modify | Seed on create + 8 `declaration_*` atomic ops |
| 10 | `backend/src/modules/productions/productions.service.spec.ts` | Modify | TDD coverage of declaration ops (extend the existing 644-line suite — do NOT overwrite) |
| 11 | `backend/src/modules/declaration-library/*` (module, service, controller, DTOs) | Create | Users can manage the org's declarant profiles & boilerplate |
| 12 | `backend/src/modules/declaration-library/declaration-library.service.spec.ts` | Create | Library service tests |
| 13 | `backend/src/app.module.ts` | Modify | Register library module |
| 14 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Agent can create declarations, apply declaration ops, read the library |
| 15 | `backend/src/modules/ai/ai.service.ts` | Modify | Dispatch `get_declaration_library` |
| 16 | `backend/src/skills/declarations.md` | Create | Agent drafting guide: format, ops, exhibit conventions, gap disclosure |
| 17 | `backend/src/modules/export/templates/declaration.ts` | Create | Court-faithful HTML: pleading paper (CA) / affirmation (NY), auto-numbering, exhibits, endnotes |
| 18 | `backend/src/modules/export/export.service.ts` | Modify | Add Puppeteer header/footer + Letter page-size options to `htmlToPdf` (doesn't exist yet) |
| 19 | `backend/src/modules/export/export.controller.ts` | Modify | PDF + DOCX export for declarations |
| 20 | `frontend/src/utils/declarationNumbering.ts` (+ `.test.ts`) | Create | Shared render-numbering logic for the editor |
| 21 | `frontend/src/lib/api-client.ts` | Modify | Library CRUD methods |
| 22 | `frontend/src/components/Productions/DeclarationEditor.tsx` | Create | Section-aware editor (caption, paragraphs, execution) |
| 23 | `frontend/src/components/Productions/DeclarationExhibitsPanel.tsx` | Create | Exhibit registry UI |
| 24 | `frontend/src/components/Productions/DeclarationLibraryPicker.tsx` | Create | Insert profile/boilerplate into a declaration |
| 25 | `frontend/src/components/Productions/ProductionViewer.tsx` | Modify | Route `declaration` type to the new editor |
| 26 | `frontend/src/components/Workspace/NewPrimaryModal.tsx` | Modify | Create declarations (with variant picker) |
| 27 | `frontend/src/components/Common/ExportModal.tsx` | Modify | PDF/DOCX formats for declarations |
| 28 | `frontend/src/app/orgs/[orgSlug]/settings/…` (library management UI) | Create/Modify | Org settings section to manage the library |
| 29 | `backend/src/database/migrations/<ts>-AddDeclarationLibraryBlocks.ts` | Create (generated) | Prod schema for the library table (generated, **not applied**) |

---

## The DeclarationData schema (canonical reference for all tasks)

```typescript
type DeclarationVariant = 'ca-declaration' | 'ny-affirmation';

interface DeclarationCaption {
  attorneyBlock: string;   // multiline; CA gutter block. Empty for NY.
  court: string;           // "SUPERIOR COURT OF THE STATE OF CALIFORNIA"
  county: string;          // "COUNTY OF SAN FRANCISCO"
  plaintiff: string;
  defendant: string;
  caseNumber: string;      // "Case No. CGC-24-620900" / "Index No.: 365181/2024"
  documentTitle: string;   // "DECLARATION OF … IN SUPPORT OF …"
  hearingInfo: string;     // multiline; hearing/dept/action-filed/trial-date. Optional content.
}

interface DeclarationSubItem  { id: string; text: string }          // lettered a. b. c.
interface DeclarationFootnote { id: string; text: string }

interface DeclarationParagraph {
  id: string;
  text: string;            // plain text; inline <b>/<i>/<u> allowed, nothing else
  subItems: DeclarationSubItem[];
  exhibitIds: string[];    // renders as "See Exhibit(s) <label(s)>" after the text
  footnotes: DeclarationFootnote[];
}

type DeclarationSectionKind =
  | 'qualifications' | 'assignment' | 'summary_of_opinions' | 'background'
  | 'authentication' | 'findings' | 'conclusions' | 'recommendations' | 'custom';

interface DeclarationSection {
  id: string;
  kind: DeclarationSectionKind;
  heading: string;         // "EXPERT BACKGROUND" — letter ("A.") computed at render
  paragraphs: DeclarationParagraph[];
}

interface DeclarationExhibit {
  id: string;
  label: string;           // "A", "B1" — explicit, unique per declaration
  description: string;
  source: null | {
    kind: 'transaction' | 'url' | 'file' | 'other';
    txHash?: string; chain?: string; url?: string; note?: string;
  };
}

interface DeclarationData {
  schemaVersion: 1;
  variant: DeclarationVariant;
  caption: DeclarationCaption;
  declarantName: string;
  sections: DeclarationSection[];
  exhibits: DeclarationExhibit[];
  execution: { place: string; date: string; signatureName: string };
}
```

Rendering rules (both the export template and the frontend numbering util implement these):
- Paragraph numbers are continuous across all sections, starting at 1.
- Section letters: `A.`, `B.`, … in array order, prefixed to `heading` (uppercased).
- Oath: CA = opening line `I, <declarantName>, declare:` + closing perjury block (`I declare under penalty of perjury under the laws of the State of California that the foregoing is true and correct. Executed <date>, at <place>.`). NY = opening `I, <declarantName>, declare under penalty of perjury and pursuant to C.P.L.R. § 2106, that the following is true and correct:` + closing `Dated: <place>, <date>`.
- Exhibit refs render as `See Exhibit B1.` (bold+underline labels); multi: `See Exhibits B1, B2.`
- Footnotes are superscripted in text, rendered as endnotes before the execution block.

---

## Task 1: Contracts — declaration type, data schema, library schemas/paths

**Implementer:** sonnet
**Files:** Modify `contracts/schemas/productions.yaml`, `contracts/openapi.yaml`; Create `contracts/schemas/declaration-library.yaml`, `contracts/paths/declaration-library.yaml`.

**Step 1:** In `contracts/schemas/productions.yaml`: add `declaration` to the `ProductionType` enum. Add schemas mirroring the canonical TypeScript above: `DeclarationVariant`, `DeclarationCaption`, `DeclarationParagraph`, `DeclarationSubItem`, `DeclarationFootnote`, `DeclarationSection` (with `kind` enum), `DeclarationExhibit`, `DeclarationExhibitSource`, `DeclarationData`. Follow the YAML style of existing schemas (required arrays, `type: object`, enums). `Production.data` stays `additionalProperties: true` — `DeclarationData` is referenced by the new library/ops docs and used for generated types, not enforced on the generic endpoint.

**Step 2:** Create `contracts/schemas/declaration-library.yaml`:
- `DeclarationLibraryBlockKind`: enum `[declarant_profile, boilerplate]`.
- `DeclarationLibraryBlock`: `id`, `organizationId`, `kind`, `name`, `category` (nullable string; e.g. `primer`, `authentication`), `content` (object: `{ paragraphs: DeclarationParagraph[] }` via `$ref` to productions.yaml), `createdAt`, `updatedAt`.
- `CreateDeclarationLibraryBlockRequest` (`kind`, `name`, `category?`, `content`), `UpdateDeclarationLibraryBlockRequest` (all optional).

**Step 3:** Create `contracts/paths/declaration-library.yaml` mirroring the org-scoped style used by existing org paths:
- `GET /orgs/{org}/declaration-library` → list; `POST` → create.
- `PATCH /orgs/{org}/declaration-library/{blockId}` → update; `DELETE` → delete.

**Step 4:** Register both files in `contracts/openapi.yaml` the same way existing schema/path files are referenced.

**Step 5:** Run `npm run gen` from repo root. Confirm `backend/src/generated/api-types.ts` and `frontend/src/generated/api-types.ts` now contain `DeclarationData` and `DeclarationLibraryBlock`. Run `git status`.

## Task 2: Backend — production enum, entity, seed + helpers

**Implementer:** sonnet
**Files:** Modify `backend/src/database/entities/production.entity.ts`, `backend/src/database/entities/index.ts`; Create `backend/src/database/entities/declaration-library-block.entity.ts`, `backend/src/modules/productions/declaration-data.ts`.

**Step 1:** Add `DECLARATION = 'declaration'` to the `ProductionType` enum.

**Step 2:** Create the entity (mirror existing org-scoped entity style, extends `BaseEntity`):

```typescript
export enum DeclarationLibraryBlockKind {
  DECLARANT_PROFILE = 'declarant_profile',
  BOILERPLATE = 'boilerplate',
}

@Entity('declaration_library_blocks')
export class DeclarationLibraryBlockEntity extends BaseEntity {
  @Column({ type: 'varchar' })
  kind: DeclarationLibraryBlockKind;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  category: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  content: Record<string, unknown>;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;
}
```

Match the repo's actual column-naming convention (check a sibling entity for whether snake_case `name:` overrides are used) and register it in `entities/index.ts`.

**Step 3:** Create `backend/src/modules/productions/declaration-data.ts` with: the `DeclarationData` TS types (import from generated api-types where clean, else local mirror), plus:

```typescript
export function seedDeclarationData(input: Partial<DeclarationData> | undefined): DeclarationData {
  const variant: DeclarationVariant =
    input?.variant === 'ny-affirmation' ? 'ny-affirmation' : 'ca-declaration';
  const section = (kind: DeclarationSectionKind, heading: string): DeclarationSection =>
    ({ id: randomUUID(), kind, heading, paragraphs: [] });
  return {
    schemaVersion: 1,
    variant,
    caption: {
      attorneyBlock: '', court: '', county: '', plaintiff: '', defendant: '',
      caseNumber: '', documentTitle: '', hearingInfo: '',
      ...(input?.caption ?? {}),
    },
    declarantName: input?.declarantName ?? '',
    sections: input?.sections?.length ? input.sections : [
      section('qualifications', 'EXPERT BACKGROUND'),
      section('assignment', 'SCOPE OF REVIEW'),
      section('summary_of_opinions', 'SUMMARY OF OPINIONS'),
      section('background', 'TECHNICAL BACKGROUND'),
      section('findings', 'FINDINGS'),
      section('conclusions', 'CONCLUSIONS'),
    ],
    exhibits: input?.exhibits ?? [],
    execution: { place: '', date: '', signatureName: '', ...(input?.execution ?? {}) },
  };
}

export function nextExhibitLabel(exhibits: DeclarationExhibit[]): string {
  const used = new Set(exhibits.map((e) => e.label));
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) return l;
  }
  let n = 1;
  while (used.has(`Z${n}`)) n++;
  return `Z${n}`;
}
```

**Step 4:** `npm run build --prefix backend` compiles. Run `git status`.

## Task 3: Backend — declaration atomic ops (TDD)

**Implementer:** opus
**Files:** Modify `backend/src/modules/productions/productions.service.ts` AND `backend/src/modules/productions/productions.service.spec.ts` (the spec **already exists** with ~644 lines covering chronology/chart ops — extend it with a new `describe('declaration ops')` block; do NOT overwrite or restructure the existing tests).

**Step 1 — failing tests first.** Add declaration test cases to the existing spec, reusing its established repo-mocking setup (for mocking style reference see `backend/src/modules/organizations/organizations.service.spec.ts`). Cover, at minimum:
- create with `type: declaration` and `data: { variant: 'ny-affirmation' }` → seeded skeleton (6 sections, schemaVersion 1, variant preserved).
- `declaration_add_paragraph` appends to the named section, assigns UUID, defaults `subItems/exhibitIds/footnotes` to `[]`; `afterParagraphId` inserts mid-list; unknown `sectionId` throws BadRequest.
- `declaration_update_paragraph` merges only provided fields; unknown `paragraphId` throws.
- `declaration_remove_paragraph` removes; unknown id throws.
- `declaration_add_section` with/without `afterSectionId`; invalid `kind` throws.
- `declaration_add_exhibit` without `label` auto-assigns via `nextExhibitLabel`; duplicate explicit label throws.
- `declaration_update_exhibit` merges; relabeling to an existing label throws.
- `declaration_set_caption` / `declaration_set_execution` shallow-merge partials.
- Any `declaration_*` op against a non-declaration production throws (mirror the existing type-mismatch guard).

**Step 2:** `npm test --prefix backend -- productions.service` — confirm all new tests fail (service doesn't handle the ops yet).

**Step 3 — implement.** In `productions.service.ts`:
- On create, when `dto.type === ProductionType.DECLARATION`, run `data = seedDeclarationData(dto.data as any)` (mirror the existing `seedChronologyData` call site).
- Extend the `Op` discriminated union with the 8 ops:

```typescript
| { type: 'declaration_set_caption'; caption: Partial<DeclarationCaption> }
| { type: 'declaration_set_execution'; execution: Partial<DeclarationData['execution']> }
| { type: 'declaration_add_section'; kind: DeclarationSectionKind; heading: string; afterSectionId?: string }
| { type: 'declaration_add_paragraph'; sectionId: string; text: string;
    subItems?: { text: string }[]; exhibitIds?: string[]; footnotes?: { text: string }[]; afterParagraphId?: string }
| { type: 'declaration_update_paragraph'; paragraphId: string; text?: string;
    subItems?: { id?: string; text: string }[]; exhibitIds?: string[]; footnotes?: { id?: string; text: string }[] }
| { type: 'declaration_remove_paragraph'; paragraphId: string }
| { type: 'declaration_add_exhibit'; label?: string; description: string; source?: DeclarationExhibit['source'] }
| { type: 'declaration_update_exhibit'; exhibitId: string; label?: string; description?: string; source?: DeclarationExhibit['source'] }
```

- Implement handlers inside `applyOps()` following the structure and error style of the `chronology_*` handlers (BadRequestException with a precise message; validate ids exist; server-generate UUIDs for new paragraphs/sub-items/footnotes/sections/exhibits; validate `exhibitIds` against the registry; enforce unique exhibit labels).
- Guard: `declaration_*` ops only on `ProductionType.DECLARATION` (extend the existing mismatch check).

**Step 4:** `npm test --prefix backend -- productions.service` → all pass. `npm run build --prefix backend` → clean. Run `git status`.

## Task 4: Backend — declaration-library module

**Implementer:** sonnet
**Files:** Create `backend/src/modules/declaration-library/declaration-library.module.ts`, `declaration-library.service.ts`, `declaration-library.controller.ts`, `dto/create-declaration-library-block.dto.ts`, `dto/update-declaration-library-block.dto.ts`, `declaration-library.service.spec.ts`; Modify `backend/src/app.module.ts`.

**Step 1 — failing tests:** service spec with mocked repo: `listForOrg` returns org-scoped blocks ordered by kind then name; `create` validates kind; `update` merges and 404s on cross-org id; `remove` 404s on cross-org id.

**Step 2:** `npm test --prefix backend -- declaration-library` → fails.

**Step 3 — implement.** Mirror the organizations module exactly:
- Controller `@Controller('orgs/:org/declaration-library')`; resolve the org the same way `organizations.controller.ts` does (the `:org` slug param + guard attach). Routes: `GET` list + `POST` create at `@RequireOrgRole('member')`; `PATCH :blockId` + `DELETE :blockId` at `@RequireOrgRole('member')`. All service methods take `organizationId` and scope every query by it (cross-org isolation is a hard requirement).
- DTOs: class-validator, `kind` as enum, `name` non-empty string, `category` optional string, `content` object.
- Register module in `app.module.ts`.

**Step 4:** `npm test --prefix backend -- declaration-library` → pass; build clean. Run `git status`.

## Task 5: Backend — agent tools + declarations skill

**Implementer:** opus
**Files:** Modify `backend/src/modules/ai/tools/tool-definitions.ts`, `backend/src/modules/ai/tools/index.ts` (if tools are aggregated there), `backend/src/modules/ai/ai.service.ts`; Create `backend/src/skills/declarations.md`.

**Step 1:** `CREATE_PRODUCTION_TOOL`: add `'declaration'` to the type enum. In the description, document: create with `data: { variant: 'ca-declaration' | 'ny-affirmation', caption?, declarantName? }` — the server seeds the section skeleton; then build content with `update_production` declaration ops. Point to the `declarations` skill for format guidance.

**Step 2:** `UPDATE_PRODUCTION_TOOL`: add the 8 `declaration_*` ops to the ops documentation/schema exactly as implemented in Task 3 (names, required fields, semantics — e.g. "`declaration_add_exhibit` omits `label` to auto-assign the next letter"). Keep the existing chronology/chart op docs untouched.

**Step 3:** New `GET_DECLARATION_LIBRARY_TOOL` (read-only): no input beyond optional `kind` filter; description: "List the organization's reusable declaration blocks (declarant profiles, technical primers, authentication boilerplate) with their paragraph content. Use before drafting qualifications/background sections." Dispatch in `ai.service.ts`: resolve the case's org id — the CaseEntity field is named `orgId` (not `organizationId`) → `DeclarationLibraryService.listForOrg(orgId, kind?)` → return `{ blocks: [{ id, kind, name, category, content }] }`. Register the tool in the read-only set (it must NOT be treated as a mutation).

**Step 4:** Create `backend/src/skills/declarations.md` with frontmatter (`name: declarations`, one-line `description`) — auto-registered by `skill-registry.ts`. Content (this is load-bearing for draft quality; write it fully):
- The document anatomy and rendering rules (paragraph numbering is automatic — never write "¶ 12" in text; section letters automatic).
- Variant differences (CA vs NY oath/caption, from the schema reference in this plan).
- Section-by-section drafting guidance distilled from `docs/ideas/declarations.md`: qualifications from a declarant profile; assignment with lettered opine-on questions + materials reviewed + right-to-supplement; background = chain primer for a lay judge (pull from library `boilerplate`/`primer` blocks when available); authentication paragraphs for exhibits ("true and correct copies obtained from <explorer>… verified via <method>"); findings sections use argumentative headings that state the finding, define wallet shorthands on first use ("the dK4GrZ Wallet"), cite exhibits via `exhibitIds` (never hand-written "See Exhibit" text); conclusions as "it is my opinion that:" with lettered sub-items.
- Exhibit conventions: when the user says "add transaction XYZ with an explanation", fetch the tx details from the graph (`get_investigation`), write the finding paragraph, and `declaration_add_exhibit` with `source: { kind: 'transaction', txHash, chain, url: <explorerUrl> }`.
- Honesty rules: disclose gaps (mixers, unattributable flows, incomplete history) explicitly; never overstate; the draft is for the expert to own and edit.

**Step 5:** Build clean; start backend (`npm run be`) briefly to confirm the skill registry logs/loads `declarations` without error. Run `git status`.

## Task 6: Backend — export template + wiring

**Implementer:** opus
**Files:** Create `backend/src/modules/export/templates/declaration.ts`; Modify `backend/src/modules/export/export.service.ts`, `backend/src/modules/export/export.controller.ts` (and the format-routing map — the per-type `ALLOWED` formats map lives in the controller).

**Step 0 — extend `htmlToPdf` (this capability does NOT exist yet):** `ExportService.htmlToPdf()` currently accepts only `{ landscape?, timeout? }` and hardcodes `format: 'A4'` with no header/footer support. Extend its options with `{ pageFormat?: 'A4' | 'Letter', displayHeaderFooter?: boolean, headerTemplate?: string, footerTemplate?: string }`, passed through to `page.pdf()`. Defaults preserve current behavior (A4, no header/footer) so existing report/chronology/chart exports are untouched.

**Step 1:** Implement `renderDeclarationHtml(production, opts)` following the structure of `templates/report.ts` + `templates/styles.ts`:
- Compute numbering per the rendering rules (continuous ¶ numbers, section letters, exhibit label lookup, footnote → endnote numbering).
- **NY variant:** simple caption box (court/county header; plaintiff "- against -" defendant box; Index No. + document title to the right), oath up front, double-spaced numbered paragraphs, endnotes, `Dated:` block + signature line.
- **CA variant:** pleading paper — a `position: fixed` left gutter (repeats on every printed page in Puppeteer) containing line numbers 1–28 and double vertical rules; body text at a line-height matched to the gutter spacing (define one CSS variable, e.g. `--pleading-line: 24px`, used by both); attorney block above the caption; caption box left / case-number+title right; per-page footer with the document title via the new `footerTemplate` option from Step 0 (Puppeteer footer templates need inline styles and explicit font-size; use `pageFormat: 'Letter'`).
- Exhibit references appended to paragraph text as `See Exhibit <b><u>B1</u></b>.`; sub-items as an `a./b./c.` list indented under the paragraph; "EXHIBITS" index page after endnotes listing label + description + source URL when present.
- Escape all user content (reuse the sanitization in `templates/util.ts`); allow only `<b><i><u>` through from paragraph text.

**Step 2:** Wire the export controller: for `type === declaration`, allow `pdf` (Puppeteer, portrait, letter) and `docx` (same HTML minus the fixed gutter — pass a `{ docx: true }` flag to the renderer that omits the pleading gutter/fixed elements, since html-to-docx can't honor them). Reject other formats with the same error style used for unsupported type/format combos.

**Step 3 — visual verification (no automated test):** with dev servers up (`npm run db`, `npm run be`), create a declaration via curl seeded with 2 sections / 3 paragraphs / 2 exhibits / a footnote, export both variants to PDF into the scratchpad, and open them. Check: line numbers render on every page (CA), paragraph numbering continuous, oath language correct per variant, footer title present, endnotes + exhibit index render. Iterate until faithful to the examples in `/Users/Sam/Downloads/declarationexamples/`.

**Step 4:** Build clean. Run `git status`.

## Task 7: Frontend — numbering util (TDD) + api-client

**Implementer:** sonnet
**Files:** Create `frontend/src/utils/declarationNumbering.ts`, `frontend/src/utils/declarationNumbering.test.ts`; Modify `frontend/src/lib/api-client.ts`.

**Step 1 — failing test:** `computeDeclarationNumbering(data)` returns `{ sectionLetters: Map<sectionId, 'A.'|'B.'…>, paragraphNumbers: Map<paragraphId, number>, footnoteNumbers: Map<footnoteId, number> }` with continuous paragraph numbering across sections and document-order footnote numbering. Test with 3 sections / uneven paragraphs / footnotes in the 1st and 3rd.

**Step 2:** `npm test --prefix frontend -- declarationNumbering` → fails, then implement (pure function), then passes.

**Step 3:** api-client: add `listDeclarationLibrary(orgSlug, kind?)`, `createDeclarationLibraryBlock(orgSlug, dto)`, `updateDeclarationLibraryBlock(orgSlug, blockId, dto)`, `deleteDeclarationLibraryBlock(orgSlug, blockId)` following the existing org-methods pattern and generated types. Run `git status`.

## Task 8: Frontend — DeclarationEditor + viewer/create wiring

**Implementer:** opus
**Files:** Create `frontend/src/components/Productions/DeclarationEditor.tsx`; Modify `frontend/src/components/Productions/ProductionViewer.tsx`, `frontend/src/components/Workspace/NewPrimaryModal.tsx`.

**Step 1:** `DeclarationEditor` (props: `production`, `readOnly`, `onChange(data)` — parent debounces PATCH exactly like ReportEditor's flow):
- **Layout:** single scrollable document-shaped column, styled as a working view of the filing (not pleading-faithful): caption block at top (collapsible form: all `DeclarationCaption` fields + variant select + declarantName), then sections, then endnote list (read-only, computed), then execution form (place/date/signatureName).
- **Sections:** heading text input prefixed by the computed letter; kind badge; add-section (kind picker + heading) and delete-section controls; paragraphs listed with computed ¶ numbers from `computeDeclarationNumbering`.
- **Paragraphs:** auto-growing textarea for `text`; sub-items as an indented `a./b./c.` list of inputs with add/remove; exhibit refs as removable chips (picker fed by `data.exhibits`) rendering `See Exhibit <label>`; footnotes add/edit inline (superscript marker + small text input); add-paragraph and delete-paragraph controls per section.
- All mutations build the next `DeclarationData` immutably and call `onChange`; ids for new items via `crypto.randomUUID()`. Respect `readOnly` (viewers see everything, edit nothing).
- Follow the repo's existing Tailwind idiom and `components/ui` primitives; icons from `react-icons/fa6` only.

**Step 2:** `ProductionViewer`: add the `declaration` case → `DeclarationEditor`, reusing the same debounced-save plumbing as report (full-`data` PATCH). Add the `declaration` icon/color to **all four** type maps: `ProductionViewer.tsx:20` (`TYPE_COLORS`), `frontend/src/app/cases/[caseId]/(workspace)/productions/page.tsx:12-22` (`TYPE_ICONS` + `TYPE_COLORS`), `frontend/src/components/Workspace/InvestigationsSidebar.tsx:16-20` (`PRODUCTION_TYPE_ICONS`), and `frontend/src/components/Productions/ExhibitBuilder.tsx:18-23` (`TYPE_ICONS`). Icon from `react-icons/fa6` (e.g. `FaFileSignature`).

**Step 3:** `NewPrimaryModal` production tab: add "Declaration" to the type options; when selected show a variant select (California declaration / New York affirmation); on create pass `data: { variant }` (server seeds the rest).

**Step 4:** `npm run build --prefix frontend` → clean. Manual check with dev servers: create a declaration, edit caption/paragraphs/subitems, reload — content persists; numbering matches the export. Run `git status`.

## Task 9: Frontend — exhibits panel + library picker

**Implementer:** sonnet
**Files:** Create `frontend/src/components/Productions/DeclarationExhibitsPanel.tsx`, `frontend/src/components/Productions/DeclarationLibraryPicker.tsx`; Modify `frontend/src/components/Productions/DeclarationEditor.tsx` (mount both).

**Step 1:** `DeclarationExhibitsPanel` (collapsible side/bottom panel inside the editor): table of exhibits (label input, description input, source summary with external link when `url` present; delete with confirm — deleting an exhibit also strips its id from every paragraph's `exhibitIds`). "Add exhibit" defaults label to the next unused letter (mirror `nextExhibitLabel` logic client-side); source editable as kind + fields (transaction: txHash/chain/url; url: url; file: note; other: note).

**Step 2:** `DeclarationLibraryPicker`: modal listing the org's blocks grouped by kind (fetch via api-client using the case's org slug — take the slug the same way other case-page components resolve the org, via the case context); selecting a block + target section appends the block's paragraphs (fresh UUIDs) to that section. Entry point: an "Insert from library" button in the editor toolbar.

**Step 3:** Build clean; manual check: add/edit exhibits, reference them from paragraphs, insert a library block. Run `git status`.

## Task 10: Frontend — org library management + export modal

**Implementer:** sonnet
**Files:** Create library management UI under the existing org settings pages (`frontend/src/app/orgs/[orgSlug]/settings/` — add a section component alongside the existing ones, e.g. next to `OrgCasesAdminSection.tsx`, consistent with how that page is organized); Modify `frontend/src/components/Common/ExportModal.tsx`.

**Step 1:** Library management: list blocks grouped by kind with name/category; create/edit in a modal — kind select, name, category (free text with suggestions `primer`, `authentication`), and a minimal paragraphs editor (ordered textareas with add/remove/reorder; sub-items optional here — paragraphs-only is acceptable for library content at MVP, note it in the UI copy). Delete with confirm. Members and admins can access (match backend guard).

**Step 2:** `ExportModal`: for `type === declaration` offer PDF and DOCX (reuse the existing format-per-type mapping).

**Step 3:** Build clean; manual check: create a profile block in the org page, insert it from the picker in a case, export the declaration to PDF from the UI. Run `git status`.

## Task 11: Migration + final verification

**Implementer:** sonnet

**Step 1:** Generate the prod migration for the new table via the script — **never** raw typeorm, **never** apply:
`./migrations.sh --prod --generate AddDeclarationLibraryBlocks`
If prod is unreachable from this machine, skip and note it in the final report — the user generates it. **Do not run migrations.**

**Step 2:** Full verification: `npm run gen` (no diff churn), `npm test --prefix backend`, `npm test --prefix frontend`, `npm run build --prefix backend`, `npm run build --prefix frontend` — all green.

**Step 3:** `git status` — full change list for the user's review. No commits.
