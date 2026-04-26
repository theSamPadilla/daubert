import * as cheerio from 'cheerio';
import { BASE_STYLES, CSP_META } from './styles';
import { escapeHtml, sanitizeHtml, sanitizeUrl } from './util';

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
<html><head><meta charset="utf-8">${CSP_META}<title>${escapeHtml(name)}</title>
<style>${BASE_STYLES}</style>
</head><body>
<h1>${escapeHtml(name)}</h1>
${numberedContent}
${worksCited}
</body></html>`;
}

function extractAndNumberCitations(html: string): { html: string; citations: Citation[] } {
  const $ = cheerio.load(html, null, false);
  const citations: Citation[] = [];

  $('span.citation[data-cite-label]').each((i, el) => {
    const $el = $(el);
    const index = i + 1;
    citations.push({
      index,
      type: $el.attr('data-cite-type') || 'external',
      label: $el.attr('data-cite-label') || '',
      url: $el.attr('data-cite-url') || undefined,
    });
    $el.text(`[${index}]`);
  });

  return { html: $.html(), citations };
}

function renderWorksCited(citations: Citation[]): string {
  const items = citations.map((c) => {
    const link = c.url ? ` <a href="${escapeHtml(sanitizeUrl(c.url))}">${escapeHtml(c.url)}</a>` : '';
    return `<li>[${c.index}] ${escapeHtml(c.label)}${link}</li>`;
  });
  return `<div class="works-cited"><h2>Works Cited</h2><ol>${items.join('')}</ol></div>`;
}
