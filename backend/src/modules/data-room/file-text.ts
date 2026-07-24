// backend/src/modules/data-room/file-text.ts
//
// Pure file -> MCP content block extractor. Provider-neutral sibling of
// ../ai/attachment-blocks.ts (which returns Anthropic-shaped blocks). This
// module never throws for a supported-but-corrupt file -- it returns a text
// note block instead, so callers (MCP tool handlers) can always hand the
// result straight back to the model.

import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }; // data = base64

/** Hard cap on extracted text handed back to the model, regardless of source. */
export const MCP_EXTRACTED_TEXT_CHAR_LIMIT = 600_000;

/** Inline image cap -- above this we return a text note instead of image bytes. */
export const MCP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const STRIP_BOM = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

function truncate(text: string): string {
  if (text.length <= MCP_EXTRACTED_TEXT_CHAR_LIMIT) return text;
  return (
    text.slice(0, MCP_EXTRACTED_TEXT_CHAR_LIMIT) +
    `\n\n[truncated at ${MCP_EXTRACTED_TEXT_CHAR_LIMIT} chars; original was ${text.length} chars]`
  );
}

function textBlock(text: string): McpContentBlock[] {
  return [{ type: 'text', text: truncate(text) }];
}

function note(text: string): McpContentBlock[] {
  return [{ type: 'text', text }];
}

/** Recognised CSV mime-type aliases (mirrors attachment-blocks.ts). */
const CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel', // what Excel-on-Windows often emits
  'application/octet-stream', // when the OS doesn't know
  'text/plain', // some browsers
  '', // some browsers (drag/drop)
]);

/** Plain-text mime aliases. Excludes vnd.ms-excel -- that is CSV-only. */
const TXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/octet-stream',
  '',
]);

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Kind = 'pdf' | 'image' | 'xlsx' | 'docx' | 'csv' | 'txt';

/**
 * Decide how to treat a file. Mime types are unreliable across
 * browsers/OSes, so we fall back to file-extension sniffing for the
 * ambiguous CSV/TXT cases -- exactly like attachment-blocks.classify().
 */
function classify(mimeType: string, name: string): Kind | null {
  const lower = name.toLowerCase();
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType === 'image/png' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/gif' ||
    mimeType === 'image/webp'
  ) {
    return 'image';
  }
  if (mimeType === XLSX_MIME) return 'xlsx';
  if (mimeType === DOCX_MIME) return 'docx';
  if (CSV_MIME_TYPES.has(mimeType) && lower.endsWith('.csv')) return 'csv';
  if (TXT_MIME_TYPES.has(mimeType) && (lower.endsWith('.txt') || lower.endsWith('.md'))) return 'txt';
  return null;
}

/** Decode a text buffer as UTF-8, falling back to latin1 if it mojibakes. */
function decodeText(buf: Buffer, label: string): string {
  let text = STRIP_BOM(buf.toString('utf8'));
  if (text.includes('�')) {
    text = STRIP_BOM(buf.toString('latin1'));
    text = `[note: ${label} decoded as latin1; if the source was UTF-8 the bytes were corrupted]\n${text}`;
  }
  return text;
}

export async function extractFileForMcp(
  buffer: Buffer,
  mimeType: string,
  name: string,
): Promise<McpContentBlock[]> {
  // Catch legacy .xls before classify() drops it: application/vnd.ms-excel is
  // whitelisted as a CSV mime alias (Excel-on-Windows mislabels CSVs), so an
  // .xls binary would otherwise fall through classify() unrecognized.
  if (mimeType === 'application/vnd.ms-excel' && !name.toLowerCase().endsWith('.csv')) {
    return note(
      `[File "${name}" appears to be a legacy .xls file, which is not supported. Re-save as .xlsx and re-attach.]`,
    );
  }

  const kind = classify(mimeType, name);
  if (!kind) {
    return note(`[File "${name}" has an unsupported type (${mimeType || 'unknown'}) and could not be read.]`);
  }

  if (kind === 'docx') {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      return textBlock(value);
    } catch {
      return note(`[Failed to parse document "${name}". The file may be corrupted or password-protected.]`);
    }
  }

  if (kind === 'pdf') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: false });
      return textBlock((text as string[]).join('\n\n'));
    } catch {
      return note(`[Failed to parse PDF "${name}". The file may be corrupted or password-protected.]`);
    }
  }

  if (kind === 'xlsx') {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheets = workbook.SheetNames.map(
        (sheetName) => `--- Sheet: ${sheetName} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}`,
      );
      return textBlock(sheets.join('\n\n'));
    } catch {
      return note(`[Failed to parse spreadsheet "${name}". The file may be corrupted.]`);
    }
  }

  if (kind === 'csv') {
    return textBlock(decodeText(buffer, 'CSV'));
  }

  if (kind === 'txt') {
    return textBlock(decodeText(buffer, 'text file'));
  }

  // kind === 'image'
  if (buffer.length <= MCP_IMAGE_MAX_BYTES) {
    return [{ type: 'image', data: buffer.toString('base64'), mimeType }];
  }
  const mb = (buffer.length / (1024 * 1024)).toFixed(1);
  return note(`[Image "${name}" (${mb} MB) is too large to return inline. Ask the user for a smaller version.]`);
}
