# Export & Citations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PDF/HTML export for all production types (reports, chronologies, charts) and graph snapshots, plus a citation system for reports that references external sources — with a "Works Cited" appendix auto-generated on export.

**Architecture:** Server-side PDF generation via Puppeteer (headless Chrome) on the NestJS backend. Each production type gets an HTML template that renders a print-ready document. Report HTML is sanitized server-side before rendering (defense in depth against XSS via TipTap content). Citations use DOM parsing (cheerio) to extract data attributes — no regex. Citation numbering is authoritative at export time (inline `[N]` text is rewritten, not trusted). Chart/graph export: frontend sends PNG data URL in the request body (POST), not stored in the production.

**Tech Stack:** `puppeteer-core` + system Chromium (prod-ready from day 1), `isomorphic-dompurify` (HTML sanitization), `cheerio` (DOM parsing for citations), existing TipTap/Chart.js/Cytoscape on frontend.

**Security model:**
- Report content is user-supplied HTML from TipTap. Before Puppeteer renders it: (1) sanitize with DOMPurify (allow-list of safe tags/attributes), (2) disable JavaScript in the Puppeteer page (`page.setJavaScriptEnabled(false)`), (3) block network requests (`page.setRequestInterception(true)`). Defense in depth — all three.
- Export endpoints require authentication. `ProductionsService.findOne(id, userId)` requires `userId` to be defined — the controller passes `req.user.id` (not `req.user?.id`). The global `AuthGuard` guarantees `req.user` exists.
- Data URL payloads (chart/graph) are validated: must start with `data:image/png;base64,` and be under 10MB.

**Deferred:**
- Internal trace/edge citation references (external URLs only for now)
- Page numbers / "Confidential" footers in PDF (`headerTemplate`/`footerTemplate` — add later)
- Audit logging of exports

---

## Atomized Changes

| # | File(s) | Action | Purpose |
|---|---------|--------|---------|
| 1 | `backend/package.json` | Modify | Install `puppeteer-core`, `isomorphic-dompurify`, `cheerio`, `@sparticuz/chromium` |
| 2 | `backend/src/modules/export/export.service.ts` | Create | HTML→PDF via Puppeteer with JS disabled, network blocked, 30s timeout |
| 3 | `backend/src/modules/export/templates/util.ts` | Create | Shared `escapeHtml`, `sanitizeHtml`, `validateDataUrl` helpers |
| 4 | `backend/src/modules/export/templates/report.ts` | Create | Report template with DOMPurify sanitization + cheerio-based citation extraction + Works Cited |
| 5 | `backend/src/modules/export/templates/chronology.ts` | Create | Chronology table template — strips internal IDs |
| 6 | `backend/src/modules/export/templates/chart.ts`, `graph.ts` | Create | Image wrapper templates for chart/graph PNG data URLs |
| 7 | `backend/src/modules/export/templates/styles.ts` | Create | Shared print-optimized CSS |
| 8 | `backend/src/modules/export/export.controller.ts` | Create | `POST /exports/productions/:id` (PDF/HTML) + `POST /exports/graph` (PDF from PNG) |
| 9 | `backend/src/modules/export/export.module.ts`, `app.module.ts` | Create + Modify | Wire ExportModule |
| 10 | `contracts/paths/export.yaml`, `contracts/openapi.yaml` | Create + Modify | OpenAPI spec for export endpoints |
| 11 | `frontend/src/lib/api-client.ts` | Modify | Add `downloadFile` helper + `exportProduction` / `exportGraph` methods |
| 12 | `frontend/src/components/ProductionViewer.tsx` | Modify | Export PDF/HTML buttons; chart export sends canvas PNG in request body |
| 13 | `frontend/src/hooks/useCytoscape.ts` | Modify | Replace print-dialog PDF with `apiClient.exportGraph()` |
| 14 | `frontend/src/components/CitationPicker.tsx` | Create | Modal for inserting external URL citations into reports |
| 15 | `frontend/src/components/ReportEditor.tsx` | Modify | Citation toolbar button + inline citation styling |
| 16 | `backend/src/modules/export/export.service.spec.ts`, `templates/report.spec.ts` | Create | Tests for PDF generation, HTML sanitization, citation extraction, Works Cited output |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `backend/package.json`

**Step 1: Install**

```bash
cd backend && npm install puppeteer-core @sparticuz/chromium isomorphic-dompurify cheerio && npm install --save-dev @types/dompurify
```

`puppeteer-core` + `@sparticuz/chromium`: no bundled Chromium binary. `@sparticuz/chromium` provides a Lambda/Cloud Run-compatible Chromium path. Works in dev (falls back to system Chrome) and prod (uses the bundled binary). No 280MB image bloat.

`isomorphic-dompurify`: HTML sanitization. `cheerio`: DOM parsing for citation extraction.

**Step 2: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "feat: add puppeteer-core, chromium, dompurify, cheerio for PDF export"
```

---

### Task 2: Export Service

**Files:**
- Create: `backend/src/modules/export/export.service.ts`

**Step 1: Create the service**

```typescript
// backend/src/modules/export/export.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer-core';

@Injectable()
export class ExportService implements OnModuleDestroy {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.connected) {
      let executablePath: string;
      try {
        const chromium = await import('@sparticuz/chromium');
        executablePath = await chromium.default.executablePath();
      } catch {
        // Fallback for dev: use system Chrome
        const paths = [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium-browser',
        ];
        executablePath = paths.find((p) => {
          try { require('fs').accessSync(p); return true; } catch { return false; }
        }) || 'google-chrome';
      }

      this.browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
      });
    }
    return this.browser;
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async htmlToPdf(html: string, options?: { landscape?: boolean; timeout?: number }): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    const timeout = options?.timeout ?? 30_000;

    try {
      // Defense in depth: disable JS and block network
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        // Allow data: URLs (for embedded images) but block everything else
        if (req.url().startsWith('data:')) {
          req.continue();
        } else {
          req.abort();
        }
      });

      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout });
      const pdf = await page.pdf({
        format: 'A4',
        landscape: options?.landscape ?? false,
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        timeout,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}
```

Key differences from original plan:
- `puppeteer-core` + `@sparticuz/chromium` (prod-ready, no bundled binary)
- `setJavaScriptEnabled(false)` — blocks script execution in rendered content
- `setRequestInterception(true)` — blocks all network except `data:` URLs
- `waitUntil: 'domcontentloaded'` instead of `'networkidle0'` (faster, no network needed)
- 30s timeout on both `setContent` and `page.pdf()`
- Cloud Run flags: `--disable-dev-shm-usage`, `--disable-gpu`, `--font-render-hinting=none`

**Step 2: Commit**

```bash
git add backend/src/modules/export/export.service.ts
git commit -m "feat: add ExportService with hardened Puppeteer (JS disabled, network blocked)"
```

---

### Task 3: Shared Template Utilities

**Files:**
- Create: `backend/src/modules/export/templates/util.ts`

Centralizes `escapeHtml`, `sanitizeHtml`, and `validateDataUrl` — used by all templates.

```typescript
// backend/src/modules/export/templates/util.ts
import DOMPurify from 'isomorphic-dompurify';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Sanitize user-supplied HTML (TipTap report content).
 * Allow-list of safe tags. Strips scripts, iframes, event handlers, etc.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'p', 'br', 'strong', 'b', 'em', 'i', 'u',
      'ul', 'ol', 'li', 'a', 'blockquote', 'pre', 'code', 'span',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel', 'class',
      'data-cite-type', 'data-cite-label', 'data-cite-url',
      'data-cite-trace-id', 'data-cite-edge-id',
    ],
  });
}

const MAX_DATA_URL_SIZE = 10 * 1024 * 1024; // 10MB

export function validateDataUrl(dataUrl: string): void {
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Invalid data URL: must be a PNG data URL');
  }
  if (dataUrl.length > MAX_DATA_URL_SIZE) {
    throw new Error(`Data URL exceeds ${MAX_DATA_URL_SIZE / 1024 / 1024}MB limit`);
  }
}
```

**Commit:**

```bash
git add backend/src/modules/export/templates/util.ts
git commit -m "feat: add shared template utilities (escapeHtml, sanitizeHtml, validateDataUrl)"
```

---

### Task 4: Shared Styles

**Files:**
- Create: `backend/src/modules/export/templates/styles.ts`

Same as original plan but with citation and works-cited styles included. Uses the `escapeHtml` from `util.ts`.

```bash
git add backend/src/modules/export/templates/styles.ts
git commit -m "feat: add shared print-optimized CSS for PDF templates"
```

---

### Task 5: Report Template with Sanitization + Cheerio Citations

**Files:**
- Create: `backend/src/modules/export/templates/report.ts`

Key changes from original plan:
1. **Sanitize** report content with `sanitizeHtml()` before embedding
2. Use **cheerio** to extract citations (not regex) — handles any attribute order
3. **Rewrite** inline `[N]` text at export time — don't trust the user's numbering

```typescript
// backend/src/modules/export/templates/report.ts
import * as cheerio from 'cheerio';
import { BASE_STYLES } from './styles';
import { escapeHtml, sanitizeHtml } from './util';

interface ReportData {
  content: string;
}

interface Citation {
  index: number;
  type: string;
  label: string;
  url?: string;
}

export function renderReport(name: string, data: ReportData): string {
  const cleanContent = sanitizeHtml(data.content);
  const { html: numberedContent, citations } = extractAndNumberCitations(cleanContent);
  const worksCited = citations.length > 0 ? renderWorksCited(citations) : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>${BASE_STYLES}</style>
</head><body>
<h1>${escapeHtml(name)}</h1>
${numberedContent}
${worksCited}
</body></html>`;
}

/**
 * Extract citations via DOM parsing (not regex — attribute order doesn't matter).
 * Rewrites the visible [N] text to match the authoritative export-time index.
 */
function extractAndNumberCitations(html: string): { html: string; citations: Citation[] } {
  const $ = cheerio.load(html, null, false);
  const citations: Citation[] = [];

  $('.citation').each((i, el) => {
    const $el = $(el);
    const index = i + 1;
    citations.push({
      index,
      type: $el.attr('data-cite-type') || 'external',
      label: $el.attr('data-cite-label') || '',
      url: $el.attr('data-cite-url') || undefined,
    });
    // Rewrite the visible text to the authoritative index
    $el.text(`[${index}]`);
  });

  return { html: $.html(), citations };
}

function renderWorksCited(citations: Citation[]): string {
  const items = citations.map((c) => {
    const link = c.url ? ` <a href="${escapeHtml(c.url)}">${escapeHtml(c.url)}</a>` : '';
    return `<li>[${c.index}] ${escapeHtml(c.label)}${link}</li>`;
  });
  return `<div class="works-cited"><h2>Works Cited</h2><ol>${items.join('')}</ol></div>`;
}
```

**Commit:**

```bash
git add backend/src/modules/export/templates/report.ts
git commit -m "feat: add report template with DOMPurify + cheerio citation extraction"
```

---

### Task 6: Chronology, Chart, Graph Templates

**Files:**
- Create: `backend/src/modules/export/templates/chronology.ts`
- Create: `backend/src/modules/export/templates/chart.ts`
- Create: `backend/src/modules/export/templates/graph.ts`

Same as original plan but using shared `escapeHtml` from `util.ts` (no duplication). Chart and graph templates use `validateDataUrl()` before embedding the image.

Internal IDs (`sourceTraceId`, `sourceEdgeId`) are NOT included in chronology output. The design claim about "resolving internal IDs to human-readable labels" is deferred — external URL citations only for now.

**Commit:**

```bash
git add backend/src/modules/export/templates/chronology.ts backend/src/modules/export/templates/chart.ts backend/src/modules/export/templates/graph.ts
git commit -m "feat: add chronology, chart, and graph PDF templates"
```

---

### Task 7: Export Controller + Module + Wiring

**Files:**
- Create: `backend/src/modules/export/export.controller.ts`
- Create: `backend/src/modules/export/export.module.ts`
- Modify: `backend/src/app.module.ts`

Key changes from original plan:
- All export endpoints are **POST** (accept body for format + optional image data)
- `req.user.id` (not `req.user?.id`) — auth is required, not optional
- Chart export receives `imageDataUrl` in the request body, NOT stored in the production
- Data URL validation before rendering
- Remove unused `StreamableFile` import — using `res.send()` directly

```typescript
// backend/src/modules/export/export.controller.ts
import {
  Controller, Post, Param, Body, Res, Req, BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { ProductionsService } from '../productions/productions.service';
import { renderReport } from './templates/report';
import { renderChronology } from './templates/chronology';
import { renderChart } from './templates/chart';
import { renderGraph } from './templates/graph';
import { validateDataUrl } from './templates/util';

@Controller('exports')
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly productionsService: ProductionsService,
  ) {}

  @Post('productions/:id')
  async exportProduction(
    @Param('id') id: string,
    @Body() body: { format: string; imageDataUrl?: string },
    @Req() req: any,
    @Res() res: Response,
  ) {
    const format = body.format;
    if (!format || !['pdf', 'html'].includes(format)) {
      throw new BadRequestException('format must be "pdf" or "html"');
    }

    const production = await this.productionsService.findOne(id, req.user.id);
    const data = production.data as any;
    let html: string;

    switch (production.type) {
      case 'report':
        html = renderReport(production.name, data);
        break;
      case 'chronology':
        html = renderChronology(production.name, data);
        break;
      case 'chart': {
        const imageDataUrl = body.imageDataUrl;
        if (!imageDataUrl) {
          throw new BadRequestException('Chart export requires imageDataUrl in request body');
        }
        validateDataUrl(imageDataUrl);
        html = renderChart(production.name, imageDataUrl);
        break;
      }
      default:
        throw new BadRequestException(`Unsupported production type: ${production.type}`);
    }

    const safeName = production.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.html"`);
      res.send(html);
      return;
    }

    const pdf = await this.exportService.htmlToPdf(html, {
      landscape: production.type === 'chart',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdf);
  }

  @Post('graph')
  async exportGraph(
    @Body() body: { name: string; imageDataUrl: string },
    @Res() res: Response,
  ) {
    if (!body.imageDataUrl) {
      throw new BadRequestException('imageDataUrl is required');
    }
    validateDataUrl(body.imageDataUrl);
    const name = body.name || 'graph';
    const html = renderGraph(name, body.imageDataUrl);
    const pdf = await this.exportService.htmlToPdf(html, { landscape: true });
    const safeName = name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdf);
  }
}
```

Module and wiring same as original plan.

**Commit:**

```bash
git add backend/src/modules/export/ backend/src/app.module.ts
git commit -m "feat: add export controller with POST endpoints for productions and graphs"
```

---

### Task 8: OpenAPI Contracts

**Files:**
- Create: `contracts/paths/export.yaml`
- Modify: `contracts/openapi.yaml`

Note: endpoints are now all POST under `/exports/*` (not mixed prefixes).

```yaml
# contracts/paths/export.yaml
/exports/productions/{id}:
  post:
    summary: Export a production as PDF or HTML
    operationId: exportProduction
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
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
                enum: [pdf, html]
              imageDataUrl:
                type: string
                description: PNG data URL (required for chart export)
    responses:
      '200':
        description: Exported file
        content:
          application/pdf:
            schema:
              type: string
              format: binary
          text/html:
            schema:
              type: string

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
              name:
                type: string
              imageDataUrl:
                type: string
                description: PNG data URL from Cytoscape (must start with data:image/png;base64, max 10MB)
    responses:
      '200':
        description: PDF file
        content:
          application/pdf:
            schema:
              type: string
              format: binary
```

Run: `npm run gen`

**Commit:**

```bash
git add contracts/ frontend/src/generated/ backend/src/generated/
git commit -m "feat: add export OpenAPI contracts"
```

---

### Task 9: Frontend API Client + Download Helper

**Files:**
- Modify: `frontend/src/lib/api-client.ts`

Add `downloadFile` helper (same as original plan) and two export methods. Both are POST requests:

```typescript
  // Export
  exportProduction: (id: string, format: 'pdf' | 'html', filename: string, imageDataUrl?: string) =>
    downloadFile(`/exports/productions/${id}`, `${filename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, imageDataUrl }),
    }),
  exportGraph: (name: string, imageDataUrl: string) =>
    downloadFile('/exports/graph', `${name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, imageDataUrl }),
    }),
```

Filename sanitized on the frontend too (matches backend pattern).

**Commit:**

```bash
git add frontend/src/lib/api-client.ts
git commit -m "feat: add export download helpers to API client"
```

---

### Task 10: Export Buttons in ProductionViewer

**Files:**
- Modify: `frontend/src/components/ProductionViewer.tsx`

Read the full file first. Add export buttons to the header. For charts, capture the canvas PNG and pass it in the request body — do NOT write it to the production.

```typescript
// Chart export handler — captures canvas, sends in request body
const handleExport = async (format: 'pdf' | 'html') => {
  let imageDataUrl: string | undefined;
  if (production.type === 'chart') {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (canvas) {
      imageDataUrl = canvas.toDataURL('image/png');
    }
  }
  await apiClient.exportProduction(production.id, format, production.name, imageDataUrl);
};
```

Add buttons in the header (next to Edit/View toggle):
```tsx
<div className="flex items-center gap-2">
  <button onClick={() => handleExport('pdf')} className="...">
    <FaDownload className="w-3 h-3" /> PDF
  </button>
  <button onClick={() => handleExport('html')} className="...">
    <FaDownload className="w-3 h-3" /> HTML
  </button>
</div>
```

**Commit:**

```bash
git add frontend/src/components/ProductionViewer.tsx
git commit -m "feat: add PDF/HTML export buttons to ProductionViewer"
```

---

### Task 11: Graph PDF Export via Backend

**Files:**
- Modify: `frontend/src/hooks/useCytoscape.ts`

Replace the print-dialog PDF export with `apiClient.exportGraph()`. Add import for `apiClient`.

```typescript
const exportImage = useCallback((format: 'png' | 'pdf', filename = 'graph') => {
  const cy = cyRef.current;
  if (!cy) return;
  const dataUrl = cy.png({ full: true, scale: 2, bg: '#111827' });
  if (format === 'png') {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${filename}.png`;
    a.click();
  } else {
    apiClient.exportGraph(filename, dataUrl);
  }
}, []);
```

**Commit:**

```bash
git add frontend/src/hooks/useCytoscape.ts
git commit -m "feat: replace graph print-dialog PDF with real Puppeteer export"
```

---

### Task 12: Citation System — TipTap Integration

**Files:**
- Create: `frontend/src/components/CitationPicker.tsx`
- Modify: `frontend/src/components/ReportEditor.tsx`

**CitationPicker:** Simple modal with URL + label inputs. External URL citations only (internal trace/edge references deferred). Returns `{ type: 'external', label, url }`.

**ReportEditor changes:**
1. Add `FaQuoteRight` toolbar button that opens CitationPicker
2. On insert, use TipTap `insertContent` to add citation span
3. Do NOT embed a number in the span text at insert time. Instead, use a placeholder like `[*]` — the authoritative numbering happens at export time via cheerio. This avoids the numbering desync bug.
4. Add citation CSS to editor prose styles:
   ```css
   .citation { color: #3b82f6; font-size: 0.75em; vertical-align: super; background: rgba(59, 130, 246, 0.1); padding: 0 2px; border-radius: 2px; }
   ```

Insert pattern:
```typescript
editor.chain().focus().insertContent(
  `<span class="citation" data-cite-type="${type}" data-cite-label="${escapeAttr(label)}" data-cite-url="${escapeAttr(url)}">[*]</span> `
).run();
```

The `[*]` is visible to the user during editing. On export, cheerio rewrites all `[*]` to `[1]`, `[2]`, etc. in document order.

**Commit:**

```bash
git add frontend/src/components/CitationPicker.tsx frontend/src/components/ReportEditor.tsx
git commit -m "feat: add citation insertion to report editor with external URL support"
```

---

### Task 13: Tests

**Files:**
- Create: `backend/src/modules/export/export.service.spec.ts`
- Create: `backend/src/modules/export/templates/report.spec.ts`

**ExportService tests** (integration — actually calls Puppeteer):
- `htmlToPdf` returns a Buffer starting with `%PDF`
- Handles landscape option
- Respects timeout (test with reasonable HTML)
- JS is disabled (inject a `<script>` that modifies content — verify it doesn't execute)

**Report template tests** (unit — no Puppeteer needed):
- `sanitizeHtml` strips `<script>`, `<iframe>`, `onerror` attributes
- `sanitizeHtml` preserves safe tags and citation data attributes
- Citation extraction finds citations regardless of attribute order
- Citation numbering is sequential and matches Works Cited
- Works Cited section is empty when no citations
- `escapeHtml` handles special characters
- `validateDataUrl` rejects non-PNG, oversized, and malformed URLs

**Commit:**

```bash
git add backend/src/modules/export/export.service.spec.ts backend/src/modules/export/templates/report.spec.ts
git commit -m "test: add export service and report template tests"
```
