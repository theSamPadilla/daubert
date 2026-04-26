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

/**
 * Sanitize a URL for safe embedding in href attributes.
 * Positive allow-list: only http:, https:, mailto:, and fragment-only (#) URLs pass.
 * Everything else (javascript:, data:, vbscript:, svg, etc.) is replaced with '#'.
 */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('#')) return trimmed;
  const lower = trimmed.toLowerCase().replace(/[\s\x00-\x1f]/g, '');
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:')
  ) {
    return trimmed;
  }
  return '#';
}

const MAX_DATA_URL_SIZE = 10 * 1024 * 1024; // ~10MB base64 string length (~7.5MB decoded binary)

export function validateDataUrl(dataUrl: string): void {
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Invalid data URL: must be a PNG data URL');
  }
  if (dataUrl.length > MAX_DATA_URL_SIZE) {
    throw new Error(`Data URL exceeds ${MAX_DATA_URL_SIZE / 1024 / 1024}MB limit`);
  }
}
