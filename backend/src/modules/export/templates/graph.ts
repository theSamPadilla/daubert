import { BASE_STYLES, CSP_META, GRAPH_STYLES } from './styles';
import { escapeHtml, validateDataUrl } from './util';

/**
 * Returns just the inner body HTML for this graph — no <html>/<head>/<style> wrapper.
 * Used by the exhibit composer to embed graphs into a multi-item document.
 * Image uses object-fit: contain via .exhibit-graph-img so oversized graphs scale to fit page.
 */
export function renderGraphBody(name: string, imageDataUrl: string): string {
  validateDataUrl(imageDataUrl);
  return `<img src="${imageDataUrl}" alt="${escapeHtml(name)}" class="exhibit-graph-img" />`;
}

export function renderGraph(name: string, imageDataUrl: string): string {
  validateDataUrl(imageDataUrl);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>${escapeHtml(name)}</title>
<style>${BASE_STYLES}${GRAPH_STYLES}</style>
</head><body class="graph-full-doc">
<h1>${escapeHtml(name)}</h1>
<img src="${imageDataUrl}" alt="${escapeHtml(name)}" />
</body></html>`;
}
