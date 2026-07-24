// backend/src/modules/data-room/file-text.spec.ts
import JSZip = require('jszip');
import * as XLSX from 'xlsx';

import {
  extractFileForMcp,
  MCP_EXTRACTED_TEXT_CHAR_LIMIT,
  MCP_IMAGE_MAX_BYTES,
} from './file-text';

const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---------------------------------------------------------------------------
// Minimal synthetic DOCX builder (mirrors the pattern in
// productions/redline-extract.spec.ts / export/docx-redline.spec.ts) — no
// binary fixtures.
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

describe('extractFileForMcp', () => {
  it('docx: extracts paragraph text into a single text block', async () => {
    const docx = await buildDocx(['First paragraph text.', 'Second paragraph text.']);

    const blocks = await extractFileForMcp(docx, DOCX_MIME, 'doc.docx');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('First paragraph text.');
    expect(text).toContain('Second paragraph text.');
  });

  it('csv: decodes utf8 text and returns a text block', async () => {
    const blocks = await extractFileForMcp(Buffer.from('a,b\n1,2'), 'text/csv', 'x.csv');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect((blocks[0] as { type: 'text'; text: string }).text).toContain('a,b');
  });

  it('txt: falls back to latin1 decode with a note prefix when utf8 mojibakes', async () => {
    // 0xE9 alone is invalid utf8 continuation-less byte -> decodes to U+FFFD in utf8,
    // but is 'é' in latin1.
    const buf = Buffer.from([0x68, 0x69, 0xe9]);
    const blocks = await extractFileForMcp(buf, 'text/plain', 'x.txt');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('[note:');
    expect(text).toContain('latin1');
    expect(text).toContain('hié');
  });

  it('xlsx: extracts sheet marker and cell value into a text block', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['Header1', 'Header2'], ['val1', 'val2']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const blocks = await extractFileForMcp(buf, XLSX_MIME, 'book.xlsx');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('--- Sheet: Sheet1 ---');
    expect(text).toContain('val1');
  });

  it('image png within cap: returns an image block with base64 data', async () => {
    const buf = Buffer.from('not-a-real-png-but-small', 'utf8');
    const blocks = await extractFileForMcp(buf, 'image/png', 'pic.png');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'image',
      data: buf.toString('base64'),
      mimeType: 'image/png',
    });
  });

  it('image over cap: returns a text note block instead of image data', async () => {
    const buf = Buffer.alloc(MCP_IMAGE_MAX_BYTES + 1);
    const blocks = await extractFileForMcp(buf, 'image/png', 'big.png');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('too large');
    expect(text).toContain('big.png');
  });

  it('unsupported mime: returns a single text note block without throwing', async () => {
    const blocks = await extractFileForMcp(Buffer.from('whatever'), 'application/zip', 'x.zip');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
  });

  it('legacy .xls: returns a text note explaining it is unsupported', async () => {
    const blocks = await extractFileForMcp(
      Buffer.from('whatever'),
      'application/vnd.ms-excel',
      'legacy.xls',
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text.toLowerCase()).toContain('.xls');
    expect(text.toLowerCase()).toContain('.xlsx');
  });

  it('pdf: joins per-page text with a blank line', async () => {
    jest.resetModules();
    jest.doMock('unpdf', () => ({
      getDocumentProxy: jest.fn(async () => ({})),
      extractText: jest.fn(async () => ({ text: ['page one', 'page two'] })),
    }));

    // Re-require after mocking so the module under test picks up the mock.
    const { extractFileForMcp: extractFileForMcpMocked } = require('./file-text');

    const blocks = await extractFileForMcpMocked(
      Buffer.from('fake-pdf-bytes'),
      'application/pdf',
      'doc.pdf',
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect((blocks[0] as { type: 'text'; text: string }).text).toBe('page one\n\npage two');

    jest.dontMock('unpdf');
    jest.resetModules();
  });

  it('caps extracted text at MCP_EXTRACTED_TEXT_CHAR_LIMIT with a truncation suffix', async () => {
    const big = Buffer.from('a'.repeat(700_000), 'utf8');
    const blocks = await extractFileForMcp(big, 'text/plain', 'big.txt');

    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text.length).toBeLessThan(700_000);
    expect(text).toContain(`[truncated at ${MCP_EXTRACTED_TEXT_CHAR_LIMIT} chars`);
    expect(text).toContain('original was 700000 chars');
  });
});
