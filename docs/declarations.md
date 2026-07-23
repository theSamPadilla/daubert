# Declarations

`declaration` is a structured production type: a court-ready expert declaration drafted in the case workspace against a typed schema (not freeform HTML like reports), then exported to PDF or DOCX with jurisdiction-correct formatting. Org-level building blocks (declarant profiles, boilerplate library) feed the per-case draft.

Related: [architecture.md](./architecture.md), [organizations.md](./organizations.md), [ai-system.md](./ai-system.md), [data-model.md](./data-model.md).

## Production Type

`ProductionType` (`backend/src/database/entities/production.entity.ts`): `report`, `chart`, `chronology`, `declaration`. All four share one `jsonb` `data` column, but `declaration` (like `chronology`) is server-seeded and versioned: `ProductionsService.create()` routes it through `seedDeclarationData()`, while report/chart data is stored verbatim.

`PATCH /productions/:id` accepts either `data` (full replace) or `ops` (atomic mutations), mutually exclusive. Declaration ops (each 400s if applied to a non-declaration production):

| Op | Effect |
|----|--------|
| `declaration_set_caption` | Merge partial caption fields |
| `declaration_set_execution` | Merge partial execution block |
| `declaration_add_section` | New section (`kind`, `heading`, optional `afterSectionId`) |
| `declaration_add_paragraph` | Append paragraph to a section |
| `declaration_update_paragraph` | Edit paragraph text/subItems/footnotes/exhibitIds |
| `declaration_remove_paragraph` | Delete paragraph |
| `declaration_add_exhibit` | New exhibit (auto label A..Z then Z1.. via `nextExhibitLabel`) |
| `declaration_update_exhibit` | Edit exhibit label/description/source |

## Data Shape

`DeclarationData` is defined in `backend/src/modules/productions/declaration-data.ts`, mirrored in `contracts/schemas/productions.yaml` and the generated `api-types.ts` on both sides:

```ts
interface DeclarationData {
  schemaVersion: 1;
  formatId?: DeclarationFormatId;   // 'ca-declaration' | 'ny-affirmation' | 'federal-1746' | 'tx-declaration' | 'fl-declaration'
  variant?: DeclarationVariant;     // deprecated back-compat field, read but never written
  caption: DeclarationCaption;      // attorneyBlock, court, county, plaintiff, defendant, caseNumber, documentTitle, hearingInfo
  declarantName: string;
  declarantDateOfBirth?: string;    // required only by tx-declaration
  declarantAddress?: string;        // required only by tx-declaration
  sections: DeclarationSection[];   // { id, kind, heading, paragraphs[] }
  exhibits: DeclarationExhibit[];   // { id, label, description, source: { kind: 'transaction'|'url'|'file'|'other', ... } | null }
  execution: { place; date; signatureName };
}
```

Paragraphs carry `{ id, text, subItems[], exhibitIds[], footnotes[] }`. Section kinds: `qualifications`, `assignment`, `summary_of_opinions`, `background`, `authentication`, `findings`, `conclusions`, `recommendations`, `custom`.

`seedDeclarationData()` validates the requested `formatId` against the registry (falls back to `ca-declaration`) and seeds six sections: qualifications (EXPERT BACKGROUND), assignment (SCOPE OF REVIEW), summary_of_opinions (SUMMARY OF OPINIONS), background (TECHNICAL BACKGROUND), findings (FINDINGS), conclusions (CONCLUSIONS).

## Format Registry

`backend/src/modules/export/formats/` holds a registry plus five per-jurisdiction modules. Each implements `DeclarationFormat` (`format.ts`): `id`, `label`, `jurisdiction`, `description`, `pleadingGutter` (CA-style numbered line gutter), `pageFormat` (`Letter`/`A4`), `requiredDeclarantFields`, and render hooks `renderCaption` / `renderOathOpening` / `renderClosing` / `styles` / optional `footerTemplate`.

| Format id | Jurisdiction | Notes |
|-----------|--------------|-------|
| `ca-declaration` | CA Superior Court (CCP 2015.5) | Gutter, 28-line pleading paper, per-page footer; the default |
| `ny-affirmation` | NY C.P.L.R. 2106 | No gutter, double-spaced, bordered caption box |
| `federal-1746` | 28 U.S.C. 1746 | Generic base; best-effort, unverified against a filed declaration |
| `tx-declaration` | Tex. Civ. Prac. & Rem. Code 132.001 | `requiredDeclarantFields: ['dateOfBirth', 'address']`; jurat recites both per statute |
| `fl-declaration` | Fla. Stat. 92.525 | Generic base; best-effort, unverified |

`generic.ts` supplies the shared non-gutter caption/signature/CSS helpers used by federal/TX/FL.

- `GET /declaration-formats` returns `listFormatSummaries()` for pickers (`declaration-formats.controller.ts`).
- `GET /productions/:id/declaration-preview` returns the rendered HTML (case-access checked).
- `resolveFormatId(data)` = `data.formatId ?? data.variant ?? DEFAULT_FORMAT_ID`; `getFormat(id)` falls back to CA for unknown ids. Neither ever throws, so legacy rows always render.

## Declarants

Org-scoped expert profiles (`backend/src/modules/declarants/`). Entity fields: `displayName`, `title`, `firm`, `qualifications` (jsonb paragraph array, same `DeclarationParagraph` shape), `cvExhibit`, `priorTestimony` (string[]), `hourlyRate`, `nonContingencyDisclosure`, `dateOfBirth`, `address`, `organizationId` (cascade), `userId` (nullable, SET NULL; optional link to a member).

**Authorization** (`DeclarantsService.loadOwned`): mutate iff org `admin` OR `declarant.userId === requester.userId`. Cross-org ids 404 before the ownership check (no existence leakage). Only admins can link a declarant to another user's `userId`.

**Extraction flow** (CV or prior declaration):

1. `POST /orgs/:org/declarants/extract` uploads a PDF (multipart, 10MB cap, PDF only)
2. `DeclarantExtractionService` sends it as a base64 document block through `AnthropicProvider.extractJson()` with forced `tool_choice` on the all-optional `draft_declarant` schema (model `claude-sonnet-4-6`; metered as surface `declarant-extraction`; see [ai-system.md](./ai-system.md))
3. Nothing is persisted: the draft prefills the create form, and `DeclarantModal` shows a review step ("review before saving") before any save
4. Attach-after-create: once the declarant is saved, the modal uploads the source PDF via `uploadDeclarantFile()`; a failed upload warns but does not roll back the declarant

Declarant files are stored through the `StorageProvider` interface (shared with the data room) at object key `org/<organizationId>/<fileId>`. `GET /orgs/:org/files` (`org-files.controller.ts`) lists every declarant file across the org, projected with `declarantName`/`declarantUserId`.

## Declaration Library

Org-scoped reusable blocks (`declaration_library_blocks`): `kind` (`declarant_profile` | `boilerplate`), `name`, `category`, `content` (always `{ paragraphs: DeclarationParagraph[] }`), `organizationId`. Routes under `/orgs/:org/declaration-library` (org role `member`+): list, create, patch, delete.

Insertion is client-side (`DeclarationLibraryPicker.tsx`): each inserted paragraph is cloned with fresh `crypto.randomUUID()` ids (paragraph, subItems, footnotes) and `exhibitIds` reset to `[]`, since exhibit references are declaration-scoped and cannot resolve in the target draft. Clones append to the chosen section.

## Case-Side Flow (Frontend)

**`DeclarantPicker.applyDeclarant`** (`frontend/src/components/Productions/DeclarantPicker.tsx`):
- Fills `declarantName` / `declarantDateOfBirth` / `declarantAddress` only if the draft's field is currently empty; never overwrites
- Appends cloned qualifications paragraphs plus one optional rate/disclosure paragraph ("My hourly rate is $X." + the non-contingency disclosure) to the `qualifications` section (or section 0 if none)

**Onboarding wizard** (`CaseOnboardingWizard.tsx`, declaration step): `POST /cases/:caseId/productions` with `{ name, type: 'declaration', data: { formatId } }`; if a declarant was picked, `GET /productions/:id` to fetch the server-seeded shape, run `applyDeclarant` client-side, then `PATCH /productions/:id` with the merged data.

The org settings page at `/orgs/[orgSlug]/declarations` manages the declarant roster and library; the per-case declaration editor lives under the case's productions workspace.

## Agent Surface

The `declarations` skill (`backend/src/skills/declarations.md`) teaches agents the five formats, the 8 atomic ops, per-jurisdiction oath/closing text, section drafting guidance, exhibit conventions, and a no-invention policy. It directs agents to `get_declarants` for qualifications and `get_declaration_library` for boilerplate.

Both agent surfaces expose the same capabilities:

| Surface | Read | Write |
|---------|------|-------|
| Built-in chat agent | `get_declarants`, `get_declaration_library`, `read_production` | `create_production` (type `declaration`), `update_production` (declaration ops) |
| MCP (bring-your-own-agent) | `get_declarants`, `get_declaration_library`, `read_production` (org/case-scoped via the session principal) | `create_production`, `update_production` (case role asserted per call, audited) |

See [ai-system.md](./ai-system.md) for dispatch, MCP auth, and audit details.

## Export

One shared engine, `renderDeclarationHtml` (`backend/src/modules/export/templates/declaration.ts`), resolves the format from the registry and handles paragraph numbering, section lettering, footnotes, the exhibit index, and sanitization (DOMPurify; inline `<b>/<i>/<u>` only). Format modules contribute only caption/oath/closing/styles/footer.

- **PDF**: Puppeteer (`ExportService.htmlToPdf`). `pleadingGutter` formats (CA) get tight margins plus the per-page line-numbered footer template; others get plain 1in margins.
- **DOCX**: `html-to-docx`; declarations render gutterless in DOCX mode since the fixed-position gutter cannot be represented.
- Route: `POST /exports/productions/:id` with `{ format }`; declarations allow `pdf` and `docx` only.
