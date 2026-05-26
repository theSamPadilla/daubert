import { BASE_STYLES, CHRONOLOGY_STYLES, CSP_META } from './styles';
import { escapeHtml, sanitizeUrl } from './util';
import { HIGHLIGHT_COLORS, isHighlightColor } from '../../productions/chronology-highlights';

interface ChronologyEntry {
  /** @deprecated use sourceUrl. Still accepted for backward compatibility. */
  source?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  date: string;
  description: string;
  details?: string | null;
  highlight?: string | null;
}

interface ChronologyColumnWidths {
  source?: number;
  date?: number;
  description?: number;
  details?: number;
}

interface ChronologyData {
  title?: string;
  entries: ChronologyEntry[];
  columnWidths?: ChronologyColumnWidths;
}

// Defaults shared with frontend ChronologyTable. Sum equals 100; user-set widths
// from the UI may diverge slightly — that's fine, table-layout:fixed is forgiving.
const DEFAULT_COLUMN_WIDTHS: Required<ChronologyColumnWidths> = {
  source: 18,
  date: 14,
  description: 40,
  details: 28,
};

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

/**
 * Returns just the inner body HTML for this chronology — no <html>/<head>/<style> wrapper.
 * Used by the exhibit composer to embed chronologies into a multi-item document.
 * The caller must ensure CHRONOLOGY_STYLES is included in the document's <style> block.
 */
export function renderChronologyBody(name: string, data: ChronologyData): string {
  const title = data.title || name;
  const w = { ...DEFAULT_COLUMN_WIDTHS, ...(data.columnWidths ?? {}) };
  const rows = (data.entries || []).map((e) => {
    const url = e.sourceUrl ?? e.source ?? null;
    const label = e.sourceLabel ?? (url ? deriveSourceLabel(url) : null);
    const sourceCell = url
      ? `<a href="${escapeHtml(sanitizeUrl(url))}">${escapeHtml(label ?? url)}</a>`
      : 'N/A';
    const hl = isHighlightColor(e.highlight) ? HIGHLIGHT_COLORS[e.highlight] : null;
    const rowStyle = hl ? ` style="background:${hl.bg};color:${hl.fg}"` : '';
    const detailsColor = hl ? hl.fg : '#666';
    return `
    <tr${rowStyle}>
      <td style="font-size:9pt;font-family:monospace">${sourceCell}</td>
      <td style="white-space:nowrap">${escapeHtml(e.date)}</td>
      <td>${escapeHtml(e.description)}</td>
      <td style="font-size:9pt;color:${detailsColor};overflow-wrap:anywhere">${e.details ? escapeHtml(e.details) : '--'}</td>
    </tr>
  `;
  }).join('');

  return `<table class="chronology">
  <colgroup>
    <col style="width:${w.source}%">
    <col style="width:${w.date}%">
    <col style="width:${w.description}%">
    <col style="width:${w.details}%">
  </colgroup>
  <thead><tr><th>Source</th><th>Date</th><th>Description</th><th>Details</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function renderChronology(name: string, data: ChronologyData): string {
  const title = data.title || name;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>${escapeHtml(title)}</title>
<style>${BASE_STYLES}${CHRONOLOGY_STYLES}</style>
</head><body>
<h1>${escapeHtml(title)}</h1>
${renderChronologyBody(name, data)}
</body></html>`;
}
