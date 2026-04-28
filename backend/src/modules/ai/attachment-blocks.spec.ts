import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { buildAttachmentBlocks } from './attachment-blocks';

const FIX_DIR = path.resolve(__dirname, '../../../test/fixtures');

const PDF_B64_LIMIT = 6_200_000;
const IMG_B64_LIMIT = 6_800_000;
const COMPRESSED_B64_LIMIT = 6_200_000;
const CSV_B64_LIMIT = 1_500_000;
const EXTRACTED_TEXT_CHAR_LIMIT = 600_000;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// 1×1 transparent PNG
const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// "%PDF-1.4\n%EOF" minimal PDF magic header (not a parseable PDF, but enough to test the wrapper)
const TINY_PDF = Buffer.from('%PDF-1.4\n%EOF\n', 'utf8').toString('base64');

function b64(s: string | Buffer): string {
  return Buffer.isBuffer(s) ? s.toString('base64') : Buffer.from(s, 'utf8').toString('base64');
}

function makeOversizeB64(charLen: number): string {
  // Repeat 'A' to make a base64-shaped payload of the required length.
  return 'A'.repeat(charLen);
}

describe('buildAttachmentBlocks', () => {
  it('returns [] for undefined / empty', async () => {
    expect(await buildAttachmentBlocks(undefined)).toEqual([]);
    expect(await buildAttachmentBlocks([])).toEqual([]);
  });

  // ── PDF ─────────────────────────────────────────────────────────────────
  describe('PDF', () => {
    it('happy path → document block with base64 source', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'doc.pdf', mediaType: 'application/pdf', data: TINY_PDF },
      ]);
      expect(blocks).toHaveLength(1);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source).toMatchObject({
        type: 'base64',
        media_type: 'application/pdf',
        data: TINY_PDF,
      });
      expect(b.title).toBe('doc.pdf');
    });

    it('oversize → size stub mentioning PDF', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'big.pdf', mediaType: 'application/pdf', data: makeOversizeB64(PDF_B64_LIMIT + 1) },
      ]);
      expect(blocks).toHaveLength(1);
      const b: any = blocks[0];
      expect(b.type).toBe('text');
      expect(b.text).toContain('PDF');
      expect(b.text).toContain('big.pdf');
      expect(b.text).toContain('too large');
    });
  });

  // ── Image ───────────────────────────────────────────────────────────────
  describe('image', () => {
    it('happy path → image block', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'tiny.png', mediaType: 'image/png', data: PNG_1x1_B64 },
      ]);
      expect(blocks).toHaveLength(1);
      const b: any = blocks[0];
      expect(b.type).toBe('image');
      expect(b.source).toMatchObject({
        type: 'base64',
        media_type: 'image/png',
        data: PNG_1x1_B64,
      });
    });

    it('oversize → size stub', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'big.png', mediaType: 'image/png', data: makeOversizeB64(IMG_B64_LIMIT + 1) },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('text');
      expect(b.text).toContain('image');
      expect(b.text).toContain('big.png');
    });
  });

  // ── CSV ─────────────────────────────────────────────────────────────────
  describe('CSV', () => {
    it('happy path → plain-text document with title', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'data.csv', mediaType: 'text/csv', data: b64('name,age\nA,1\nB,2\n') },
      ]);
      expect(blocks).toHaveLength(1);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source).toMatchObject({ type: 'text', media_type: 'text/plain' });
      expect(b.source.data).toContain('name,age');
      expect(b.title).toBe('data.csv');
    });

    it('UTF-8 BOM is stripped', async () => {
      const withBom = '\uFEFFname,age\nA,1\n';
      const blocks = await buildAttachmentBlocks([
        { name: 'bom.csv', mediaType: 'text/csv', data: b64(withBom) },
      ]);
      const b: any = blocks[0];
      expect(b.source.data.charCodeAt(0)).not.toBe(0xFEFF);
      expect(b.source.data.startsWith('name,age')).toBe(true);
    });

    it('non-UTF-8 latin1 → fallback decode with note prefix', async () => {
      // 'café' encoded in latin1: c=0x63 a=0x61 f=0x66 é=0xE9
      const latin1Bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
      const blocks = await buildAttachmentBlocks([
        { name: 'cafe.csv', mediaType: 'text/csv', data: latin1Bytes.toString('base64') },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source.data.startsWith('[note: CSV decoded as latin1')).toBe(true);
      expect(b.source.data).toContain('café');
    });

    it('oversize → size stub mentioning CSV', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'big.csv', mediaType: 'text/csv', data: makeOversizeB64(CSV_B64_LIMIT + 1) },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('text');
      expect(b.text).toContain('CSV');
    });

    it('mime ambiguity: vnd.ms-excel + .csv → CSV', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'win.csv', mediaType: 'application/vnd.ms-excel', data: b64('a,b\n1,2\n') },
      ]);
      expect(blocks).toHaveLength(1);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.title).toBe('win.csv');
    });

    // Legacy .xls coverage moved to the dedicated 'legacy .xls rejection' describe
    // block below — vnd.ms-excel + non-.csv now emits an explicit unsupported stub
    // rather than silently dropping.

    it('truncates extracted CSV text past EXTRACTED_TEXT_CHAR_LIMIT', async () => {
      // Build a CSV whose decoded text is >limit but whose b64 is <CSV_B64_LIMIT.
      // EXTRACTED_TEXT_CHAR_LIMIT (600k) < CSV_B64_LIMIT (1.5M), so a 700k-char
      // raw text fits the upload cap but exceeds the extraction cap.
      const big = 'a'.repeat(EXTRACTED_TEXT_CHAR_LIMIT + 1000);
      const blocks = await buildAttachmentBlocks([
        { name: 'big-text.csv', mediaType: 'text/csv', data: b64(big) },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source.data).toContain('[truncated at');
      expect(b.source.data).toContain('CSV');
      // Should be capped near the limit (plus the truncation marker).
      expect(b.source.data.length).toBeLessThan(EXTRACTED_TEXT_CHAR_LIMIT + 200);
    });
  });

  // ── TXT ─────────────────────────────────────────────────────────────────
  describe('TXT', () => {
    it('happy path → plain-text document block', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'notes.txt', mediaType: 'text/plain', data: b64('hello world\nsecond line') },
      ]);
      expect(blocks).toHaveLength(1);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source).toMatchObject({ type: 'text', media_type: 'text/plain' });
      expect(b.title).toBe('notes.txt');
      expect(b.source.data).toContain('hello world');
    });

    it('text/plain with non-.txt/.csv filename is not classified', async () => {
      // text/plain is mime-ambiguous (covers .csv, .txt, .log, .json, etc.). Without
      // an extension match we cannot know the user's intent, so drop. The DTO
      // whitelist accepts text/plain, so this guard is the actual gate.
      const blocks = await buildAttachmentBlocks([
        { name: 'mystery.log', mediaType: 'text/plain', data: b64('lines of stuff') },
      ]);
      expect(blocks).toEqual([]);
    });

    it('octet-stream + .txt is accepted', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'data.txt', mediaType: 'application/octet-stream', data: b64('plain') },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source.data).toContain('plain');
    });

    it('.md with text/markdown mime → plain-text document block', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'README.md', mediaType: 'text/markdown', data: b64('# Title\n\nbody') },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.title).toBe('README.md');
      expect(b.source.data).toContain('# Title');
    });

    it('.md with text/plain mime is also accepted (browsers vary)', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'notes.md', mediaType: 'text/plain', data: b64('## heading') },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source.data).toContain('## heading');
    });

    it('size-stub mentions "text file" not "CSV" for oversize .txt', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'big.txt', mediaType: 'text/plain', data: makeOversizeB64(CSV_B64_LIMIT + 1) },
      ]);
      expect((blocks[0] as any).text).toContain('text file');
    });
  });

  // ── Legacy .xls (vnd.ms-excel without .csv extension) ───────────────────
  describe('legacy .xls rejection', () => {
    it('emits an unsupported stub instead of silently dropping', async () => {
      const blocks = await buildAttachmentBlocks([
        {
          name: 'old-spreadsheet.xls',
          mediaType: 'application/vnd.ms-excel',
          data: b64('whatever'),
        },
      ]);
      expect(blocks).toHaveLength(1);
      const b: any = blocks[0];
      expect(b.type).toBe('text');
      expect(b.text).toContain('old-spreadsheet.xls');
      expect(b.text).toContain('legacy .xls');
      expect(b.text).toContain('.xlsx');
    });

    it('does not stub when vnd.ms-excel mime is paired with a .csv filename', async () => {
      // Excel-on-Windows mislabels CSVs with this mime — that is the whole reason
      // the alias is in the whitelist. The .csv filename must take precedence.
      const blocks = await buildAttachmentBlocks([
        {
          name: 'data.csv',
          mediaType: 'application/vnd.ms-excel',
          data: b64('a,b\n1,2\n'),
        },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source.data).toContain('a,b');
    });
  });

  // ── XLSX ────────────────────────────────────────────────────────────────
  describe('XLSX', () => {
    it('happy path → document block with sheet separators', async () => {
      const xlsxBuf = fs.readFileSync(path.join(FIX_DIR, 'tiny.xlsx'));
      const blocks = await buildAttachmentBlocks([
        { name: 'tiny.xlsx', mediaType: XLSX_MIME, data: xlsxBuf.toString('base64') },
      ]);
      expect(blocks).toHaveLength(1);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source.media_type).toBe('text/plain');
      expect(b.source.data).toContain('--- Sheet: Sheet1 ---');
      expect(b.source.data).toContain('--- Sheet: Sheet2 ---');
      expect(b.source.data).toContain('name,age');
      expect(b.title).toBe('tiny.xlsx');
    });

    it('oversize upload → size stub mentioning spreadsheet', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'big.xlsx', mediaType: XLSX_MIME, data: makeOversizeB64(COMPRESSED_B64_LIMIT + 1) },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('text');
      expect(b.text).toContain('spreadsheet');
    });

    it('corrupted bytes → failed-to-parse text block', async () => {
      // ZIP magic header followed by garbage triggers an XLSX.read throw
      // ("Unsupported ZIP encryption"). Plain non-ZIP bytes are silently
      // parsed as an empty workbook, so we use ZIP-shaped garbage here.
      const corruptedZip = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('garbage-after-zip-magic-bytes'),
      ]);
      const blocks = await buildAttachmentBlocks([
        { name: 'bad.xlsx', mediaType: XLSX_MIME, data: corruptedZip.toString('base64') },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('text');
      expect(b.text).toContain('Failed to parse spreadsheet');
      expect(b.text).toContain('bad.xlsx');
    });

    it('truncates extracted CSV text past EXTRACTED_TEXT_CHAR_LIMIT', async () => {
      // The XLSX binary format inflates b64 size faster than CSV output grows
      // (and zstring-cell limits cap any single highly-compressible cell), so a
      // real workbook large enough to exceed EXTRACTED_TEXT_CHAR_LIMIT also
      // exceeds COMPRESSED_B64_LIMIT in practice. Stub sheet_to_csv to exercise
      // the truncation path directly — same pattern as the DOCX truncation
      // test below.
      const long = 'x'.repeat(EXTRACTED_TEXT_CHAR_LIMIT + 1000);
      const spy = jest
        .spyOn(XLSX.utils, 'sheet_to_csv')
        .mockReturnValue(long);
      try {
        const xlsxBuf = fs.readFileSync(path.join(FIX_DIR, 'tiny.xlsx'));
        const blocks = await buildAttachmentBlocks([
          { name: 'big.xlsx', mediaType: XLSX_MIME, data: xlsxBuf.toString('base64') },
        ]);
        const b: any = blocks[0];
        expect(b.type).toBe('document');
        expect(b.source.data).toContain('[truncated at');
        expect(b.source.data).toContain('spreadsheet');
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ── DOCX ────────────────────────────────────────────────────────────────
  describe('DOCX', () => {
    it('happy path → document block with extracted text', async () => {
      const docxBuf = fs.readFileSync(path.join(FIX_DIR, 'tiny.docx'));
      const blocks = await buildAttachmentBlocks([
        { name: 'tiny.docx', mediaType: DOCX_MIME, data: docxBuf.toString('base64') },
      ]);
      expect(blocks).toHaveLength(1);
      const b: any = blocks[0];
      expect(b.type).toBe('document');
      expect(b.source.media_type).toBe('text/plain');
      expect(b.source.data).toContain('Hello world from a DOCX.');
      expect(b.title).toBe('tiny.docx');
    });

    it('oversize upload → size stub mentioning document', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'big.docx', mediaType: DOCX_MIME, data: makeOversizeB64(COMPRESSED_B64_LIMIT + 1) },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('text');
      expect(b.text).toContain('document');
    });

    it('corrupted bytes → failed-to-parse text block', async () => {
      const blocks = await buildAttachmentBlocks([
        { name: 'bad.docx', mediaType: DOCX_MIME, data: b64('not a real docx') },
      ]);
      const b: any = blocks[0];
      expect(b.type).toBe('text');
      expect(b.text).toContain('Failed to parse document');
      expect(b.text).toContain('bad.docx');
    });

    it('truncates extracted text past EXTRACTED_TEXT_CHAR_LIMIT', async () => {
      // Stub mammoth's extractRawText to return a synthetic long string,
      // bypassing the need to construct a giant real DOCX.
      const mammoth = require('mammoth');
      const long = 'x'.repeat(EXTRACTED_TEXT_CHAR_LIMIT + 1000);
      const spy = jest
        .spyOn(mammoth, 'extractRawText')
        .mockResolvedValue({ value: long, messages: [] } as any);
      try {
        // Use the real fixture so size-cap check passes.
        const docxBuf = fs.readFileSync(path.join(FIX_DIR, 'tiny.docx'));
        const blocks = await buildAttachmentBlocks([
          { name: 'long.docx', mediaType: DOCX_MIME, data: docxBuf.toString('base64') },
        ]);
        const b: any = blocks[0];
        expect(b.type).toBe('document');
        expect(b.source.data).toContain('[truncated at');
        expect(b.source.data).toContain('document');
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ── Unknown ─────────────────────────────────────────────────────────────
  it('unknown media type → no block produced', async () => {
    const blocks = await buildAttachmentBlocks([
      { name: 'thing.zip', mediaType: 'application/zip', data: b64('x') },
    ]);
    expect(blocks).toEqual([]);
  });

  // ── Multiple attachments preserved in order ─────────────────────────────
  it('handles multiple attachments in order', async () => {
    const blocks = await buildAttachmentBlocks([
      { name: 'a.pdf', mediaType: 'application/pdf', data: TINY_PDF },
      { name: 'b.csv', mediaType: 'text/csv', data: b64('a,b\n1,2\n') },
      { name: 'c.png', mediaType: 'image/png', data: PNG_1x1_B64 },
    ]);
    expect(blocks).toHaveLength(3);
    expect((blocks[0] as any).type).toBe('document');
    expect((blocks[1] as any).type).toBe('document');
    expect((blocks[2] as any).type).toBe('image');
  });
});

// Regression coverage for ALLOWED_MEDIA_TYPES whitelist
import { ALLOWED_MEDIA_TYPES } from './dto/chat-message.dto';

describe('ALLOWED_MEDIA_TYPES', () => {
  it('includes the natively-supported native types', () => {
    expect(ALLOWED_MEDIA_TYPES).toEqual(
      expect.arrayContaining([
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf',
        XLSX_MIME,
        DOCX_MIME,
      ]),
    );
  });
  it('includes CSV mime aliases', () => {
    expect(ALLOWED_MEDIA_TYPES).toEqual(
      expect.arrayContaining(['text/csv', 'application/csv', 'application/vnd.ms-excel']),
    );
  });
});
