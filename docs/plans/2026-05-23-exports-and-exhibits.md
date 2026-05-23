# Export Consolidation + Exhibit Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace four scattered export UIs with a single shared `<ExportModal>` (filename + format), remove HTML export entirely, add DOCX (reports) and PNG (chronologies) outputs, and add an ad-hoc "Create Exhibit" flow that bundles multiple investigations and productions into a single PDF.

**Architecture:** All export paths converge on one backend module and one frontend modal. Exhibits are export-time only — no persistence, no new entity — and reuse the same modal (with `kind: 'exhibit'`) plus a new `POST /exports/exhibit` endpoint. A single Puppeteer pass composes per-item HTML sections separated by `page-break-before: always`. Investigation graphs are snapshotted client-side via hidden `GraphCanvas` instances at export time and uploaded as imageDataUrls.

**Tech Stack:** NestJS, Puppeteer (existing), `html-to-docx` (new), Next.js 14 App Router, React 18, Cytoscape.js, OpenAPI YAML → TypeScript codegen, Jest (backend + frontend), TypeORM (untouched).

**Supersedes:** `docs/plans/2026-05-23-export-modal-consolidation.md` (delete as the very first task — Task 1).

**Commit policy:** per project `CLAUDE.md`, NEVER commit unless the user explicitly says so. Each task ends with the work in the working tree; the user reviews and commits. No `git commit` instructions appear below — if you see one, it's a bug; just leave the changes staged-or-unstaged for the user. Run `git status` at the end of each task so the diff is visible.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/package.json` | Modify | Add `html-to-docx` dependency. |
| 2 | `backend/src/modules/export/export.service.ts` | Modify | Add `htmlToPng()` (Puppeteer screenshot) and `htmlToDocx()` (html-to-docx). |
| 3 | `backend/src/modules/export/export.service.spec.ts` | Modify | Add tests for PNG + DOCX paths. |
| 4 | `backend/src/modules/export/export.controller.ts` | Modify | Drop `html` format. Add `docx` (reports only) and `png` (chronologies only). Accept `filename` in body. |
| 5 | `backend/src/modules/export/exhibit-composer.ts` | Create | Compose multi-item HTML for exhibit PDF. |
| 6 | `backend/src/modules/export/exhibit-composer.spec.ts` | Create | Unit-test the composer's page-break and item-rendering behavior. |
| 7 | `backend/src/modules/export/exhibit.dto.ts` | Create | DTO for `POST /exports/exhibit` payload. |
| 8 | `contracts/paths/export.yaml` | Modify | Drop `html`, add `docx`/`png` format enum, add `filename` field, add `/exports/exhibit` operation. |
| 9 | `contracts/openapi.yaml` | Modify | Register new path if needed (verify if include is automatic). |
| 10 | `backend/src/generated/api-types.ts` | Regenerate | Reflect new contract. |
| 11 | `frontend/src/generated/api-types.ts` | Regenerate | Reflect new contract. |
| 12 | `frontend/src/lib/api-client.ts` | Modify | New `exportProduction(id, format, filename, imageDataUrl?)` signature with `format: 'pdf' \| 'png' \| 'docx'`. New `exportGraph(name, filename, imageDataUrl)`. New `exportExhibit(payload)`. |
| 13 | `frontend/src/components/ExportModal.tsx` | Modify | New API: `kind` prop drives format options, filename input with live extension suffix, async `onExport(format, filename)` with inline spinner + error. |
| 14 | `frontend/src/components/ProductionViewer.tsx` | Modify | Replace PDF/HTML buttons with one Export button → modal. Drop HTML, drop per-format state. |
| 15 | `frontend/src/app/cases/[caseId]/investigations/page.tsx` | Modify | Pass `kind="graph"`, default filename = investigation name, new `onExport(format, filename)` signature. |
| 16 | `frontend/src/components/ExhibitBuilder.tsx` | Create | Full-screen modal: picker (left) + composition list (right) + filename input + Export button. |
| 17 | `frontend/src/hooks/useGraphSnapshot.ts` | Create | Mounts a hidden `GraphCanvas` with a full Investigation object, polls for canvas readiness, returns `imageDataUrl`. |
| 18 | `frontend/src/hooks/useChartSnapshot.ts` | Create | Mounts a hidden `ChartViewer` with chart data, polls for canvas readiness, returns `imageDataUrl`. |
| 19 | `frontend/src/components/InvestigationsSidebar.tsx` | Modify | Add "Create Exhibit" button near the case name. |
| 20 | `backend/src/modules/investigations/investigations.module.ts` | Modify | Export `InvestigationsService` for cross-module injection. |
| 21 | `backend/src/modules/export/export.module.ts` | Modify | Import `InvestigationsModule` for the exhibit endpoint. |

### What changes (UX and DX)

**For the user (UX):**
- One consistent export interaction across the app — open modal, name the file, pick format, export.
- Filenames are user-controlled (with sensible defaults).
- Reports open in Word (DOCX). Chronologies export as PNG for slides.
- No more stray HTML downloads.
- New: bundle investigations + productions into a single PDF "exhibit" without leaving the app.

**For the developer (DX):**
- One `<ExportModal>` to maintain. One backend module that owns all export plumbing.
- Per-feature export logic is just "extract source data → call `onExport`". The modal owns input, validation, loading, and error chrome.
- Exhibit composition is a single HTML doc → single Puppeteer pass; no PDF merging libraries.

## Format matrix (after refactor)

| Kind | PDF | PNG | DOCX |
|---|---|---|---|
| Graph (Cytoscape) | ✅ server | ✅ client | ❌ |
| Chart (Chart.js) | ✅ server | ✅ client | ❌ |
| Chronology (table) | ✅ server | ✅ server (Puppeteer screenshot) | ❌ |
| Report (rich text) | ✅ server | ❌ | ✅ server (html-to-docx) |
| Exhibit (composite) | ✅ server | ❌ | ❌ |

HTML export removed everywhere.

## Component API — ExportModal

```tsx
type ExportKind = 'graph' | 'chart' | 'chronology' | 'report' | 'exhibit';
type ExportFormat = 'pdf' | 'png' | 'docx';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  kind: ExportKind;
  defaultFilename: string;
  onExport: (format: ExportFormat, filename: string) => Promise<void>;
}

const FORMATS_BY_KIND: Record<ExportKind, ExportFormat[]> = {
  graph:      ['pdf', 'png'],
  chart:      ['pdf', 'png'],
  chronology: ['pdf', 'png'],
  report:     ['pdf', 'docx'],
  exhibit:    ['pdf'],
};
```

Modal owns filename + format + submit state. On submit, awaits the parent's Promise; closes on success, renders inline error on rejection.

## Backend — Exhibit composer

```ts
// exhibit-composer.ts
interface ExhibitItem {
  title: string;
  subtitle?: string;
  body: 'report' | 'chart' | 'chronology' | 'graph';
  // For 'report'/'chart'/'chronology': production id, fetched server-side.
  productionId?: string;
  // For 'chart': PNG data URL captured client-side.
  chartImageDataUrl?: string;
  // For 'graph': PNG data URL captured client-side.
  graphImageDataUrl?: string;
  graphLabel?: string; // investigation name, used as item caption
}

export async function composeExhibitHtml(
  items: { html: string; title: string; subtitle?: string }[],
  exhibitName: string,
): Promise<string> {
  const sections = items.map((it, i) => `
    <section class="exhibit-item${i > 0 ? ' page-break' : ''}">
      <header class="exhibit-item-header">
        <h2>${escapeHtml(it.title)}</h2>
        ${it.subtitle ? `<p class="subtitle">${escapeHtml(it.subtitle)}</p>` : ''}
      </header>
      <div class="exhibit-item-body">${it.html}</div>
    </section>
  `).join('');
  return `<!DOCTYPE html>...${sections}...`;
}
```

The composer expects per-item HTML already rendered by existing `renderReport` / `renderChronology` / `renderChart` / `renderGraph` template functions (just the `<body>` inner content, not full documents — refactor those templates to expose a `renderBody` variant if needed).

CSS: `.exhibit-item.page-break { page-break-before: always; }`.

## Frontend — ExhibitBuilder layout

```
┌─ Create Exhibit ────────────────────────────── [ Cancel ] ─┐
│                                                            │
│ Filename: [ smith_motion_exhibit              ].pdf        │
│                                                            │
│ ┌── Available ──────┐  ┌── Composition ───────────────┐    │
│ │ Investigations    │  │ ≡ 1.  Wallet Trace Overview  │    │
│ │  ▢ Trace Alpha    │  │       As of May 20, 2026     │    │
│ │  ▢ Trace Beta     │  │       [Investigation]      ✕ │    │
│ │ Productions       │  │ ─────────────────────────────│    │
│ │  ▢ Q1 Report      │  │ ≡ 2.  Volume Chart           │    │
│ │  ▢ Volume Chart   │  │       14 transfers           │    │
│ │  ▢ Chronology     │  │       [Chart]              ✕ │    │
│ │                   │  │                              │    │
│ │  [ Add → ]        │  │                              │    │
│ └───────────────────┘  └──────────────────────────────┘    │
│                                                            │
│                                  [ Export PDF ]            │
└────────────────────────────────────────────────────────────┘
```

- Left pane: groups of selectable items. "Add →" pushes checked items into composition.
- Right pane: ordered list. Drag handle (native HTML5 DnD) for reorder, ✕ to remove.
- Inline-editable title + subtitle per row. Defaults from object name + type metadata.
- "Export PDF" triggers the snapshot loop (only for investigation items), then a single API call.

## Default filename rules

| Kind | Default |
|---|---|
| Graph | `<investigation_name>` |
| Chart / Report / Chronology | `<production_name>` |
| Exhibit | `<case_name>_exhibit` |

All client-side sanitized: lowercased, `[^a-z0-9_-]` → `_`.

## Engineering decisions made

- **PNG only** (no JPG). Lossless, text-friendly.
- **Modal owns submit state**. Parents pass an async `onExport`; modal handles spinner/error.
- **Filename input UX**: stem only; extension shown as a live suffix label that updates with the format selection.
- **Sanitization**: client-side before submit, server-side again in `Content-Disposition`.
- **Chronology PNG**: server-side Puppeteer screenshot of the existing chronology template at 1200px width.
- **DOCX**: `html-to-docx` (pure JS, no native binaries, ~140 KB). Operates on the existing report HTML directly. **Decision: best-effort fidelity, no gating.** TipTap citations (`<span class="citation">`) render as inline `[N]` rather than superscript; chronology column widths revert to defaults. DOCX is documented as "edit in Word as needed." No code-level detection or blocking of citations — just ship it.
- **Chart PNG**: stays client-side (canvas `toDataURL` → anchor download). Only PDF/DOCX/chronology-PNG hit the API.
- **Exhibits are export-time only**: no persistence, no new entity, no migration. Snapshot semantics evaporate.
- **Graph snapshot**: at export time, mount `<GraphCanvas>` in a hidden container per investigation item, poll for canvas readiness, `cy.png()`, unmount. **The snapshot respects the investigation's current visibility/collapsed state** — whatever the user sees when they add the item is what the exhibit captures. No forced "expand all" pass.
- **Chart snapshot**: same hidden-mount pattern as graphs, using a new `useChartSnapshot` hook that renders `<ChartViewer>` off-screen with the production's `data`. Captures the canvas via `toDataURL('image/png')`. Avoids requiring the user to have visited the chart this session.
- **Oversize graphs in exhibits**: `renderGraphBody` uses `max-width: 100%; max-height: 100%; object-fit: contain;` inside a portrait-A4 page. Tall/wide graphs scale to fit; no landscape-A4 mode for exhibits.
- **PDF assembly**: single composed HTML → single Puppeteer pass with `page-break-before: always`. No `pdf-lib` merge step.
- **Per-item title placement**: small banner header on the same page as the content. No dedicated cover pages.
- **Reordering**: native HTML5 DnD, no `react-dnd` dependency.

---

## Tasks

> Test-first where the unit is testable in isolation (composer, service methods). For UI, fast-iterate locally and manually smoke-test the matrix at the end of each phase. **No commits** — leave the working tree dirty for the user to review.

### Phase 0 — Cleanup (run first)

**Task 0: Delete superseded plan**

This plan supersedes `docs/plans/2026-05-23-export-modal-consolidation.md`. Delete it so there's only one source of truth.

```bash
rm docs/plans/2026-05-23-export-modal-consolidation.md
```

Leave the deletion in the working tree (do NOT commit). The user reviews at the end.

### Phase 1 — Backend export plumbing

**Task 1: Add `html-to-docx` dependency**

Files:
- Modify: `backend/package.json`

Steps:
1. Run: `cd backend && npm install html-to-docx@^1.8.0 && cd ..`
   Expected: package added, no peer-dep warnings about native binaries.
2. Verify: `node -e "console.log(typeof require('html-to-docx'))"` from `backend/` → `function`.
3. Commit:
   ```bash
   git add backend/package.json backend/package-lock.json
   git commit -m "deps(backend): add html-to-docx for DOCX export"
   ```

**Task 2: Implement `htmlToPng()` in `ExportService` (TDD)**

Files:
- Modify: `backend/src/modules/export/export.service.ts`
- Modify: `backend/src/modules/export/export.service.spec.ts`

Step 1: Write the failing test. Add to `export.service.spec.ts` after the existing `htmlToPdf` tests:

```ts
it('htmlToPng returns a PNG Buffer', async () => {
  if (!chromeAvailable) return;
  const result = await service.htmlToPng('<html><body><h1>Hi</h1></body></html>');
  expect(Buffer.isBuffer(result)).toBe(true);
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  expect(result[0]).toBe(0x89);
  expect(result.subarray(1, 4).toString('ascii')).toBe('PNG');
});
```

Step 2: Run: `cd backend && npm test -- export.service`
Expected: FAIL with `service.htmlToPng is not a function`.

Step 3: Implement in `export.service.ts` (add method below `htmlToPdf`):

```ts
async htmlToPng(html: string, opts?: { width?: number; timeout?: number }): Promise<Buffer> {
  const browser = await this.getBrowser();
  const page = await browser.newPage();
  const timeout = opts?.timeout ?? 30_000;
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith('data:')) req.continue();
      else req.abort();
    });
    await page.setViewport({ width: opts?.width ?? 1200, height: 800 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout });
    // Wait for web fonts to finish loading; otherwise the screenshot can
    // race the font swap and capture fallback metrics. (PDF tolerates this
    // better than a raster screenshot does.)
    await page.evaluate(() => (document as any).fonts?.ready ?? Promise.resolve());
    const png = await page.screenshot({ fullPage: true, type: 'png', timeout });
    return Buffer.from(png);
  } finally {
    await page.close();
  }
}
```

Step 4: Run the test again. Expected: PASS.

Step 5: Commit:
```bash
git add backend/src/modules/export/export.service.ts backend/src/modules/export/export.service.spec.ts
git commit -m "feat(export): add htmlToPng via Puppeteer screenshot"
```

**Task 3: Implement `htmlToDocx()` in `ExportService` (TDD)**

Files:
- Modify: `backend/src/modules/export/export.service.ts`
- Modify: `backend/src/modules/export/export.service.spec.ts`

Step 1: Write the failing test:

```ts
it('htmlToDocx returns a DOCX Buffer', async () => {
  const result = await service.htmlToDocx('<p>Hello <strong>world</strong></p>');
  expect(Buffer.isBuffer(result)).toBe(true);
  // DOCX is a ZIP archive: first two bytes are "PK"
  expect(result.subarray(0, 2).toString('ascii')).toBe('PK');
});
```

Step 2: Run: `npm test -- export.service` → FAIL.

Step 3: Implement.

`html-to-docx` is a CommonJS module. The backend's `tsconfig.json` has `esModuleInterop: true`, so the default import below should work. **If TS complains at build time** ("has no default export"), fall back to `import * as HTMLtoDOCX from 'html-to-docx'` and call `(HTMLtoDOCX as any)(...)`, or `const HTMLtoDOCX = require('html-to-docx')`. Confirm in the first build cycle.

```ts
import HTMLtoDOCX from 'html-to-docx';
// ...
async htmlToDocx(html: string): Promise<Buffer> {
  const result = await HTMLtoDOCX(html, undefined, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
  });
  return Buffer.isBuffer(result) ? result : Buffer.from(result as ArrayBuffer);
}
```

Step 4: Run test → PASS.

Step 5: Commit:
```bash
git add backend/src/modules/export/export.service.ts backend/src/modules/export/export.service.spec.ts
git commit -m "feat(export): add htmlToDocx via html-to-docx"
```

**Task 4a: Format gating in `exportProduction`**

Files:
- Modify: `backend/src/modules/export/export.controller.ts`

Replace the format validation block at the top of `exportProduction`. This task is gating only — branch logic comes in Task 4b/4c.

```ts
const format = body.format;
if (!['pdf', 'png', 'docx'].includes(format)) {
  throw new BadRequestException('format must be "pdf", "png", or "docx"');
}

const production = await this.productionsService.findOne(id, { kind: 'user', userId });
const ALLOWED: Record<string, string[]> = {
  report:     ['pdf', 'docx'],
  chronology: ['pdf', 'png'],
  chart:      ['pdf'],          // png is client-side, never hits backend
};
const allowed = ALLOWED[production.type];
if (!allowed?.includes(format)) {
  throw new BadRequestException(`Format "${format}" not supported for ${production.type}`);
}
```

Add a controller test (`export.controller.spec.ts`, create if missing) asserting:
- POST report + `format: 'png'` → 400
- POST chart + `format: 'docx'` → 400
- POST chronology + `format: 'png'` → reaches branch logic (mock service)

**Task 4b: DOCX branch (reports)**

Files:
- Modify: `backend/src/modules/export/export.controller.ts`

Branch on format after `html` is built. (Format validation already in Task 4a.)

```ts
const filename = (body.filename || production.name || 'export').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'export';

if (format === 'docx') {
  const docx = await this.exportService.htmlToDocx(html);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
  res.send(docx);
  return;
}

if (format === 'png') {
  const png = await this.exportService.htmlToPng(html, { width: 1200 });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.png"`);
  res.send(png);
  return;
}

// pdf
const pdf = await this.exportService.htmlToPdf(html, { landscape: production.type === 'chart' });
res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
res.send(pdf);
```

**Task 4c: PNG branch (chronology) + accept `filename` on `exportGraph`**

Files:
- Modify: `backend/src/modules/export/export.controller.ts`

(PNG branch already in Task 4b's branch block above; this sub-task is just the `exportGraph` filename change for clarity.)

Accept `filename` on `exportGraph`:

```ts
async exportGraph(@Body() body: { name: string; filename?: string; imageDataUrl: string }, ...) {
  // existing body, but use body.filename for the Content-Disposition when provided
}
```

Run: `cd backend && npm test -- export` (whole module). Expect existing tests still pass.

Commit:
```bash
git add backend/src/modules/export/export.controller.ts
git commit -m "feat(export): drop html format, add docx (reports) and png (chronologies)"
```

**Task 5: Create exhibit DTO**

Files:
- Create: `backend/src/modules/export/exhibit.dto.ts`

```ts
import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ExhibitItemDto {
  @IsIn(['production', 'investigation'])
  refType!: 'production' | 'investigation';

  @IsUUID()
  refId!: string;

  @IsString() @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(300)
  subtitle?: string;

  // PNG data URL for investigations (graph snapshot).
  // Also accepted for chart productions (client-captured canvas).
  @IsOptional() @IsString()
  imageDataUrl?: string;
}

export class ExportExhibitDto {
  @IsString() @MaxLength(200)
  filename!: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => ExhibitItemDto)
  items!: ExhibitItemDto[];
}
```

Commit:
```bash
git add backend/src/modules/export/exhibit.dto.ts
git commit -m "feat(export): add exhibit DTOs"
```

**Task 6: Implement exhibit HTML composer (TDD)**

Files:
- Create: `backend/src/modules/export/exhibit-composer.ts`
- Create: `backend/src/modules/export/exhibit-composer.spec.ts`

Step 1: Write the failing test:

```ts
import { composeExhibitHtml } from './exhibit-composer';

describe('composeExhibitHtml', () => {
  it('renders one section per item with banner header', () => {
    const html = composeExhibitHtml([
      { title: 'Item A', subtitle: 'sub a', bodyHtml: '<p>body a</p>' },
      { title: 'Item B', bodyHtml: '<p>body b</p>' },
    ]);
    expect(html).toContain('Item A');
    expect(html).toContain('sub a');
    expect(html).toContain('<p>body a</p>');
    expect(html).toContain('Item B');
    expect(html).toContain('<p>body b</p>');
  });

  it('inserts page-break-before on items after the first', () => {
    const html = composeExhibitHtml([
      { title: 'A', bodyHtml: '<p>a</p>' },
      { title: 'B', bodyHtml: '<p>b</p>' },
      { title: 'C', bodyHtml: '<p>c</p>' },
    ]);
    // Count page-break sections — should be 2 (between A→B and B→C)
    const matches = html.match(/class="exhibit-item page-break"/g);
    expect(matches?.length).toBe(2);
  });

  it('escapes user-provided titles', () => {
    const html = composeExhibitHtml([
      { title: '<script>x</script>', bodyHtml: '<p>safe</p>' },
    ]);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

Step 2: Run: `cd backend && npm test -- exhibit-composer` → FAIL (no module).

Step 3: Implement `exhibit-composer.ts`:

```ts
import { BASE_STYLES, CSP_META } from './templates/styles';
import { escapeHtml } from './templates/util';

interface ComposedItem {
  title: string;
  subtitle?: string;
  bodyHtml: string; // already-sanitized inner HTML
}

const EXHIBIT_STYLES = `
  .exhibit-item { padding-top: 16pt; }
  .exhibit-item.page-break { page-break-before: always; }
  .exhibit-item-header { border-bottom: 1pt solid #999; margin-bottom: 12pt; padding-bottom: 6pt; }
  .exhibit-item-header h2 { font-size: 16pt; margin: 0; }
  .exhibit-item-header .subtitle { font-size: 11pt; color: #666; margin: 4pt 0 0; }
`;

export function composeExhibitHtml(items: ComposedItem[]): string {
  const sections = items.map((it, i) => `
    <section class="exhibit-item${i > 0 ? ' page-break' : ''}">
      <header class="exhibit-item-header">
        <h2>${escapeHtml(it.title)}</h2>
        ${it.subtitle ? `<p class="subtitle">${escapeHtml(it.subtitle)}</p>` : ''}
      </header>
      <div class="exhibit-item-body">${it.bodyHtml}</div>
    </section>
  `).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>Exhibit</title>
<style>${BASE_STYLES}${EXHIBIT_STYLES}</style>
</head><body>${sections}</body></html>`;
}
```

Step 4: Run test → PASS.

Step 5: Commit:
```bash
git add backend/src/modules/export/exhibit-composer.ts backend/src/modules/export/exhibit-composer.spec.ts
git commit -m "feat(export): exhibit HTML composer with page-break sections"
```

**Task 7: Extract `renderBody` variants for templates**

Files:
- Modify: `backend/src/modules/export/templates/report.ts`
- Modify: `backend/src/modules/export/templates/chronology.ts`
- Modify: `backend/src/modules/export/templates/chart.ts`
- Modify: `backend/src/modules/export/templates/graph.ts`
- Modify: `backend/src/modules/export/templates/styles.ts`

Each template currently returns a full HTML document with its own `<style>` block. The body-only variants must NOT lose those styles — `chronology.ts` in particular relies on `table-layout: fixed` and per-column widths that only exist inside its `<style>` block. Two options:

- **(A — chosen)** Extract per-type styles into named exports in `styles.ts` (e.g., `CHRONOLOGY_STYLES`, `CHART_STYLES`, `REPORT_STYLES`, `GRAPH_STYLES`), have each `render*Body` return ONLY the body HTML (no styles), and have the exhibit composer concatenate ALL per-type styles into its single `<style>` block. Bloats the exhibit doc by ~2KB; one CSS-in-head pass keeps Puppeteer happy.

Step 1: In `styles.ts`, add named exports for each per-template style block currently embedded inside the full-doc renderers.

Step 2: In each template file, refactor the full-doc renderer to consume the named export. Then add the body-only variant:

```ts
// graph.ts
export function renderGraphBody(name: string, imageDataUrl: string): string {
  // Composer is responsible for validation when items are added; skipping
  // re-validation here avoids double work in the exhibit path.
  // Image uses object-fit: contain inside a flex parent (exhibit composer
  // wraps in a sized container) so oversized graphs scale to fit the page.
  return `<h2>${escapeHtml(name)}</h2><img src="${imageDataUrl}" alt="${escapeHtml(name)}" class="exhibit-graph-img" />`;
}
```

In `exhibit-composer.ts` `EXHIBIT_STYLES`, add:

```css
.exhibit-graph-img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  display: block;
  margin: 12pt auto;
}
.exhibit-chart-img {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  display: block;
  margin: 12pt auto;
}
```

(Use the same `exhibit-chart-img` class in `renderChartBody`.)

Do the same for `renderReportBody`, `renderChronologyBody`, `renderChartBody`.

Step 3: In `exhibit-composer.ts`, import the per-type styles and concatenate them into the composer's `<style>` block alongside `EXHIBIT_STYLES`.

Step 4: Run `cd backend && npm test -- export` — existing tests must still pass. Also add an exhibit-composer test that asserts every per-type style class survives composition (e.g., expects `.chronology` and `.citation` rule strings in the composed HTML).

Run: `cd backend && npm test -- export` → existing tests must still pass; no new tests required (composer test covers composition).

Commit:
```bash
git add backend/src/modules/export/templates/
git commit -m "refactor(export): add body-only template variants for exhibit composition"
```

**Task 7.5: Wire `InvestigationsService` into `ExportModule`**

Files:
- Modify: `backend/src/modules/investigations/investigations.module.ts`
- Modify: `backend/src/modules/export/export.module.ts`

`InvestigationsService` is not currently exported from its module (verified — `investigations.module.ts:19-20` has no `exports:` field). `ExportModule` cannot inject it without these two edits.

Step 1: Add `exports: [InvestigationsService]` to `InvestigationsModule`.

Step 2: Add `InvestigationsModule` to the `imports:` array of `ExportModule`.

Step 3: Run `cd backend && npm run build` → expect no DI errors.

**Task 8: Wire `POST /exports/exhibit` endpoint**

Files:
- Modify: `backend/src/modules/export/export.controller.ts`

Add the endpoint:

```ts
import { ExportExhibitDto } from './exhibit.dto';
import { composeExhibitHtml } from './exhibit-composer';
import { renderReportBody } from './templates/report';
import { renderChronologyBody } from './templates/chronology';
import { renderChartBody } from './templates/chart';
import { renderGraphBody } from './templates/graph';
import { InvestigationsService } from '../investigations/investigations.service';

// In constructor, also inject investigationsService.

@Post('exhibit')
async exportExhibit(@Body() body: ExportExhibitDto, @Req() req: any, @Res() res: Response) {
  const userId = this.getUserId(req);

  const composedItems = [] as { title: string; subtitle?: string; bodyHtml: string }[];

  for (const item of body.items) {
    let bodyHtml: string;
    if (item.refType === 'production') {
      const p = await this.productionsService.findOne(item.refId, { kind: 'user', userId });
      const data = p.data as any;
      switch (p.type) {
        case 'report':      bodyHtml = renderReportBody(data); break;
        case 'chronology':  bodyHtml = renderChronologyBody(data); break;
        case 'chart':
          if (!item.imageDataUrl) throw new BadRequestException(`Chart item "${p.name}" missing imageDataUrl`);
          validateDataUrl(item.imageDataUrl);
          bodyHtml = renderChartBody(p.name, item.imageDataUrl); break;
        default: throw new BadRequestException(`Unsupported production type: ${p.type}`);
      }
    } else {
      // investigation
      if (!item.imageDataUrl) throw new BadRequestException(`Investigation item missing imageDataUrl`);
      validateDataUrl(item.imageDataUrl);
      // NOTE: InvestigationsService.findOne takes an AccessPrincipal discriminated union,
      // not a bare {userId} object. Match the productions-service call above.
      const inv = await this.investigationsService.findOne(item.refId, { kind: 'user', userId });
      bodyHtml = renderGraphBody(inv.name, item.imageDataUrl);
    }
    composedItems.push({ title: item.title, subtitle: item.subtitle, bodyHtml });
  }

  const html = composeExhibitHtml(composedItems);
  const pdf = await this.exportService.htmlToPdf(html, { landscape: false });
  const safeName = (body.filename || 'exhibit').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'exhibit';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
  res.send(pdf);
}
```

(Reminder: Task 7.5 must run first — `InvestigationsService` has to be exported and imported. Once that's done, the call above type-checks.)

Run: `cd backend && npm test` → all existing tests still pass.

Commit:
```bash
git add backend/src/modules/export/
git commit -m "feat(export): POST /exports/exhibit composes multi-item PDF"
```

**Task 9: Update contracts**

Files:
- Modify: `contracts/paths/export.yaml`

Replace the file with:

```yaml
/exports/productions/{id}:
  post:
    summary: Export a production as PDF, PNG, or DOCX
    operationId: exportProduction
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: string, format: uuid }
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required: [format]
            properties:
              format:
                type: string
                enum: [pdf, png, docx]
              filename:
                type: string
                description: User-supplied filename stem (no extension)
              imageDataUrl:
                type: string
                description: PNG data URL (required for chart PDF export)
    responses:
      '200':
        description: Exported file
        content:
          application/pdf: { schema: { type: string, format: binary } }
          image/png: { schema: { type: string, format: binary } }
          application/vnd.openxmlformats-officedocument.wordprocessingml.document:
            schema: { type: string, format: binary }

/exports/graph:
  post:
    summary: Export a graph snapshot as PDF
    operationId: exportGraph
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required: [name, imageDataUrl]
            properties:
              name: { type: string }
              filename: { type: string }
              imageDataUrl: { type: string }
    responses:
      '200':
        description: PDF file
        content:
          application/pdf: { schema: { type: string, format: binary } }

/exports/exhibit:
  post:
    summary: Compose multiple investigations and productions into a single exhibit PDF
    operationId: exportExhibit
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required: [filename, items]
            properties:
              filename: { type: string }
              items:
                type: array
                items:
                  type: object
                  required: [refType, refId, title]
                  properties:
                    refType: { type: string, enum: [production, investigation] }
                    refId:   { type: string, format: uuid }
                    title:   { type: string }
                    subtitle: { type: string }
                    imageDataUrl: { type: string }
    responses:
      '200':
        description: PDF file
        content:
          application/pdf: { schema: { type: string, format: binary } }
```

Confirm `contracts/openapi.yaml` already pulls in this paths file via `$ref` or similar; if it routes individual operations, add the new `/exports/exhibit` ref.

Run from repo root: `npm run gen`.
Expected: regenerated `backend/src/generated/api-types.ts` and `frontend/src/generated/api-types.ts` reflect the new schema. Run `cd backend && npm run build && cd ..` and `cd frontend && npx tsc --noEmit && cd ..` to confirm.

Commit:
```bash
git add contracts/ backend/src/generated/ frontend/src/generated/
git commit -m "contracts: export formats (pdf/png/docx), add /exports/exhibit"
```

---

### Phase 2 — Frontend ExportModal refactor

**Task 10: Refactor `ExportModal.tsx` to new API**

Files:
- Modify: `frontend/src/components/ExportModal.tsx`

Rewrite the component:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { FaImage, FaFilePdf, FaFileWord, FaSpinner } from 'react-icons/fa6';

export type ExportKind = 'graph' | 'chart' | 'chronology' | 'report' | 'exhibit';
export type ExportFormat = 'pdf' | 'png' | 'docx';

const FORMATS_BY_KIND: Record<ExportKind, ExportFormat[]> = {
  graph:      ['pdf', 'png'],
  chart:      ['pdf', 'png'],
  chronology: ['pdf', 'png'],
  report:     ['pdf', 'docx'],
  exhibit:    ['pdf'],
};

const FORMAT_LABELS: Record<ExportFormat, { label: string; desc: string; icon: React.ReactNode }> = {
  pdf:  { label: 'PDF',   desc: 'Best for printing',          icon: <FaFilePdf size={22} /> },
  png:  { label: 'PNG',   desc: 'Best for embedding/sharing', icon: <FaImage   size={22} /> },
  docx: { label: 'Word',  desc: 'Editable in Microsoft Word', icon: <FaFileWord size={22} /> },
};

function sanitize(stem: string): string {
  return (stem || '').replace(/[^a-z0-9_-]/gi, '_').toLowerCase().slice(0, 80) || 'export';
}

interface Props {
  open: boolean;
  onClose: () => void;
  kind: ExportKind;
  defaultFilename: string;
  onExport: (format: ExportFormat, filename: string) => Promise<void>;
}

export function ExportModal({ open, onClose, kind, defaultFilename, onExport }: Props) {
  const formats = FORMATS_BY_KIND[kind];
  const [format, setFormat] = useState<ExportFormat>(formats[0]);
  const [stem, setStem]     = useState(sanitize(defaultFilename));
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormat(formats[0]);
      setStem(sanitize(defaultFilename));
      setError(null);
      setBusy(false);
    }
  }, [open, kind, defaultFilename]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onExport(format, sanitize(stem));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const title = `Export ${kind === 'exhibit' ? 'Exhibit' : kind.charAt(0).toUpperCase() + kind.slice(1)}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bg-surface-panel rounded-lg p-6 w-[460px]">
        <h3 className="text-sm font-semibold text-ink-muted uppercase mb-5">{title}</h3>

        <label className="block text-xs text-ink-muted mb-1">Filename</label>
        <div className="flex items-stretch mb-5 border border-line-strong rounded overflow-hidden">
          <input
            value={stem}
            onChange={(e) => setStem(e.target.value)}
            className="flex-1 px-3 py-2 bg-surface text-ink text-sm outline-none"
            disabled={busy}
            spellCheck={false}
          />
          <span className="px-3 py-2 bg-surface-raised text-ink-muted text-sm border-l border-line-strong">
            .{format}
          </span>
        </div>

        <label className="block text-xs text-ink-muted mb-2">Format</label>
        <div className="flex gap-3 mb-4">
          {formats.map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              disabled={busy}
              className={`flex-1 flex flex-col items-center gap-1.5 px-3 py-4 rounded-lg transition-colors ${
                format === f ? 'bg-brand text-white' : 'bg-surface-raised hover:bg-surface-raised/80 text-ink-muted'
              }`}
            >
              {FORMAT_LABELS[f].icon}
              <span className="text-sm font-semibold">{FORMAT_LABELS[f].label}</span>
              <span className={`text-[10px] ${format === f ? 'text-white/80' : 'text-ink-faint'} text-center leading-snug`}>
                {FORMAT_LABELS[f].desc}
              </span>
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded bg-red-900/40 border border-red-800/60 text-red-200 text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
                  className="px-3 h-8 text-sm text-ink-muted hover:text-ink disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !stem.trim()}
                  className="px-4 h-8 rounded bg-brand hover:bg-brand/90 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60">
            {busy ? <><FaSpinner className="animate-spin" /> Exporting…</> : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Commit:
```bash
git add frontend/src/components/ExportModal.tsx
git commit -m "feat(export-modal): unified API with filename input + dynamic formats"
```

**Task 11: Update `api-client.ts` export signatures**

Files:
- Modify: `frontend/src/lib/api-client.ts`

Replace the existing `exportProduction` and `exportGraph`:

```ts
exportProduction: (id: string, format: 'pdf' | 'png' | 'docx', filename: string, imageDataUrl?: string) => {
  const safeStem = filename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'export';
  return downloadFile(`/exports/productions/${id}`, `${safeStem}.${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, filename: safeStem, imageDataUrl }),
  });
},
exportGraph: (name: string, filename: string, imageDataUrl: string) => {
  const safeStem = filename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'graph';
  return downloadFile('/exports/graph', `${safeStem}.pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, filename: safeStem, imageDataUrl }),
  });
},
exportExhibit: (filename: string, items: Array<{
  refType: 'production' | 'investigation';
  refId: string;
  title: string;
  subtitle?: string;
  imageDataUrl?: string;
}>) => {
  const safeStem = filename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'exhibit';
  return downloadFile('/exports/exhibit', `${safeStem}.pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: safeStem, items }),
  });
},
```

Run: `cd frontend && npx tsc --noEmit` — expect type errors at the (yet-unmigrated) callsites.

Commit:
```bash
git add frontend/src/lib/api-client.ts
git commit -m "feat(api-client): export signatures take filename; add exportExhibit"
```

**Task 12: Update `GraphCanvas.exportImage` to forward filename + fix return type**

Files:
- Modify: `frontend/src/hooks/useCytoscape.ts` (lines 151-225)
- Modify: `frontend/src/components/GraphCanvas.tsx` (line 7)

Step 1: Change the PDF branch in `useCytoscape.ts`:

```ts
} else {
  try {
    await apiClient.exportGraph(filename, filename, dataUrl);
  } catch (err) {
    alert(`PDF export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}
```

(`name` and `filename` are both `filename` here — backend uses `name` for display, `filename` for Content-Disposition.)

Step 2: Fix the handle type. `GraphCanvas.tsx:7` currently declares `exportImage: (...) => void`, but the underlying function IS async. The unified ExportModal `await`s the parent's `onExport`; with `void` return, TS won't error but the modal closes before the export finishes and errors are swallowed.

```ts
// GraphCanvas.tsx
export interface GraphCanvasHandle {
  unselectAll: () => void;
  exportImage: (format: 'png' | 'pdf', filename?: string) => Promise<void>;
  setEdgeArc: (edgeId: string, delta: number | null) => void;
}
```

The `useImperativeHandle` call passes the function reference directly so no other change is needed.

Commit:
```bash
git add frontend/src/hooks/useCytoscape.ts
git commit -m "fix(graph): forward filename to backend on PDF export"
```

**Task 13: Migrate `ProductionViewer.tsx` to new modal**

Files:
- Modify: `frontend/src/components/ProductionViewer.tsx`

Replace the entire header action region and the export handlers. Single Export button regardless of type; modal handles everything:

```tsx
// Drop: exportError, exportingFormat, exportModalOpen → replace with one boolean
const [exportOpen, setExportOpen] = useState(false);

const handleExport = useCallback(
  async (format: ExportFormat, filename: string) => {
    if (production.type === 'chart' && format === 'png') {
      const canvas = contentRef.current?.querySelector<HTMLCanvasElement>('canvas');
      if (!canvas) throw new Error('Chart canvas not found');
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${filename}.png`;
      a.click();
      return;
    }
    let imageDataUrl: string | undefined;
    if (production.type === 'chart' && format === 'pdf') {
      const canvas = contentRef.current?.querySelector<HTMLCanvasElement>('canvas');
      if (!canvas) throw new Error('Chart canvas not found');
      imageDataUrl = canvas.toDataURL('image/png');
    }
    await apiClient.exportProduction(production.id, format, filename, imageDataUrl);
  },
  [production.id, production.type],
);
```

Header actions become:

```tsx
<button onClick={handleRefresh} ...>...</button>
<button
  onClick={() => setExportOpen(true)}
  disabled={refreshing}
  className="..."
>
  <FaDownload className="w-3 h-3" /> Export
</button>
{production.type === 'report' && <button onClick={() => setEditing(!editing)} ...>...</button>}
```

Modal at the bottom:

```tsx
<ExportModal
  open={exportOpen}
  onClose={() => setExportOpen(false)}
  kind={production.type as 'chart' | 'report' | 'chronology'}
  defaultFilename={production.name}
  onExport={handleExport}
/>
```

Remove the `exportError` banner — modal owns errors now.

Run: `cd frontend && npx tsc --noEmit` → clean.

Commit:
```bash
git add frontend/src/components/ProductionViewer.tsx
git commit -m "feat(production-viewer): single Export button, unified modal"
```

**Task 14: Migrate Investigations page to new modal API**

Files:
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

Update the `<ExportModal>` usage near the bottom of the file:

```tsx
<ExportModal
  open={exportModalOpen}
  onClose={() => setExportModalOpen(false)}
  kind="graph"
  defaultFilename={investigation?.name ?? 'graph'}
  onExport={async (format, filename) => {
    if (format === 'png' || format === 'pdf') {
      await graphRef.current?.exportImage(format, filename);
    }
  }}
/>
```

The `exportImage` ref method needs to return `Promise<void>` for the modal to await it. Check `GraphCanvasHandle.exportImage` type and update if it currently returns `void` but the underlying call is async.

Run: `cd frontend && npx tsc --noEmit` → clean.

Commit:
```bash
git add frontend/src/app/cases/[caseId]/investigations/page.tsx frontend/src/components/GraphCanvas.tsx
git commit -m "feat(investigations): use unified ExportModal for graph export"
```

**Task 15: Smoke test the entire format matrix**

Run dev servers: `npm run db && npm run be & npm run fe` (or whichever pattern the user uses).

Manually verify:
1. Graph PDF (investigations page)
2. Graph PNG (investigations page)
3. Chart PDF (production viewer)
4. Chart PNG (production viewer)
5. Report PDF (production viewer)
6. Report DOCX (production viewer — opens in Word/Pages)
7. Chronology PDF (production viewer)
8. Chronology PNG (production viewer)

Each should produce a file with the user-specified filename. Modal should show inline error if the backend rejects.

No commit — this is a verification step. If anything fails, fix and commit the fix.

---

### Phase 3 — Exhibit feature

**Task 16: Hidden GraphCanvas snapshot hook**

Files:
- Create: `frontend/src/hooks/useGraphSnapshot.ts`

> **Why this is the riskiest task in the plan.** `GraphCanvas` requires a full `Investigation` object (verified at `frontend/src/components/GraphCanvas.tsx:11-16`) — not a bare `traces` array. The Cytoscape instance uses a `preset` layout (no `layoutstop` event) and runs an initial `cy.fit()` on a 100ms timer (`useCytoscape.ts:137-142`). A naïve `setTimeout(..., 600)` will frequently capture an empty or unfit canvas. The hook below uses `requestAnimationFrame` to wait for elements to materialize, then explicitly fits before snapshotting.

```tsx
'use client';
import { useCallback, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { createElement } from 'react';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/GraphCanvas';
import type { Investigation } from '@/types/investigation';

/**
 * Capture a PNG snapshot of a Cytoscape graph by mounting <GraphCanvas> into
 * a hidden off-screen container. Returns a data URL on success.
 *
 * Container is fixed off-screen at 1400x900 — large enough that layout has
 * room to breathe; never painted to the visible viewport.
 */
export function useGraphSnapshot() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);

  const snapshot = useCallback(async (investigation: Investigation): Promise<string> => {
    if (!containerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:-10000px;top:0;width:1400px;height:900px;pointer-events:none;';
      document.body.appendChild(el);
      containerRef.current = el;
      rootRef.current = createRoot(el);
    }

    return new Promise<string>((resolve, reject) => {
      const handleRef = { current: null as GraphCanvasHandle | null };
      let raf = 0;
      const timeoutAt = performance.now() + 4_000; // hard cap

      const tryCapture = async () => {
        if (!handleRef.current) {
          raf = requestAnimationFrame(tryCapture);
          return;
        }
        // exportPngDataUrl (Task 17) reads cy.elements() internally; we need
        // to ensure they're loaded. Poll for non-empty elements by sniffing
        // the container — when Cytoscape has rendered, the inner <canvas>
        // exists with non-zero dimensions.
        const cnv = containerRef.current?.querySelector('canvas');
        if (!cnv || cnv.width === 0) {
          if (performance.now() > timeoutAt) {
            reject(new Error('Graph snapshot timed out — canvas not ready'));
            return;
          }
          raf = requestAnimationFrame(tryCapture);
          return;
        }
        try {
          const dataUrl = await handleRef.current.exportPngDataUrl();
          if (!dataUrl) reject(new Error('Snapshot failed: empty data URL'));
          else resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };

      rootRef.current!.render(
        createElement(GraphCanvas, {
          ref: (h: GraphCanvasHandle | null) => { handleRef.current = h; },
          investigation,
          selectedNodeIds: [],
          selectedEdgeIds: [],
          callbacks: {} as any, // CytoscapeCallbacks is a bag of optional handlers;
                                // empty object is fine for a snapshot-only mount.
        }),
      );

      raf = requestAnimationFrame(tryCapture);
      // Caller must call dispose() to clean up.
      void raf;
    });
  }, []);

  const dispose = useCallback(() => {
    if (rootRef.current) {
      rootRef.current.unmount();
      rootRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.remove();
      containerRef.current = null;
    }
  }, []);

  return { snapshot, dispose };
}
```

Commit:
```bash
git add frontend/src/hooks/useGraphSnapshot.ts
git commit -m "feat(exhibit): useGraphSnapshot hook — hidden Cytoscape capture"
```

**Task 16.5: `useChartSnapshot` hook**

Files:
- Create: `frontend/src/hooks/useChartSnapshot.ts`

Mirror `useGraphSnapshot` but for `<ChartViewer>`. Mounts ChartViewer in a hidden off-screen container, polls for canvas readiness, returns the `toDataURL('image/png')` of the rendered chart.

```tsx
'use client';
import { useCallback, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { createElement } from 'react';
import { ChartViewer } from '@/components/ChartViewer';

export function useChartSnapshot() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);

  const snapshot = useCallback(async (chartData: any): Promise<string> => {
    if (!containerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:600px;pointer-events:none;';
      document.body.appendChild(el);
      containerRef.current = el;
      rootRef.current = createRoot(el);
    }
    return new Promise<string>((resolve, reject) => {
      let raf = 0;
      const timeoutAt = performance.now() + 4_000;
      const tryCapture = () => {
        const canvas = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
        if (!canvas || canvas.width === 0) {
          if (performance.now() > timeoutAt) {
            reject(new Error('Chart snapshot timed out — canvas not ready'));
            return;
          }
          raf = requestAnimationFrame(tryCapture);
          return;
        }
        try {
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
      };
      rootRef.current!.render(createElement(ChartViewer, { data: chartData }));
      raf = requestAnimationFrame(tryCapture);
      void raf;
    });
  }, []);

  const dispose = useCallback(() => {
    if (rootRef.current) { rootRef.current.unmount(); rootRef.current = null; }
    if (containerRef.current) { containerRef.current.remove(); containerRef.current = null; }
  }, []);

  return { snapshot, dispose };
}
```

**Task 17: Add `exportPngDataUrl()` to GraphCanvas handle**

Files:
- Modify: `frontend/src/hooks/useCytoscape.ts`
- Modify: `frontend/src/components/GraphCanvas.tsx`

> Task 12 already updated `exportImage`'s typed return to `Promise<void>`. This task adds a SECOND ref method that returns the data URL directly (no download, no API call) so the snapshot loop can capture without side effects.

In `useCytoscape.ts`, refactor `exportImage` to expose a pure-snapshot variant. Pull the data-URL-producing core out:

```ts
const exportPngDataUrl = useCallback(async (): Promise<string> => {
  const cy = cyRef.current;
  if (!cy) throw new Error('Cytoscape not initialized');
  // ... existing label-merging batch (lines 162-193) ...
  let dataUrl: string;
  try {
    dataUrl = cy.png({ full: true, scale: 2, bg: '#ffffff' });
  } finally {
    // ... existing restore batch (lines 199-210) ...
  }
  return dataUrl;
}, []);
```

Have `exportImage` call `exportPngDataUrl()` internally instead of duplicating the logic. Return type of `exportImage` becomes `Promise<void>`.

Update `GraphCanvasHandle`:

```ts
export interface GraphCanvasHandle {
  unselectAll: () => void;
  exportImage: (format: 'png' | 'pdf', filename?: string) => Promise<void>;
  exportPngDataUrl: () => Promise<string>;
  setEdgeArc: (edgeId: string, delta: number | null) => void;
}
```

And the `useImperativeHandle` registration in `GraphCanvas.tsx:27`.

Commit:
```bash
git add frontend/src/hooks/useCytoscape.ts frontend/src/components/GraphCanvas.tsx
git commit -m "feat(graph): expose exportPngDataUrl for headless snapshots"
```

**Task 18: ExhibitBuilder component**

Files:
- Create: `frontend/src/components/ExhibitBuilder.tsx`

Skeleton with two-pane layout, candidate list, composition list with drag handles, per-item title/subtitle inputs, and an Export button that wires to `<ExportModal kind="exhibit">`.

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { FaPlus, FaXmark, FaGripVertical } from 'react-icons/fa6';
import { apiClient, type Investigation, type Production } from '@/lib/api-client';
import { useCaseContext } from '@/contexts/CaseContext';
import { ExportModal } from './ExportModal';
import { useGraphSnapshot } from '@/hooks/useGraphSnapshot';
import { useChartSnapshot } from '@/hooks/useChartSnapshot';

type ItemRef = {
  refType: 'production' | 'investigation';
  refId: string;
  title: string;
  subtitle?: string;
  // Captured at export time
  imageDataUrl?: string;
  // Cached for the picker
  _displayType: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  caseId: string;
  caseName: string;
}

export function ExhibitBuilder({ open, onClose, caseId, caseName }: Props) {
  const { productions } = useCaseContext(); // already populated case-wide
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [composition, setComposition] = useState<ItemRef[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const { snapshot: graphSnapshot, dispose: disposeGraph } = useGraphSnapshot();
  const { snapshot: chartSnapshot, dispose: disposeChart } = useChartSnapshot();

  useEffect(() => () => { disposeGraph(); disposeChart(); }, [disposeGraph, disposeChart]);

  useEffect(() => {
    if (!open) return;
    // Only investigations need a fresh fetch (CaseContext doesn't hold them
    // in a useful shape for this builder). Productions come from context.
    apiClient.getCase(caseId).then((c) => {
      setInvestigations(c.investigations || []);
    });
  }, [open, caseId]);

  const isAdded = (refType: ItemRef['refType'], refId: string) =>
    composition.some((c) => c.refType === refType && c.refId === refId);

  const add = (item: Omit<ItemRef, 'subtitle' | 'imageDataUrl'>) => {
    if (isAdded(item.refType, item.refId)) return;
    setComposition((prev) => [...prev, item]);
  };

  const remove = (idx: number) => setComposition((p) => p.filter((_, i) => i !== idx));

  const move = (from: number, to: number) => {
    setComposition((p) => {
      const next = p.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleExport = async (_format: 'pdf' | 'png' | 'docx', filename: string) => {
    // Capture snapshots for investigation items in order.
    //
    // NOTE: apiClient.getCase() loads the case with `relations: ['investigations']`
    // — one level only, no nested `traces`. We MUST re-fetch each referenced
    // investigation individually via apiClient.getInvestigation(id), whose
    // service loads `relations: ['traces']` (investigations.service.ts:38-41).
    const finalItems = [] as ItemRef[];
    for (const it of composition) {
      if (it.imageDataUrl) {
        finalItems.push(it);
        continue;
      }
      if (it.refType === 'investigation') {
        const inv = await apiClient.getInvestigation(it.refId); // full traces relation
        if (!inv) throw new Error(`Investigation ${it.refId} not found`);
        const dataUrl = await graphSnapshot(inv);
        finalItems.push({ ...it, imageDataUrl: dataUrl });
      } else {
        // Production item — only charts need a captured image. Reports and
        // chronologies render server-side from stored data, no snapshot.
        const prod = productions.find((p) => p.id === it.refId);
        if (prod?.type === 'chart') {
          const dataUrl = await chartSnapshot((prod as any).data);
          finalItems.push({ ...it, imageDataUrl: dataUrl });
        } else {
          finalItems.push(it);
        }
      }
    }
    await apiClient.exportExhibit(
      filename,
      finalItems.map((it) => ({
        refType: it.refType,
        refId: it.refId,
        title: it.title,
        subtitle: it.subtitle,
        imageDataUrl: it.imageDataUrl,
      })),
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
      <div className="bg-surface-panel border border-line-strong rounded-lg shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col">
        <header className="px-5 py-3 border-b border-line-strong flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Create Exhibit</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><FaXmark /></button>
        </header>

        <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden">
          {/* Picker */}
          <div className="border border-line-strong rounded p-3 overflow-y-auto">
            <h3 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Investigations</h3>
            {investigations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between py-1 text-sm">
                <span className="text-ink">{inv.name}</span>
                <button
                  onClick={() => add({ refType: 'investigation', refId: inv.id, title: inv.name, _displayType: 'Investigation' })}
                  disabled={isAdded('investigation', inv.id)}
                  className="text-xs px-2 py-0.5 rounded bg-brand/20 text-brand hover:bg-brand/30 disabled:opacity-40"
                >
                  <FaPlus className="inline w-2.5 h-2.5" /> Add
                </button>
              </div>
            ))}

            <h3 className="text-xs uppercase tracking-wider text-ink-muted mt-4 mb-2">Productions</h3>
            {productions.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                <span className="text-ink">{p.name} <span className="text-ink-faint text-[10px] uppercase">{p.type}</span></span>
                <button
                  onClick={() => add({ refType: 'production', refId: p.id, title: p.name, _displayType: p.type })}
                  disabled={isAdded('production', p.id)}
                  className="text-xs px-2 py-0.5 rounded bg-brand/20 text-brand hover:bg-brand/30 disabled:opacity-40"
                >
                  <FaPlus className="inline w-2.5 h-2.5" /> Add
                </button>
              </div>
            ))}
          </div>

          {/* Composition */}
          <div className="border border-line-strong rounded p-3 overflow-y-auto">
            {composition.length === 0 && (
              <p className="text-ink-faint text-sm text-center mt-8">Add items from the left to build the exhibit.</p>
            )}
            {composition.map((it, i) => (
              <div
                key={`${it.refType}-${it.refId}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                  if (!Number.isNaN(from) && from !== i) move(from, i);
                }}
                className="border border-line-strong rounded mb-2 p-2 bg-surface text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <FaGripVertical className="text-ink-faint cursor-grab" />
                  <span className="text-ink-faint text-xs">#{i + 1}</span>
                  <span className="text-ink-muted text-[10px] uppercase ml-auto">{it._displayType}</span>
                  <button onClick={() => remove(i)} className="text-ink-faint hover:text-red-400"><FaXmark /></button>
                </div>
                <input
                  value={it.title}
                  onChange={(e) => setComposition((p) => p.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))}
                  placeholder="Title"
                  className="w-full bg-transparent text-ink text-sm outline-none border-b border-line-strong/40 mb-1 py-0.5"
                />
                <input
                  value={it.subtitle ?? ''}
                  onChange={(e) => setComposition((p) => p.map((x, idx) => idx === i ? { ...x, subtitle: e.target.value } : x))}
                  placeholder="Subtitle (optional)"
                  className="w-full bg-transparent text-ink-muted text-xs outline-none py-0.5"
                />
              </div>
            ))}
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-line-strong flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Cancel</button>
          <button
            onClick={() => setExportOpen(true)}
            disabled={composition.length === 0}
            className="px-3 h-8 rounded bg-brand hover:bg-brand/90 text-white text-sm font-medium disabled:opacity-50"
          >
            Export PDF
          </button>
        </footer>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        kind="exhibit"
        defaultFilename={`${caseName}_exhibit`}
        onExport={handleExport}
      />
    </div>
  );
}
```

Commit:
```bash
git add frontend/src/components/ExhibitBuilder.tsx
git commit -m "feat(exhibit): builder modal — picker, composition list, export wiring"
```

**Task 19: Wire "Create Exhibit" button into sidebar**

Files:
- Modify: `frontend/src/components/InvestigationsSidebar.tsx`

Near the case-name header in the sidebar (around line 80-100 region — verify locally), add:

```tsx
const [exhibitOpen, setExhibitOpen] = useState(false);

// ...
<div className="flex items-center justify-between px-3 py-2 border-b border-line-strong">
  <span className="truncate font-semibold text-ink text-sm">{caseName}</span>
  <button
    onClick={() => setExhibitOpen(true)}
    title="Create exhibit from investigations and productions"
    className="text-xs text-ink-muted hover:text-ink whitespace-nowrap"
  >
    + Exhibit
  </button>
</div>

// At end of the component tree
{exhibitOpen && (
  <ExhibitBuilder
    open={exhibitOpen}
    onClose={() => setExhibitOpen(false)}
    caseId={caseId}
    caseName={caseName}
  />
)}
```

Run: `cd frontend && npx tsc --noEmit` → clean.

Commit:
```bash
git add frontend/src/components/InvestigationsSidebar.tsx
git commit -m "feat(exhibit): + Exhibit entry point in case sidebar"
```

**Task 20: End-to-end exhibit smoke test**

In the dev environment:
1. Open a case with at least one investigation (with some nodes/edges) and at least one of each production type (report, chart, chronology).
2. Click "+ Exhibit" → builder opens.
3. Add 1 investigation + 1 chart + 1 report + 1 chronology, in that order.
4. Reorder by dragging item #4 to position 2.
5. Edit titles and subtitles inline.
6. Click "Export PDF" → ExportModal appears with default filename.
7. Click Export.
8. Verify the downloaded PDF: 4 pages, each item has its banner header (title + subtitle), investigation graph renders correctly (snapshots fired), no page-break inside an item.

If anything fails, fix it. Per project policy, do NOT commit — leave the fix in the working tree for user review.

---

### Phase 4 — Final cleanup

**Task 21: Run `git status` — leave for user to review**

Per project CLAUDE.md, do NOT push or open a PR. Do NOT commit. Just verify the working tree reflects only this plan's intended changes and report to the user.

---

## Notes on TDD coverage

- **Backend service methods** (`htmlToPng`, `htmlToDocx`): tested directly. Puppeteer-dependent tests gate on `chromeAvailable` (existing pattern).
- **Composer** (`composeExhibitHtml`): pure function, fully unit-testable.
- **Controller branches**: covered via integration in Phase 2 Task 15 smoke matrix. Adding e2e tests for every format permutation is overkill given the existing service+composer coverage; revisit if regressions appear.
- **Frontend modal**: visual + behavioral. Smoke test in Task 15 covers the matrix.
- **Exhibit flow**: Task 20 end-to-end smoke. Adding a Jest test for `ExhibitBuilder` requires mocking Cytoscape and react-dom/client — high effort, low durability; skip unless it becomes a regression hotspot.

## Rollback considerations

- Each phase commits independently, so any phase can be reverted via `git revert <hash>` without affecting earlier phases.
- The `html-to-docx` dependency is the only new third-party code on the backend. If it causes problems in prod, fall back by removing the `docx` branch from the controller — PDF still works.
- Hidden Cytoscape mounting (`useGraphSnapshot`) is the highest-risk new piece. If snapshots prove unreliable in practice (timeouts, empty captures), the fallback is to surface a clear error in the builder rather than a silent empty snapshot. **Do not** mitigate by requiring the user to navigate to each investigation manually — that defeats the whole feature.
