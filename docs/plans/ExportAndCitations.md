# Export & Citations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PDF/HTML export for all production types (reports, chronologies, charts) and graph snapshots, plus a citation system for reports that references traces, edges, and external sources — with a "works cited" appendix generated on export.

**Architecture:** Server-side PDF generation via Puppeteer (headless Chrome) on the NestJS backend. Each production type gets an HTML template that renders a print-ready document with proper styling, headers, and page breaks. The export endpoint accepts a production ID and returns a PDF stream. The citation system stores references inline in report HTML as data attributes, rendered as numbered superscripts, and a "Works Cited" section is auto-appended on export. Graph export upgrades the existing PNG-only pipeline to also produce true PDF files via the same Puppeteer endpoint.

**Tech Stack:** `puppeteer` (backend, PDF from HTML), existing TipTap/Chart.js/Cytoscape on frontend, NestJS `StreamableFile` for binary responses.

**Why Puppeteer over xhtml2pdf/wkhtmltopdf:** This is a Node.js backend (not Python). Puppeteer renders real Chrome, so CSS/HTML fidelity is exact — what you see in the browser is what you get in the PDF. No CSS compatibility issues. Single dependency, already battle-tested for this use case.

---

## Atomized Changes

| # | File(s) | Action | Purpose |
|---|---------|--------|---------|
| 1 | `backend/package.json` | Modify | Install `puppeteer` for server-side PDF rendering |
| 2 | `backend/src/modules/export/export.module.ts`, `export.service.ts`, `export.controller.ts` | Create | Export module — HTML→PDF via Puppeteer, endpoints for production and graph export |
| 3 | `backend/src/modules/export/templates/` | Create | HTML templates for report, chronology, chart, and graph PDF export |
| 4 | `backend/src/app.module.ts` | Modify | Wire ExportModule |
| 5 | `contracts/paths/export.yaml`, `contracts/openapi.yaml` | Create + Modify | OpenAPI spec for export endpoints |
| 6 | `frontend/src/lib/api-client.ts` | Modify | Add export methods that trigger file downloads |
| 7 | `frontend/src/components/ProductionViewer.tsx` | Modify | Add "Export PDF" / "Export HTML" buttons to header |
| 8 | `frontend/src/hooks/useCytoscape.ts` | Modify | Replace print-dialog PDF with real backend PDF export |
| 9 | `frontend/src/components/ReportEditor.tsx` | Modify | Add citation insertion toolbar button + inline rendering |
| 10 | `backend/src/modules/export/templates/report.html` | Modify | Auto-generate "Works Cited" appendix from citation data attributes on export |

---

## Design Decisions

### PDF approach: Server-side Puppeteer

The backend constructs a full HTML document from the production's data, including print-optimized CSS (page breaks, margins, headers/footers). Puppeteer renders it to PDF. This means:
- Reports: the TipTap HTML content is wrapped in a print template
- Chronologies: the entries are rendered as a styled HTML table (no internal IDs)
- Charts: Chart.js data is re-rendered server-side using a `<canvas>` in the Puppeteer page
- Graphs: the frontend sends the Cytoscape PNG data URL to the backend, which wraps it in a template and converts to PDF

### Citation system: data attributes in HTML

Citations are stored inline in the report HTML as spans with data attributes:

```html
<span class="citation" data-cite-type="edge" data-cite-trace-id="abc" data-cite-edge-id="def" data-cite-label="Tx 0x1234...">[1]</span>
```

Types:
- `edge` — references a specific transaction edge (trace ID + edge ID)
- `external` — references an external URL (data-cite-url)
- `trace` — references an entire trace

On export, the template scans for `.citation` spans, builds a numbered "Works Cited" section at the end, and replaces the `[N]` placeholders with proper superscript links. Internal IDs (`sourceTraceId`, `sourceEdgeId`) are resolved to human-readable labels (tx hash, address) at export time.

In the TipTap editor, citations appear as styled inline badges. A toolbar button opens a citation picker (select trace → edge, or enter external URL).

---

### Task 1: Install Puppeteer

**Files:**
- Modify: `backend/package.json`

**Step 1: Install**

```bash
cd backend && npm install puppeteer
```

Note: Puppeteer bundles Chromium (~280MB). For production Docker, use `puppeteer-core` + a pre-installed Chrome. For now, the full `puppeteer` package is fine for dev.

**Step 2: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "feat: add puppeteer for server-side PDF generation"
```

---

### Task 2: Export Service

**Files:**
- Create: `backend/src/modules/export/export.service.ts`

**Step 1: Create the service**

The service takes HTML content and returns a PDF buffer via Puppeteer. It manages a single browser instance (reused across requests for performance).

```typescript
// backend/src/modules/export/export.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';

@Injectable()
export class ExportService implements OnModuleDestroy {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.connected) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
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

  /**
   * Convert an HTML string to a PDF buffer.
   * The HTML should be a full document with <html>, <head>, <body>.
   */
  async htmlToPdf(html: string, options?: { landscape?: boolean }): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        landscape: options?.landscape ?? false,
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/modules/export/export.service.ts
git commit -m "feat: add ExportService with Puppeteer HTML-to-PDF"
```

---

### Task 3: HTML Templates

**Files:**
- Create: `backend/src/modules/export/templates/report.ts`
- Create: `backend/src/modules/export/templates/chronology.ts`
- Create: `backend/src/modules/export/templates/chart.ts`
- Create: `backend/src/modules/export/templates/graph.ts`
- Create: `backend/src/modules/export/templates/styles.ts`

Each template is a function that takes production data and returns a full HTML document string.

**Step 1: Create shared styles**

```typescript
// backend/src/modules/export/templates/styles.ts
export const BASE_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.6; font-size: 11pt; }
  h1 { font-size: 20pt; margin-bottom: 12pt; color: #111; }
  h2 { font-size: 15pt; margin-top: 18pt; margin-bottom: 8pt; color: #222; }
  h3 { font-size: 12pt; margin-top: 14pt; margin-bottom: 6pt; color: #333; }
  p { margin-bottom: 8pt; }
  ul, ol { margin-left: 20pt; margin-bottom: 8pt; }
  a { color: #2563eb; text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16pt; font-size: 10pt; }
  th { background: #f3f4f6; font-weight: 600; text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; }
  td { padding: 8px 12px; border: 1px solid #d1d5db; vertical-align: top; }
  .citation { color: #2563eb; font-size: 8pt; vertical-align: super; cursor: default; }
  .works-cited { margin-top: 24pt; border-top: 2px solid #d1d5db; padding-top: 16pt; }
  .works-cited h2 { font-size: 14pt; }
  .works-cited li { margin-bottom: 4pt; font-size: 10pt; word-break: break-all; }
  @page { margin: 20mm 15mm; }
  @media print { .no-print { display: none; } }
`;
```

**Step 2: Create report template**

```typescript
// backend/src/modules/export/templates/report.ts
import { BASE_STYLES } from './styles';

interface ReportData {
  content: string; // HTML from TipTap
}

export function renderReport(name: string, data: ReportData): string {
  // Extract citations from the HTML for the Works Cited section
  const citations = extractCitations(data.content);
  const worksCited = citations.length > 0 ? renderWorksCited(citations) : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>${BASE_STYLES}</style>
</head><body>
<h1>${escapeHtml(name)}</h1>
${data.content}
${worksCited}
</body></html>`;
}

interface Citation {
  index: number;
  type: string;
  label: string;
  url?: string;
}

function extractCitations(html: string): Citation[] {
  const citations: Citation[] = [];
  const regex = /data-cite-label="([^"]*)"[^>]*data-cite-type="([^"]*)"(?:[^>]*data-cite-url="([^"]*)")?/g;
  let match;
  let i = 1;
  while ((match = regex.exec(html)) !== null) {
    citations.push({ index: i++, type: match[2], label: match[1], url: match[3] });
  }
  return citations;
}

function renderWorksCited(citations: Citation[]): string {
  const items = citations.map((c) => {
    const link = c.url ? `<a href="${c.url}">${escapeHtml(c.url)}</a>` : '';
    return `<li>[${c.index}] ${escapeHtml(c.label)} ${link}</li>`;
  });
  return `<div class="works-cited"><h2>Works Cited</h2><ol>${items.join('')}</ol></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

**Step 3: Create chronology template**

The chronology strips all internal IDs (`sourceTraceId`, `sourceEdgeId`) — only external-facing fields appear.

```typescript
// backend/src/modules/export/templates/chronology.ts
import { BASE_STYLES } from './styles';

interface ChronologyEntry {
  source: string | null;
  date: string;
  description: string;
  details?: string | null;
}

interface ChronologyData {
  title?: string;
  entries: ChronologyEntry[];
}

export function renderChronology(name: string, data: ChronologyData): string {
  const title = data.title || name;
  const rows = data.entries.map((e) => `
    <tr>
      <td>${e.source ? `<a href="${escapeHtml(e.source)}">${escapeHtml(e.source)}</a>` : 'N/A'}</td>
      <td style="white-space:nowrap">${escapeHtml(e.date)}</td>
      <td>${escapeHtml(e.description)}</td>
      <td style="font-size:9pt;color:#666">${e.details ? escapeHtml(e.details) : '--'}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${BASE_STYLES}</style>
</head><body>
<h1>${escapeHtml(title)}</h1>
<table>
  <thead><tr><th>Source</th><th>Date</th><th>Description</th><th>Details</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

**Step 4: Create chart template**

Charts are rendered client-side — the frontend captures the canvas as a PNG data URL and sends it to the export endpoint. The template just wraps the image.

```typescript
// backend/src/modules/export/templates/chart.ts
import { BASE_STYLES } from './styles';

export function renderChart(name: string, imageDataUrl: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>${BASE_STYLES} img { max-width: 100%; height: auto; }</style>
</head><body>
<h1>${escapeHtml(name)}</h1>
<img src="${imageDataUrl}" alt="${escapeHtml(name)}" />
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

**Step 5: Create graph template**

Same pattern — wraps a PNG data URL from Cytoscape.

```typescript
// backend/src/modules/export/templates/graph.ts
import { BASE_STYLES } from './styles';

export function renderGraph(name: string, imageDataUrl: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>${BASE_STYLES}
  body { display: flex; flex-direction: column; align-items: center; }
  img { max-width: 100%; height: auto; margin-top: 16pt; }
</style>
</head><body>
<h1>${escapeHtml(name)}</h1>
<img src="${imageDataUrl}" alt="${escapeHtml(name)}" />
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

**Step 6: Commit**

```bash
git add backend/src/modules/export/templates/
git commit -m "feat: add HTML templates for PDF export (report, chronology, chart, graph)"
```

---

### Task 4: Export Controller + Module

**Files:**
- Create: `backend/src/modules/export/export.controller.ts`
- Create: `backend/src/modules/export/export.module.ts`
- Modify: `backend/src/app.module.ts`

**Step 1: Create the controller**

Two endpoints:
- `GET /productions/:id/export?format=pdf|html` — export a production
- `POST /export/graph` — export a graph snapshot (receives PNG data URL in body)

```typescript
// backend/src/modules/export/export.controller.ts
import {
  Controller, Get, Post, Param, Query, Body, Res, Req,
  BadRequestException, StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { ProductionsService } from '../productions/productions.service';
import { renderReport } from './templates/report';
import { renderChronology } from './templates/chronology';
import { renderChart } from './templates/chart';
import { renderGraph } from './templates/graph';

@Controller()
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly productionsService: ProductionsService,
  ) {}

  @Get('productions/:id/export')
  async exportProduction(
    @Param('id') id: string,
    @Query('format') format: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (!format || !['pdf', 'html'].includes(format)) {
      throw new BadRequestException('format must be "pdf" or "html"');
    }

    const production = await this.productionsService.findOne(id, req.user?.id);
    const data = production.data as any;
    let html: string;

    switch (production.type) {
      case 'report':
        html = renderReport(production.name, data);
        break;
      case 'chronology':
        html = renderChronology(production.name, data);
        break;
      case 'chart':
        // Chart export requires imageDataUrl in query or data
        if (!data.imageDataUrl) {
          throw new BadRequestException('Chart export requires imageDataUrl in production data. Capture the chart image first.');
        }
        html = renderChart(production.name, data.imageDataUrl);
        break;
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

  @Post('export/graph')
  async exportGraph(
    @Body() body: { name: string; imageDataUrl: string },
    @Res() res: Response,
  ) {
    if (!body.imageDataUrl) {
      throw new BadRequestException('imageDataUrl is required');
    }
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

**Step 2: Create the module**

```typescript
// backend/src/modules/export/export.module.ts
import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { ProductionsModule } from '../productions/productions.module';

@Module({
  imports: [ProductionsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
```

**Step 3: Wire into app.module.ts**

Add `ExportModule` to the imports array.

**Step 4: Test**

```bash
# Create a report production first, then:
curl -o test.pdf "http://localhost:8081/productions/<ID>/export?format=pdf"
curl -o test.html "http://localhost:8081/productions/<ID>/export?format=html"

# Graph export:
# (would need a real data URL, but you can test the endpoint responds)
```

**Step 5: Commit**

```bash
git add backend/src/modules/export/ backend/src/app.module.ts
git commit -m "feat: add export controller with PDF/HTML endpoints for productions and graphs"
```

---

### Task 5: OpenAPI Contracts

**Files:**
- Create: `contracts/paths/export.yaml`
- Modify: `contracts/openapi.yaml`

**Step 1: Create paths file**

```yaml
# contracts/paths/export.yaml
/productions/{id}/export:
  get:
    summary: Export a production as PDF or HTML
    operationId: exportProduction
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: format
        in: query
        required: true
        schema:
          type: string
          enum: [pdf, html]
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

/export/graph:
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
                description: PNG data URL from Cytoscape canvas export
    responses:
      '200':
        description: PDF file
        content:
          application/pdf:
            schema:
              type: string
              format: binary
```

**Step 2: Wire into openapi.yaml**

Add path refs. No new schemas needed (inline in paths).

**Step 3: Regenerate types**

Run: `npm run gen`

**Step 4: Commit**

```bash
git add contracts/ frontend/src/generated/ backend/src/generated/
git commit -m "feat: add export OpenAPI contracts"
```

---

### Task 6: Frontend API Client + Download Helper

**Files:**
- Modify: `frontend/src/lib/api-client.ts`

**Step 1: Add a download helper and export methods**

The export endpoints return binary data, so we can't use the standard `request<T>()` helper. Add a `downloadFile` helper that triggers a browser download.

```typescript
// Add near the top of api-client.ts, after the request() function:

async function downloadFile(path: string, filename: string, options?: RequestInit): Promise<void> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  try {
    const currentUser = getFirebaseAuth().currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `Export error ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

Add methods to `apiClient`:

```typescript
  // Export
  exportProduction: (id: string, format: 'pdf' | 'html', filename: string) =>
    downloadFile(`/productions/${id}/export?format=${format}`, `${filename}.${format}`),
  exportGraph: (name: string, imageDataUrl: string) =>
    downloadFile('/export/graph', `${name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, imageDataUrl }),
    }),
```

**Step 2: Commit**

```bash
git add frontend/src/lib/api-client.ts
git commit -m "feat: add export download helpers to API client"
```

---

### Task 7: Export Buttons in ProductionViewer

**Files:**
- Modify: `frontend/src/components/ProductionViewer.tsx`

**Step 1: Add export buttons to the header**

Read the full `ProductionViewer.tsx` first. In the header bar (next to the Edit/View toggle), add a dropdown or buttons for "Export PDF" and "Export HTML".

Add import: `import { FaDownload } from 'react-icons/fa6';`

For chart export, capture the canvas first. Add a ref to ChartViewer that exposes a `toDataUrl()` method, or use `document.querySelector('canvas')?.toDataURL()` before calling the export. For reports and chronologies, just call `apiClient.exportProduction(id, format, name)` directly.

```tsx
{/* Add next to the Edit/View button in the header */}
<div className="flex items-center gap-2">
  <button
    onClick={() => apiClient.exportProduction(production.id, 'pdf', production.name)}
    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300"
  >
    <FaDownload className="w-3 h-3" /> PDF
  </button>
  <button
    onClick={() => apiClient.exportProduction(production.id, 'html', production.name)}
    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300"
  >
    <FaDownload className="w-3 h-3" /> HTML
  </button>
</div>
```

For charts, before calling export, capture the canvas image and save it to the production data:

```typescript
const handleChartExport = async (format: 'pdf' | 'html') => {
  const canvas = document.querySelector('.chart-container canvas') as HTMLCanvasElement;
  if (canvas) {
    const imageDataUrl = canvas.toDataURL('image/png');
    await apiClient.updateProduction(production.id, { data: { ...data, imageDataUrl } });
  }
  await apiClient.exportProduction(production.id, format, production.name);
};
```

**Step 2: Commit**

```bash
git add frontend/src/components/ProductionViewer.tsx
git commit -m "feat: add PDF/HTML export buttons to ProductionViewer"
```

---

### Task 8: Graph PDF Export via Backend

**Files:**
- Modify: `frontend/src/hooks/useCytoscape.ts`

**Step 1: Replace print-dialog PDF with real export**

Read `frontend/src/hooks/useCytoscape.ts` lines 970-991 (the `exportImage` callback). Currently, PDF export opens a print dialog. Replace it with a call to `apiClient.exportGraph()`.

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

Add import at the top of the file: `import { apiClient } from '@/lib/api-client';`

**Step 2: Test**

- Open an investigation with graph data
- Click Export → PDF in the header
- Should download a real PDF file (not open print dialog)
- PNG export should still work as before

**Step 3: Commit**

```bash
git add frontend/src/hooks/useCytoscape.ts
git commit -m "feat: replace graph print-dialog PDF with real Puppeteer export"
```

---

### Task 9: Citation System — TipTap Extension

**Files:**
- Create: `frontend/src/components/CitationPicker.tsx`
- Modify: `frontend/src/components/ReportEditor.tsx`

**Step 1: Create CitationPicker component**

A modal/popover that lets the user insert a citation. Options:
- **External URL**: text input for URL + label
- **Trace reference**: dropdown of traces in the investigation → dropdown of edges in the selected trace

The picker returns a citation object: `{ type, label, url?, traceId?, edgeId? }`.

This component needs the investigation context (traces and edges). Pass it via props from the parent.

```typescript
// frontend/src/components/CitationPicker.tsx
interface CitationPickerProps {
  onInsert: (citation: { type: string; label: string; url?: string; traceId?: string; edgeId?: string }) => void;
  onClose: () => void;
}
```

Keep it simple — two tabs: "External URL" and "Internal Reference". External URL tab has URL + label inputs. Internal reference is out of scope for this task — just external URLs for now. Internal trace/edge references can be added later.

**Step 2: Add citation toolbar button to ReportEditor**

In the ReportEditor toolbar, add a citation button (use `FaQuoteRight` from `react-icons/fa6`). Clicking it opens the CitationPicker. On insert, use TipTap's `insertContent` to add the citation span:

```typescript
editor.chain().focus().insertContent(
  `<span class="citation" data-cite-type="${type}" data-cite-label="${label}" ${url ? `data-cite-url="${url}"` : ''}>[${nextCitationNumber}]</span>`
).run();
```

Add CSS in the editor's `editorProps` to style citations inline:
```css
.citation { color: #3b82f6; font-size: 0.75em; vertical-align: super; background: rgba(59, 130, 246, 0.1); padding: 0 2px; border-radius: 2px; cursor: default; }
```

**Step 3: Test**

- Open a report production in edit mode
- Click the citation button
- Enter a URL and label
- Citation appears as `[1]` in the text
- Toggle to view mode — citation renders as a blue superscript

**Step 4: Commit**

```bash
git add frontend/src/components/CitationPicker.tsx frontend/src/components/ReportEditor.tsx
git commit -m "feat: add citation insertion to report editor with external URL support"
```

---

### Task 10: Works Cited on PDF Export

**Files:**
- Modify: `backend/src/modules/export/templates/report.ts`

This is already handled in Task 3's `renderReport()` template — the `extractCitations()` function scans the HTML for citation data attributes and builds the Works Cited section. Verify it works end-to-end:

**Step 1: Test the full flow**

1. Create a report production via the agent or UI
2. Add citations (external URLs) in the TipTap editor
3. Export as PDF
4. Verify the PDF has a "Works Cited" section at the end with numbered references
5. Verify the PDF has properly formatted superscript citation numbers inline

**Step 2: Fix any issues found during testing**

The citation extraction regex may need tuning depending on how TipTap serializes the data attributes. Test with multiple citations and verify numbering is sequential.

**Step 3: Commit**

```bash
git add backend/src/modules/export/templates/report.ts
git commit -m "feat: verify works-cited generation on PDF export"
```

---

### Task 11: Service Tests

**Files:**
- Create: `backend/src/modules/export/export.service.spec.ts`

**Step 1: Write tests**

Test the `ExportService`:
- `htmlToPdf` returns a Buffer
- The buffer starts with `%PDF` (valid PDF header)
- Handles basic HTML content
- Handles landscape option

Mock Puppeteer is complex — for this service, use a lightweight integration test that actually calls Puppeteer (it's fast for simple HTML). If Puppeteer isn't available in CI, skip with `describe.skipIf`.

**Step 2: Commit**

```bash
git add backend/src/modules/export/export.service.spec.ts
git commit -m "test: add ExportService tests"
```
