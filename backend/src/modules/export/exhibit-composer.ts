import { BASE_STYLES, CHART_STYLES, CHRONOLOGY_STYLES, CSP_META, GRAPH_STYLES, REPORT_STYLES } from './templates/styles';
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
`;

export function composeExhibitHtml(items: ComposedItem[]): string {
  const sections = items
    .map(
      (it, i) => `
    <section class="exhibit-item${i > 0 ? ' page-break' : ''}">
      <header class="exhibit-item-header">
        <h2>${escapeHtml(it.title)}</h2>
        ${it.subtitle ? `<p class="subtitle">${escapeHtml(it.subtitle)}</p>` : ''}
      </header>
      <div class="exhibit-item-body">${it.bodyHtml}</div>
    </section>
  `,
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>Exhibit</title>
<style>${BASE_STYLES}${REPORT_STYLES}${CHRONOLOGY_STYLES}${CHART_STYLES}${GRAPH_STYLES}${EXHIBIT_STYLES}</style>
</head><body>${sections}</body></html>`;
}
