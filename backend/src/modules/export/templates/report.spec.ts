import { renderReport } from './report';
import { escapeHtml, sanitizeHtml, validateDataUrl } from './util';

// ── renderReport ────────────────────────────────────────────────────────────

describe('renderReport', () => {
  it('produces valid HTML with title and content', () => {
    const html = renderReport('Test Report', { content: '<p>Hello world</p>' });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Test Report</title>');
    expect(html).toContain('<h1>Test Report</h1>');
    expect(html).toContain('<p>Hello world</p>');
    expect(html).toContain('</html>');
  });
});

// ── sanitizeHtml ────────────────────────────────────────────────────────────

describe('sanitizeHtml', () => {
  it('strips <script> tags', () => {
    const result = sanitizeHtml('<p>Safe</p><script>alert("xss")</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert');
    expect(result).toContain('<p>Safe</p>');
  });

  it('strips <iframe> tags', () => {
    const result = sanitizeHtml('<p>Safe</p><iframe src="https://evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
    expect(result).not.toContain('evil.com');
    expect(result).toContain('<p>Safe</p>');
  });

  it('strips onerror attributes', () => {
    const result = sanitizeHtml('<img onerror="alert(1)" src="x">');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('alert');
  });

  it('preserves safe tags (h1, p, strong, a, ul, li)', () => {
    const input =
      '<h1>Title</h1><p>Text</p><strong>Bold</strong><a href="https://example.com">Link</a><ul><li>Item</li></ul>';
    const result = sanitizeHtml(input);
    expect(result).toContain('<h1>');
    expect(result).toContain('<p>');
    expect(result).toContain('<strong>');
    expect(result).toContain('<a');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
  });

  it('preserves citation data attributes', () => {
    const input =
      '<span class="citation" data-cite-type="tx" data-cite-label="Etherscan" data-cite-url="https://etherscan.io">[*]</span>';
    const result = sanitizeHtml(input);
    expect(result).toContain('data-cite-type="tx"');
    expect(result).toContain('data-cite-label="Etherscan"');
    expect(result).toContain('data-cite-url="https://etherscan.io"');
  });
});

// ── Citation extraction & numbering ─────────────────────────────────────────

describe('citation extraction', () => {
  it('finds citations regardless of data attribute order', () => {
    const typeFirst =
      '<span class="citation" data-cite-type="tx" data-cite-label="Label A" data-cite-url="https://a.com">[*]</span>';
    const labelFirst =
      '<span class="citation" data-cite-label="Label B" data-cite-type="addr" data-cite-url="https://b.com">[*]</span>';

    const html1 = renderReport('Test', { content: typeFirst });
    expect(html1).toContain('[1]');
    expect(html1).toContain('Label A');

    const html2 = renderReport('Test', { content: labelFirst });
    expect(html2).toContain('[1]');
    expect(html2).toContain('Label B');
  });

  it('numbers citations sequentially (1, 2, 3)', () => {
    const content = [
      '<span class="citation" data-cite-type="tx" data-cite-label="First">[*]</span>',
      '<span class="citation" data-cite-type="tx" data-cite-label="Second">[*]</span>',
      '<span class="citation" data-cite-type="tx" data-cite-label="Third">[*]</span>',
    ].join(' ');

    const html = renderReport('Test', { content });
    expect(html).toContain('[1]');
    expect(html).toContain('[2]');
    expect(html).toContain('[3]');
  });

  it('rewrites inline [*] text to [1], [2] etc.', () => {
    const content =
      '<p>See <span class="citation" data-cite-type="tx" data-cite-label="Ref A">[*]</span> and <span class="citation" data-cite-type="addr" data-cite-label="Ref B">[*]</span></p>';

    const html = renderReport('Test', { content });
    // The original [*] markers should be gone, replaced by sequential numbers
    expect(html).not.toContain('[*]');
    expect(html).toContain('[1]');
    expect(html).toContain('[2]');
  });
});

// ── Works Cited section ─────────────────────────────────────────────────────

describe('Works Cited', () => {
  it('generates Works Cited with correct references and URLs', () => {
    const content = [
      '<span class="citation" data-cite-type="tx" data-cite-label="Etherscan TX" data-cite-url="https://etherscan.io/tx/0x123">[*]</span>',
      '<span class="citation" data-cite-type="addr" data-cite-label="Wallet Info" data-cite-url="https://etherscan.io/address/0xabc">[*]</span>',
    ].join(' ');

    const html = renderReport('Test', { content });
    expect(html).toContain('Works Cited');
    expect(html).toContain('[1] Etherscan TX');
    expect(html).toContain('https://etherscan.io/tx/0x123');
    expect(html).toContain('[2] Wallet Info');
    expect(html).toContain('https://etherscan.io/address/0xabc');
  });

  it('is absent when there are no citations', () => {
    const html = renderReport('Test', { content: '<p>No citations here</p>' });
    // The Works Cited heading and section div should not appear in the body.
    // Note: "works-cited" appears in BASE_STYLES as a CSS class definition,
    // so we check for the actual rendered section, not just the class name.
    expect(html).not.toContain('<h2>Works Cited</h2>');
    expect(html).not.toContain('<div class="works-cited">');
  });
});

// ── escapeHtml ──────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('handles &, <, >, "', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml('Tom & Jerry <"friends">')).toBe(
      'Tom &amp; Jerry &lt;&quot;friends&quot;&gt;',
    );
  });
});

// ── validateDataUrl ─────────────────────────────────────────────────────────

describe('validateDataUrl', () => {
  it('rejects non-PNG data URLs', () => {
    expect(() => validateDataUrl('data:image/jpeg;base64,abc')).toThrow('must be a PNG');
    expect(() => validateDataUrl('data:text/html;base64,abc')).toThrow('must be a PNG');
    expect(() => validateDataUrl('https://example.com/img.png')).toThrow('must be a PNG');
  });

  it('rejects oversized data URLs (>10MB)', () => {
    // Create a string just over 10MB
    const oversized = 'data:image/png;base64,' + 'A'.repeat(10 * 1024 * 1024 + 1);
    expect(() => validateDataUrl(oversized)).toThrow('exceeds');
  });

  it('accepts valid PNG data URLs', () => {
    const valid = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    expect(() => validateDataUrl(valid)).not.toThrow();
  });
});
