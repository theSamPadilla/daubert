import { BASE_STYLES, CSP_META } from './styles';
import { escapeHtml, validateDataUrl } from './util';

export function renderChart(name: string, imageDataUrl: string): string {
  validateDataUrl(imageDataUrl);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>${escapeHtml(name)}</title>
<style>${BASE_STYLES} img { max-width: 100%; height: auto; }</style>
</head><body>
<h1>${escapeHtml(name)}</h1>
<img src="${imageDataUrl}" alt="${escapeHtml(name)}" />
</body></html>`;
}
