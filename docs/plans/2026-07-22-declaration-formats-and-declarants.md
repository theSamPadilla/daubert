# Declaration Formats Registry + Person-Linked Declarants — Implementation Plan

**Goal:** Replace the two hardcoded declaration jurisdiction "variants" with an extensible **format registry** (adding Federal § 1746, Texas, and Florida), add a **faithful in-app preview** of the real filed layout, and promote loose declarant-profile blocks into a first-class **Declarant** entity (org-scoped, optionally linked to a member account) with a management tab and auto-fill into declarations.

## Summary

- **What & why:** A declaration has exactly two visual formats today — `ca-declaration`, `ny-affirmation` — hardcoded as `if variant === …` branches in `backend/src/modules/export/templates/declaration.ts`. Adding a jurisdiction means editing that file; there's no in-app preview of the real layout (only the exported PDF); and a "declarant profile" is a loose paragraph block with no structure or ownership. This resolves a three-tier model: **① Formats** (app-wide, platform-owned → a code registry), **② Declarants/boilerplate** (org-scoped → Declarant becomes a first-class person-linked entity; boilerplate stays a library block), **③ Declarations** (case-scoped → unchanged; consumes ① and ②).
- **Key product decisions (locked in ideation):**
  - Formats grow via a **code registry**, not a data-driven designer — legal print-fidelity is unforgiving; users only *select* a format, the platform ships modules.
  - Ship **CA, NY** (exist) **+ Federal § 1746, TX, FL** (new). The existing `variant` strings *become* the first two format ids → **no data migration**.
  - **In-app preview** reuses the backend renderer (served as HTML into a sandboxed iframe) — never a React re-implementation, so it can't drift from the exported PDF.
  - A **Declarant** is an org-scoped record that **can** link to a member account (that member self-edits) but does **not** require one (staff manage external experts). `declarant_profile` library blocks are migrated into it; boilerplate blocks are unchanged.
- **Load-bearing architecture decisions:**
  - `DeclarationFormat` is an interface; each jurisdiction is a self-contained module (caption, oath opening/closing, page options, footer, `requiredDeclarantFields`). The shared engine (¶ numbering, sub-items, endnotes, exhibit index, sanitization) stays common and is **not** duplicated per format. Confirmed by exploration: in `declaration.ts`, `renderParagraph`/`renderSection`/`sectionLetter`/`renderEndnotes`/`renderExhibitIndex`/`commonStyles` are already variant-agnostic; only `caOpening`/`nyOpening`, `caClosing`/`nyClosing`, `renderCaCaption`/`renderNyCaption`, `caStyles`/`nyStyles`, `buildDeclarationFooterTemplate` branch.
  - `formatId` rides in the `production.data` **JSONB** blob (verified: `production.entity.ts` has only `data jsonb`, no variant column) → **Part A needs no DB migration**. Readers resolve `data.formatId ?? data.variant ?? 'ca-declaration'` for back-compat with existing rows.
  - A format may **require extra fields**: TX unsworn declarations (Tex. CPRC § 132.001) mandate the declarant's **name, date of birth, and address** in the body. The registry declares these; the editor surfaces them; sourced from the linked Declarant when present.
  - Only **Part B** needs a migration (the `declarants` table). Dev auto-creates it via `synchronize: true`; prod migration is generated via `./migrations.sh --prod --generate` and **left unapplied**.
- **Risk concentration (opus tasks):** A2 (registry refactor + 5 modules; must preserve exact CA/NY output), A4 (preview endpoint + pane), B3 (declarants module + **new** self-ownership authz + auto-fill op), B5 (Declarants tab + editor auto-fill).
- **External dependency:** faithful TX / FL / Federal modules need a **sample filing each** (as CA/NY leaned on the Widmann/Falk PDFs). Tasks that author those modules are marked **needs reference**; without a sample they ship best-effort from statute language and are flagged for a later fidelity pass.

## Engineering decisions made

- Format ids reuse the existing variant strings: `ca-declaration`, `ny-affirmation`, plus `federal-1746`, `tx-declaration`, `fl-declaration`. A single `resolveFormatId(data)` helper (`data.formatId ?? data.variant ?? 'ca-declaration'`) is used by the renderer, export controller, and editor so existing prod rows (which only have `variant`) keep working with zero migration; the seed writes `formatId`.
- **`seedDeclarationData` must validate against the registry** — today it hardcodes "anything not `ny-affirmation` → `ca-declaration`", which would silently collapse `tx-declaration`/`fl-declaration`/`federal-1746` to CA. Fix: validate the incoming id against the registry's known ids, default to `ca-declaration` only when absent/unknown.
- Preview = a new **`GET` endpoint** returning server-rendered HTML (the export module currently has zero `@Get` routes; this is a new shape). Shown via `<iframe srcdoc>` / `src`. `htmlToPng` already exists but is not used here — HTML preview is live and cheaper.
- Declarant JSONB array fields (`qualifications: DeclarationParagraph[]`, `priorTestimony[]`) MUST be validated as bare `@IsObject()`/`@IsArray()` and coerced in the service — **never** a nested class-validator DTO. Under the global `whitelist`/`transform` pipe, class-transformer recurses into undecorated nested objects and collapses them to `[]` (this is the exact corruption bug already fixed once in `declaration-library`). Reuse the `normalizeLibraryContent` write-time-coercion pattern.
- Declarant `user_id` FK uses the `token-usage.entity.ts` precedent: `@Column({ name: 'user_id', type: 'uuid', nullable: true })` + `@ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })` — deleting a user orphans (not deletes) the Declarant.
- Authorization: declarants CRUD is `@RequireOrgRole('member')` (matching declaration-library — no admin gate), **plus** a service-level self-ownership check: a member may edit/delete a Declarant only if they're an org admin OR the Declarant's `userId` is theirs. `OrgRoleGuard` has no row-level concept, so this check is new code in the service, reading the authenticated user id off the request.
- `declarant_profile` library kind is deprecated and its rows backfilled into `declarants`; `boilerplate` blocks stay in the library. The agent's `get_declaration_library` + `declarations.md` (which today point qualifications at `declarant_profile`) are repointed to `get_declarants` in the **same** change so the drafting flow doesn't break.

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task. Do **NOT** commit — leave all changes in the working tree and run `git status` at the end of each task (no `Co-Authored-By` trailer anywhere). Part A and Part B are independent; Part A can land first. Within a part, tasks are ordered.

## Atomized Changes

| # | File | Action | What changes |
|---|------|--------|--------------|
| A1 | `contracts/schemas/productions.yaml` | Modify | Add `formatId` to `DeclarationData` (keep `variant` as deprecated alias) |
| A1 | `contracts/schemas/declaration-formats.yaml` | Create | `DeclarationFormat` summary schema |
| A1 | `contracts/paths/declaration-formats.yaml` | Create | `GET /declaration-formats`; `GET /productions/{id}/declaration-preview` |
| A1 | `contracts/openapi.yaml` | Modify | Register new schema + paths; regen both `api-types.ts` |
| A2 | `backend/src/modules/export/formats/` (`format.ts` interface + `registry.ts` + `ca.ts`,`ny.ts`,`federal-1746.ts`,`tx.ts`,`fl.ts`) | Create | Format registry + 5 jurisdiction modules |
| A2 | `backend/src/modules/export/templates/declaration.ts` | Modify | Drive rendering from the registry; keep shared engine; `resolveFormatId` |
| A2 | `backend/src/modules/productions/declaration-data.ts` | Modify | `formatId` in the TS type; `seedDeclarationData` validates against registry |
| A2 | `backend/src/modules/export/templates/declaration.spec.ts` | Create | Parity test: CA/NY output byte-identical after refactor; new formats render |
| A3 | `backend/src/modules/export/declaration-formats.controller.ts` | Create | `GET /declaration-formats` + `GET /productions/:id/declaration-preview` (HTML) |
| A3 | `backend/src/modules/export/export.module.ts` | Modify | Register the new controller |
| A3 | `backend/src/modules/export/export.controller.ts` | Modify | Declaration PDF export resolves format via registry for margins/gutter/footer (replaces the `isCa = decl.variant !== 'ny-affirmation'` binary) |
| A4 | `frontend/src/components/Productions/DeclarationPreviewPane.tsx` | Create | Sandboxed iframe rendering the preview HTML |
| A4 | `frontend/src/components/Productions/ProductionViewer.tsx`, `DeclarationEditor.tsx` | Modify | Preview/Edit toggle; surface format `requiredDeclarantFields` |
| A5 | `frontend/src/components/Workspace/NewPrimaryModal.tsx` | Modify | Format picker from `GET /declaration-formats` (kill hardcoded 2-button list + hand-copied type) |
| A5 | `frontend/src/components/Productions/DeclarationEditor.tsx` | Modify | Caption `Variant`→`Format` `<Select>` from registry |
| A5 | `frontend/src/lib/api-client.ts` | Modify | `listDeclarationFormats()`, `getDeclarationPreview(id)` |
| A6 | `backend/src/modules/ai/tools/tool-definitions.ts`, `backend/src/skills/declarations.md` | Modify | Document `formatId` + the 5 formats + TX required fields |
| B1 | `contracts/schemas/declarants.yaml`, `contracts/paths/declarants.yaml`, `contracts/openapi.yaml` | Create/Modify | Declarant schemas + org-scoped CRUD |
| B2 | `backend/src/database/entities/declarant.entity.ts`, `entities/index.ts` | Create/Modify | `declarants` table (org-scoped, optional `user_id` FK) |
| B2 | `backend/src/database/migrations/<ts>-AddDeclarants.ts` | Create (generated) | Prod migration (not applied) |
| B3 | `backend/src/modules/declarants/*` (module/service/controller/DTOs/spec), `app.module.ts` | Create/Modify | Declarant CRUD + self-ownership authz + JSONB coercion |
| B3 | `backend/src/modules/productions/productions.service.ts` (+ `.spec.ts`), `ai/tools/*`, `ai.service.ts` | Modify | `declaration_attach_declarant` op (auto-fill) + `get_declarants` read tool |
| B4 | `backend/src/modules/declaration-library/*`, migration backfill, `declarations.md` | Modify | Deprecate `declarant_profile` kind; backfill into `declarants`; repoint agent |
| B5 | `frontend/src/app/orgs/[orgSlug]/settings/DeclarantsSection.tsx` (+ `page.tsx`, `DeclarationLibrarySection.tsx`) | Create/Modify | Declarants tab; boilerplate-only library; Kicker renumber |
| B5 | `frontend/src/components/Productions/DeclarationEditor.tsx`, `frontend/src/lib/api-client.ts` | Modify | "Select declarant → auto-fill" (reuse orgId→slug pattern); declarant api-client methods |
| B6 | — | — | Full verification sweep (gen/test/build), confirm migration unapplied |

---

## Reference: `DeclarationFormat` interface (canonical for Part A)

```typescript
export interface DeclarationFormat {
  id: string;                    // 'ca-declaration' | 'ny-affirmation' | 'federal-1746' | 'tx-declaration' | 'fl-declaration'
  label: string;                 // 'California Declaration'
  jurisdiction: string;          // 'CA' | 'NY' | 'Federal' | 'TX' | 'FL'
  description: string;           // one-liner for the picker
  pleadingGutter: boolean;       // CA true; others false
  pageFormat: 'A4' | 'Letter';
  requiredDeclarantFields: Array<'dateOfBirth' | 'address'>;   // TX: both; others: []
  renderCaption(data: DeclarationData): string;
  renderOathOpening(data: DeclarationData): string;
  renderClosing(data: DeclarationData): string;
  styles(): string;              // format-specific CSS (gutter for CA, @page for others)
  footerTemplate?(data: DeclarationData): string;              // Puppeteer per-page footer (CA)
}
```

`registry.ts` exports `Map<id, DeclarationFormat>` + `getFormat(id)` + `listFormatSummaries()`. `renderDeclarationHtml(data, opts)` calls `getFormat(resolveFormatId(data))` and drives the shared engine with the format's hooks. Oath seeds (refine against reference filings):
- **Federal § 1746:** "I declare under penalty of perjury under the laws of the United States of America that the foregoing is true and correct. Executed on <date>." (no pleading gutter).
- **TX § 132.001:** body states name/DOB/address; "I declare under penalty of perjury that the foregoing is true and correct."
- **FL § 92.525:** "Under penalties of perjury, I declare that I have read the foregoing … and that the facts stated in it are true."

---

## Part A — Format registry, jurisdictions, preview

### Task A1: Contracts — formatId, formats list, preview endpoint
**Implementer:** sonnet
**Files:** Modify `contracts/schemas/productions.yaml` (`DeclarationData`: add `formatId: DeclarationVariant`-style enum extended to the 5 ids; keep `variant` as an optional deprecated field). Create `contracts/schemas/declaration-formats.yaml` (`DeclarationFormat`: id, label, jurisdiction, description, pleadingGutter, requiredDeclarantFields[]). Create `contracts/paths/declaration-formats.yaml`: `GET /declaration-formats` → `DeclarationFormat[]`; `GET /productions/{id}/declaration-preview` → `200 text/html`. Register both in `contracts/openapi.yaml`.
- **Step 1:** Extend the `DeclarationVariant` enum (or add a `DeclarationFormatId` enum) to the 5 ids; wire `DeclarationData.formatId`.
- **Step 2:** Author the two new files mirroring `declaration-library.yaml`/`paths/declaration-library.yaml` style.
- **Step 3:** `npm run gen`; confirm `DeclarationFormat` + the 5-id enum appear in both `backend/` and `frontend/` `api-types.ts`. `git status`.

### Task A2: Backend — format registry + 5 modules (refactor; preserve CA/NY output)
**Implementer:** opus  ·  *TX/FL/Federal modules: needs reference filing*
**Files:** Create `backend/src/modules/export/formats/format.ts` (the interface above), `registry.ts`, and `ca.ts`,`ny.ts`,`federal-1746.ts`,`tx.ts`,`fl.ts`. Modify `backend/src/modules/export/templates/declaration.ts` and `backend/src/modules/productions/declaration-data.ts`. Create `templates/declaration.spec.ts`.
- **Step 1 — parity test first:** in `declaration.spec.ts`, snapshot `renderDeclarationHtml` output for a fixed CA sample and a fixed NY sample using the CURRENT code (capture the exact HTML). This is the guardrail — the refactor must not change CA/NY output.
- **Step 2:** Extract the existing CA logic (`caOpening` 177-179, `caClosing` 187-198, `renderCaCaption` 227-249, `caStyles` 337-388, `buildDeclarationFooterTemplate` 476-482, `pleadingGutter: true`) into `ca.ts` implementing `DeclarationFormat`; likewise NY (`nyOpening`, `nyClosing`, `renderNyCaption`, `nyStyles`, no footer) into `ny.ts`. Keep the shared engine functions (`renderParagraph`, `renderSection`, `sectionLetter`, `renderEndnotes`, `renderExhibitIndex`, `commonStyles`) in `declaration.ts` unchanged.
- **Step 3:** Rewrite `assembleBody`/`renderDeclarationHtml` to `getFormat(resolveFormatId(data))` and call the format hooks; add `resolveFormatId(data) = data.formatId ?? data.variant ?? 'ca-declaration'`. Add `federal-1746.ts`, `tx.ts`, `fl.ts` (author bodies against reference filings; TX sets `requiredDeclarantFields: ['dateOfBirth','address']` and renders them per § 132.001).
- **Step 4:** Update `seedDeclarationData` (`declaration-data.ts:84`) to `const id = input?.formatId ?? input?.variant; return registry.has(id) ? id : 'ca-declaration'` — no more binary CA/NY collapse. Add `formatId` to the `DeclarationData` TS type.
- **Step 5:** Run the parity test — CA/NY unchanged. `npm run build --prefix backend`. Visual-verify the 3 new formats with the scratchpad render script from the prior plan. `git status`.

### Task A3: Backend — formats + preview endpoints + export margin fix
**Implementer:** sonnet
**Files:** Create `backend/src/modules/export/declaration-formats.controller.ts`; Modify `export.module.ts`, `export.controller.ts`.
- `GET /declaration-formats` → `registry.listFormatSummaries()`.
- `GET /productions/:id/declaration-preview` → load the production (reuse the same case-access guard the productions read path uses — verify from `productions.controller.ts`), render `renderDeclarationHtml(data, { preview: true })` (gutter included, screen-oriented), return `text/html`. Note: export module has no existing `@Get`; add the controller and register it.
- **Export margin fix (load-bearing):** `export.controller.ts`'s declaration PDF branch (lines 138-156) currently does `const isCa = decl.variant !== 'ny-affirmation'` to pick Puppeteer margins + whether to attach the CA footer. After A2, a TX/FL/Federal declaration has `formatId` but no `variant`, so this silently gives every new format CA's pleading-gutter margins + footer on the real filed PDF. Replace the `isCa` binary with `const format = getFormat(resolveFormatId(decl))` and drive `pageFormat`/`pleadingGutter`/`footerTemplate?.(decl)` from the format. Add a test asserting CA/NY export margins are unchanged post-refactor AND that a TX/FL/Federal declaration exports with its own (non-CA-gutter) margins. `git status`.

### Task A4: Frontend — preview pane + required fields
**Implementer:** opus
**Files:** Create `frontend/src/components/Productions/DeclarationPreviewPane.tsx`; Modify `ProductionViewer.tsx`, `DeclarationEditor.tsx`.
- Preview pane fetches the preview HTML (via `getDeclarationPreview(id)`) into a sandboxed `<iframe srcdoc={html} sandbox="allow-same-origin">`; refresh (debounced) after the editor's save settles.
- A "Preview / Edit" toggle in the declaration view (mirror the existing Edit/View toggle at `ProductionViewer.tsx:409`).
- Surface `requiredDeclarantFields` for the selected format (e.g. TX → DOB + address inputs in the caption panel), reading the field list from the format summary. `tsc --noEmit` + build. `git status`.

### Task A5: Frontend — registry-driven pickers + api-client
**Implementer:** sonnet
**Files:** Modify `NewPrimaryModal.tsx`, `DeclarationEditor.tsx`, `api-client.ts`.
- api-client: `listDeclarationFormats()`, `getDeclarationPreview(id)`.
- `NewPrimaryModal.tsx`: replace the hardcoded 2-button list (140-162) + hand-copied `DeclarationVariant` type (line 11) with buttons rendered from `listDeclarationFormats()`; payload `{ formatId }`.
- `DeclarationEditor.tsx`: replace the caption `Variant` `<Select>` hardcoded 2-option list (336-344) with registry-driven options; write `formatId` via `emit`. `tsc` + build. `git status`.

### Task A6: Agent tool + skill doc
**Implementer:** sonnet
**Files:** Modify `backend/src/modules/ai/tools/tool-definitions.ts` (`CREATE_PRODUCTION_TOOL` data description, line ~143: `{ formatId: <one of 5>, caption?, declarantName? }`), `backend/src/skills/declarations.md` (rewrite the "Variant differences" section 50-66 to cover all 5 formats + note TX requires DOB/address). Build. `git status`.

## Part B — Person-linked Declarants

### Task B1: Contracts — Declarant schemas + endpoints
**Implementer:** sonnet
**Files:** Create `contracts/schemas/declarants.yaml` (`Declarant`, `CreateDeclarantRequest`, `UpdateDeclarantRequest`: `displayName`, `title?`, `firm?`, `qualifications: DeclarationParagraph[]` via `$ref`, `cvExhibit?`, `priorTestimony?: string[]`, `hourlyRate?`, `nonContingencyDisclosure?`, `dateOfBirth?`, `address?`, `userId?`), `contracts/paths/declarants.yaml` (org-scoped `GET/POST /orgs/{org}/declarants`, `PATCH/DELETE …/{id}`). Register; `npm run gen`. `git status`.

### Task B2: Backend — Declarant entity + migration
**Implementer:** sonnet
**Files:** Create `backend/src/database/entities/declarant.entity.ts`; Modify `entities/index.ts`; generate migration.
- Mirror `declaration-library-block.entity.ts` (org FK `onDelete: 'CASCADE'`), plus the optional user FK per the `token-usage.entity.ts` precedent (`user_id` uuid nullable, `@ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })`). Structured columns + `jsonb` for `qualifications`/`priorTestimony`.
- Register in `entities/index.ts` (alphabetical, before `DeclarationLibraryBlockEntity`).
- `npm run build --prefix backend` (dev auto-syncs the table). Generate the prod migration: `./migrations.sh --prod --generate AddDeclarants` — **do not apply**; trim any unrelated drift as with the prior migration. `git status`.

### Task B3: Backend — declarants module + auto-fill op + read tool
**Implementer:** opus
**Files:** Create `backend/src/modules/declarants/` (module, service, controller, DTOs, `declarants.service.spec.ts`); Modify `app.module.ts`, `productions.service.ts` (+ `.spec.ts`), `ai/tools/*`, `ai.service.ts`.
- **Step 1 — failing tests:** mirror `declaration-library.service.spec.ts` (plain-object repo mocks, compound `(id, organizationId)` scoping, cross-org 404). ADD self-ownership tests: a non-admin member editing a Declarant whose `userId ≠ them` → Forbidden; editing their own → ok; admin editing any → ok.
- **Step 2:** Implement the service mirroring `declaration-library.service.ts`; scope every query by `organizationId`; add the self-ownership guard (admin OR `declarant.userId === requesterUserId`) inside `update`/`remove` — pass the requester's user id + role from the controller (read them off the request the same way `OrgRoleGuard` populates `req.orgMembership`). Coerce JSONB array fields with a `normalizeDeclarant`-style helper; DTOs use bare `@IsObject()`/`@IsArray()` (NOT nested DTOs — the class-transformer collapse gotcha).
- **Step 3 — auto-fill op:** add `declaration_attach_declarant` to the `Op` union (productions.service.ts ~29-62), `parseOp`, and `applyOp` (after the type-guard at 482). Handler: fetch the declarant, **append** its `qualifications` paragraphs (fresh UUIDs, via the `declaration_add_paragraph` pattern at 593-621) into the declaration's `qualifications`-kind section, and set `declarantName`/rate/disclosure only if currently empty (never overwrite). Extend `productions.service.spec.ts` with tests.
- **Step 4:** Add `get_declarants` (read-only) to the agent tool set + dispatch in `ai.service.ts` (resolve case → `orgId` → `DeclarantsService.listForOrg`), mirroring the `get_declaration_library` wiring. Register in the READ-ONLY set.
- **Step 5:** `npm test --prefix backend -- declarants productions.service`; build. `git status`.

### Task B4: Backend — deprecate declarant_profile blocks
**Implementer:** sonnet
**Files:** Modify `backend/src/modules/declaration-library/*`, the B2 migration (add backfill), `backend/src/skills/declarations.md`.
- Backfill: in the `AddDeclarants` migration `up()`, `INSERT INTO declarants (…) SELECT … FROM declaration_library_blocks WHERE kind='declarant_profile'` (map `content.paragraphs` → `qualifications`), then delete/deprecate those rows. Guard the down().
- Library service/DTO/UI stop offering `kind: declarant_profile` (boilerplate only); keep back-compat reads.
- `declarations.md`: repoint the qualifications-source paragraph (line ~72) from `get_declaration_library`/`declarant_profile` to `get_declarants`. **Must land with B3** so the agent flow stays intact.
- `npm test --prefix backend -- declaration-library`; build. `git status`.

### Task B5: Frontend — Declarants tab + editor auto-fill
**Implementer:** opus
**Files:** Create `frontend/src/app/orgs/[orgSlug]/settings/DeclarantsSection.tsx`; Modify `settings/page.tsx`, `DeclarationLibrarySection.tsx`, `DeclarationEditor.tsx`, `api-client.ts`.
- api-client: `listDeclarants/createDeclarant/updateDeclarant/deleteDeclarant(orgSlug, …)`.
- `DeclarantsSection.tsx` (fork `DeclarationLibrarySection.tsx`): list/create/edit declarants with structured fields + a paragraphs editor for `qualifications`; mount in `page.tsx` (renumber `Kicker index` — currently OrgInfo=1, Members=2, Library=3, Invites=4; insert Declarants and renumber contiguously). Self-owned editing: show edit controls when `isAdmin` OR the declarant's `userId === currentUserId`.
- `DeclarationLibrarySection.tsx` → boilerplate only (drop the `declarant_profile` group), retitle.
- `DeclarationEditor.tsx`: a "Select declarant" control that calls the attach/auto-fill path (via an `update_production` op or a dedicated method); resolve the case's org slug with the exact `useCaseContext().orgId → user.orgs.find(id).slug` pattern from `DeclarationLibraryPicker.tsx:54-57` (never the active org).
- `tsc` + build; manual check with dev servers. `git status`.

### Task B6: Migration + full verification
**Implementer:** sonnet
- Confirm the `AddDeclarants` migration (schema + declarant_profile backfill) is correct and **unapplied**.
- Sweep: `npm run gen` (no churn), `npm test --prefix backend`, `npm test --prefix frontend`, both builds. Note the known pre-existing e2e Postgres failures separately. `git status` — full manifest, no commits.
