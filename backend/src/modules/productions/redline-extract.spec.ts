// backend/src/modules/productions/redline-extract.spec.ts
import JSZip = require('jszip');
import { BadRequestException } from '@nestjs/common';

import { extractBaseText, normalizeNewlines, joinPdfPages, DOCX_MIME } from './redline-extract';

const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ---------------------------------------------------------------------------
// Minimal synthetic DOCX builder (mirrors the Task 2 pattern in
// docx-redline.spec.ts) — no binary fixtures.
// ---------------------------------------------------------------------------

function paraXml(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function buildDocx(paras: string[]): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );

  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${WNS}"><w:body>` +
      paras.map(paraXml).join('') +
      `</w:body></w:document>`,
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractBaseText', () => {
  it('DOCX: extracts three paragraphs separated by \\n\\n, LF only, no trailing whitespace', async () => {
    const docx = await buildDocx(['First para.', 'Second para.', 'Third para.']);

    const result = await extractBaseText(docx, DOCX_MIME);

    expect(result.kind).toBe('docx');
    expect(result.text).toBe('First para.\n\nSecond para.\n\nThird para.');
    expect(result.text).not.toMatch(/\r/);
    expect(result.text).not.toMatch(/\s+$/);
  });

  it('throws BadRequestException for an unsupported mime type', async () => {
    await expect(extractBaseText(Buffer.from('hello'), 'text/plain')).rejects.toThrow(
      BadRequestException,
    );
    await expect(extractBaseText(Buffer.from('hello'), 'image/png')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('normalizeNewlines', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeNewlines('alpha\r\nbeta')).toBe('alpha\nbeta');
  });

  it('converts lone CR to LF', () => {
    expect(normalizeNewlines('alpha\rbeta')).toBe('alpha\nbeta');
  });

  it('strips trailing spaces and tabs on each line', () => {
    expect(normalizeNewlines('alpha  \nbeta\t\t\ngamma')).toBe('alpha\nbeta\ngamma');
  });

  it('collapses runs of 3+ consecutive LFs down to exactly 2', () => {
    expect(normalizeNewlines('alpha\n\n\n\nbeta\n\n\ngamma')).toBe('alpha\n\nbeta\n\ngamma');
  });

  it('does not collapse a single or double LF', () => {
    expect(normalizeNewlines('alpha\nbeta\n\ngamma')).toBe('alpha\nbeta\n\ngamma');
  });

  it('trims leading and trailing whitespace/newlines from the whole string', () => {
    expect(normalizeNewlines('\n\n  alpha beta  \n\n')).toBe('alpha beta');
  });
});

describe('joinPdfPages', () => {
  it('joins pages with \\n\\n and normalizes the result', () => {
    expect(joinPdfPages(['Page one text.', 'Page two text.', 'Page three text.'])).toBe(
      'Page one text.\n\nPage two text.\n\nPage three text.',
    );
  });

  it('normalizes CRLF and trailing whitespace within joined pages', () => {
    expect(joinPdfPages(['Line one.  \r\nLine two.', 'Page two.\n\n\n'])).toBe(
      'Line one.\nLine two.\n\nPage two.',
    );
  });

  it('returns an empty string for an empty pages array', () => {
    expect(joinPdfPages([])).toBe('');
  });
});
