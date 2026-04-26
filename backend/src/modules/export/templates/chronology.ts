import { BASE_STYLES, CSP_META } from './styles';
import { escapeHtml, sanitizeUrl } from './util';

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
  const rows = (data.entries || []).map((e) => `
    <tr>
      <td>${e.source ? `<a href="${escapeHtml(sanitizeUrl(e.source))}">${escapeHtml(e.source)}</a>` : 'N/A'}</td>
      <td style="white-space:nowrap">${escapeHtml(e.date)}</td>
      <td>${escapeHtml(e.description)}</td>
      <td style="font-size:9pt;color:#666">${e.details ? escapeHtml(e.details) : '--'}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>${escapeHtml(title)}</title>
<style>${BASE_STYLES}</style>
</head><body>
<h1>${escapeHtml(title)}</h1>
<table>
  <thead><tr><th>Source</th><th>Date</th><th>Description</th><th>Details</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}
