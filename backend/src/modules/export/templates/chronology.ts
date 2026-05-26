import { BASE_STYLES, CHRONOLOGY_STYLES, CSP_META } from './styles';
import { escapeHtml, sanitizeUrl } from './util';
import { HIGHLIGHT_COLORS, isHighlightColor } from '../../productions/chronology-highlights';
import { buildFontOverrideCss, RenderOptions } from '../render-options';
import {
  ColumnDef,
  ChronologyData,
  ChronologyEntry,
  DEFAULT_COLUMNS,
  normalizeEntry,
} from '../../productions/chronology-schema';

function getColumns(data: ChronologyData): ColumnDef[] {
  return Array.isArray(data.columns) && data.columns.length > 0 ? data.columns : DEFAULT_COLUMNS;
}

// Pulls the last 0x-prefixed hex run (a tx/address hash) and returns "0x6ae5…".
// Falls back to host+path truncation when no hash is present.
function deriveSourceLabel(url: string): string {
  const matches = url.match(/0x[a-fA-F0-9]{8,}/g);
  if (matches && matches.length > 0) {
    return matches[matches.length - 1].slice(0, 6) + '…';
  }
  try {
    const u = new URL(url);
    const tail = u.pathname + u.search;
    return tail.length > 30 ? u.host + tail.slice(0, 30) + '…' : u.host + tail;
  } catch {
    return url.length > 32 ? url.slice(0, 32) + '…' : url;
  }
}

function renderCell(
  e: ChronologyEntry,
  c: ColumnDef,
  hl: { bg: string; fg: string } | null,
): string {
  if (c.kind === 'link') {
    const v = (e[c.key] as { url: string | null; label: string | null } | null) ?? null;
    const url = v?.url ?? null;
    const label = v?.label ?? (url ? deriveSourceLabel(url) : null);
    const inner = url
      ? `<a href="${escapeHtml(sanitizeUrl(url))}">${escapeHtml(label ?? url)}</a>`
      : 'N/A';
    return `<td style="font-size:9pt;font-family:monospace">${inner}</td>`;
  }
  // text — `details` keeps its smaller / muted styling for visual continuity.
  const isDetailsLike = c.key === 'details';
  const color = hl ? hl.fg : (isDetailsLike ? '#666' : 'inherit');
  const sizeStyle = isDetailsLike ? 'font-size:9pt;' : '';
  const raw = e[c.key];
  const v = typeof raw === 'string' ? raw : '';
  const display = v === '' && isDetailsLike ? '--' : v;
  return `<td style="${sizeStyle}color:${color};overflow-wrap:anywhere">${escapeHtml(display)}</td>`;
}

/**
 * Returns just the inner body HTML for this chronology — no <html>/<head>/<style> wrapper.
 * Used by the exhibit composer to embed chronologies into a multi-item document.
 * The caller must ensure CHRONOLOGY_STYLES is included in the document's <style> block.
 */
export function renderChronologyBody(name: string, data: ChronologyData): string {
  const columns = getColumns(data);
  const colTags = columns.map((c) => `<col style="width:${c.width}%">`).join('');
  const headerCells = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  // Normalize at the boundary so un-migrated rows (entry.sourceUrl still flat)
  // export with their source URL intact. normalizeEntry is idempotent.
  const rows = (data.entries || []).map((raw) => {
    const e = normalizeEntry(raw as Record<string, unknown>);
    const highlight = e.highlight;
    const hl = isHighlightColor(highlight) ? HIGHLIGHT_COLORS[highlight] : null;
    const rowStyle = hl ? ` style="background:${hl.bg};color:${hl.fg}"` : '';
    const cells = columns.map((c) => renderCell(e, c, hl)).join('');
    return `<tr${rowStyle}>${cells}</tr>`;
  }).join('');
  return `<table class="chronology">
  <colgroup>${colTags}</colgroup>
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function renderChronology(name: string, data: ChronologyData, opts?: RenderOptions): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>${escapeHtml(name)}</title>
<style>${BASE_STYLES}${CHRONOLOGY_STYLES}${buildFontOverrideCss(opts)}</style>
</head><body>
<h1>${escapeHtml(name)}</h1>
${renderChronologyBody(name, data)}
</body></html>`;
}

// RFC 4180: quote fields containing comma, quote, CR, or LF; escape quotes by doubling.
function csvCell(value: string | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Returns CSV text for the chronology, prefixed with a UTF-8 BOM so Excel
 * detects the encoding correctly. Highlight is included as raw metadata
 * (color key), not the cell background that PDF/PNG renders.
 * Link columns expand to two CSV columns: <label> URL + <label> Label.
 */
export function renderChronologyCsv(data: ChronologyData): string {
  const columns = getColumns(data);
  const header: string[] = [];
  for (const c of columns) {
    if (c.kind === 'link') {
      header.push(`${c.label} URL`, `${c.label} Label`);
    } else {
      header.push(c.label);
    }
  }
  header.push('Highlight');

  const lines = [header.join(',')];
  // Normalize at the boundary so un-migrated rows export their source URL.
  for (const raw of data.entries || []) {
    const e = normalizeEntry(raw as Record<string, unknown>);
    const cells: string[] = [];
    for (const c of columns) {
      if (c.kind === 'link') {
        const v = (e[c.key] as { url: string | null; label: string | null } | null) ?? null;
        const url = v?.url ?? null;
        const label = v?.label ?? (url ? deriveSourceLabel(url) : null);
        cells.push(csvCell(url), csvCell(label));
      } else {
        const raw = e[c.key];
        cells.push(csvCell(typeof raw === 'string' ? raw : ''));
      }
    }
    const highlight = e.highlight;
    cells.push(csvCell(isHighlightColor(highlight) ? highlight : ''));
    lines.push(cells.join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
