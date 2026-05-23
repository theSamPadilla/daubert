import { BASE_STYLES, CHART_STYLES, CSP_META } from './styles';
import { escapeHtml, validateDataUrl } from './util';

/**
 * Returns just the inner body HTML for this chart — no <html>/<head>/<style> wrapper.
 * Used by the exhibit composer to embed charts into a multi-item document.
 * The caller must ensure CHART_STYLES is included in the document's <style> block.
 */
export function renderChartBody(name: string, imageDataUrl: string): string {
  validateDataUrl(imageDataUrl);
  return `<img src="${imageDataUrl}" alt="${escapeHtml(name)}" class="exhibit-chart-img" />`;
}

export function renderChart(name: string, imageDataUrl: string): string {
  validateDataUrl(imageDataUrl);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>${escapeHtml(name)}</title>
<style>${BASE_STYLES}${CHART_STYLES}</style>
</head><body>
<h1>${escapeHtml(name)}</h1>
<img src="${imageDataUrl}" alt="${escapeHtml(name)}" class="chart-img" />
</body></html>`;
}
