import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';
import type Anthropic from '@anthropic-ai/sdk';

/** Anthropic's hard limits on raw bytes (×0.75 of base64 char count). */
const PDF_B64_LIMIT = 6_200_000;   // ~4.5 MB raw
const IMG_B64_LIMIT = 6_800_000;   // ~5 MB raw
/** XLSX/DOCX are compressed binaries; cap the *upload* generously and gate truncation
 *  on the post-extraction text length below. */
const COMPRESSED_B64_LIMIT = 6_200_000;
/** CSV is already the post-extraction payload — much tighter envelope. */
const CSV_B64_LIMIT = 1_500_000;   // ~1.1 MB raw text ≈ 250-300k tokens

/** Hard cap on extracted text we hand the model, regardless of source. ~150-200k tokens. */
const EXTRACTED_TEXT_CHAR_LIMIT = 600_000;

const STRIP_BOM = (s: string) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

function truncate(text: string, source: string): string {
  if (text.length <= EXTRACTED_TEXT_CHAR_LIMIT) return text;
  return (
    text.slice(0, EXTRACTED_TEXT_CHAR_LIMIT) +
    `\n\n[truncated at ${EXTRACTED_TEXT_CHAR_LIMIT} chars; original ${source} was ${text.length} chars]`
  );
}

function plainTextDocument(name: string, text: string): Anthropic.Beta.BetaContentBlockParam {
  return {
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: text },
    title: name,
  } as any;
}

function sizeStub(name: string, b64Len: number, kind: string): Anthropic.Beta.BetaContentBlockParam {
  const mb = (b64Len * 0.75 / 1_048_576).toFixed(1);
  return {
    type: 'text',
    text: `[Attached ${kind} "${name}" (${mb} MB) is too large to process. Ask the user for the relevant excerpt.]`,
  };
}

/** Recognised CSV mime-type aliases. Order matters only for readability. */
const CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',           // what Excel-on-Windows often emits
  'application/octet-stream',           // when the OS doesn't know
  'text/plain',                          // some browsers
  '',                                    // some browsers (drag/drop)
]);

/** Plain-text mime aliases. Excludes vnd.ms-excel — that is CSV-only. */
const TXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/octet-stream',
  '',
]);

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface AttachmentInput {
  name: string;
  mediaType: string;
  data: string; // base64
}

/**
 * Decide how to treat an attachment. Mime types are unreliable across
 * browsers/OSes, so we fall back to file-extension sniffing for the
 * ambiguous CSV case.
 */
function classify(att: AttachmentInput): 'pdf' | 'image' | 'xlsx' | 'docx' | 'csv' | 'txt' | null {
  const mt = att.mediaType;
  const lower = att.name.toLowerCase();
  if (mt === 'application/pdf') return 'pdf';
  if (mt === 'image/jpeg' || mt === 'image/png' || mt === 'image/gif' || mt === 'image/webp') return 'image';
  if (mt === XLSX_MIME) return 'xlsx';
  if (mt === DOCX_MIME) return 'docx';
  if (CSV_MIME_TYPES.has(mt) && lower.endsWith('.csv')) return 'csv';
  if (TXT_MIME_TYPES.has(mt) && (lower.endsWith('.txt') || lower.endsWith('.md'))) return 'txt';
  return null;
}

export async function buildAttachmentBlocks(
  attachments: AttachmentInput[] | undefined,
): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  if (!attachments?.length) return [];
  const out: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const att of attachments) {
    // Catch legacy .xls before classify() drops it: application/vnd.ms-excel is
    // whitelisted as a CSV mime alias (Excel-on-Windows mislabels CSVs), so an
    // .xls binary clears the DTO. Emit an explicit stub rather than silently
    // skipping — the user otherwise sees a chip and the model sees nothing.
    if (
      att.mediaType === 'application/vnd.ms-excel' &&
      !att.name.toLowerCase().endsWith('.csv')
    ) {
      out.push({
        type: 'text',
        text: `[Attached "${att.name}" appears to be a legacy .xls file, which is not supported. Re-save as .xlsx and re-attach.]`,
      });
      continue;
    }
    const kind = classify(att);
    if (!kind) continue; // DTO whitelist already rejects unknowns; defensive only.

    if (kind === 'pdf') {
      if (att.data.length > PDF_B64_LIMIT) { out.push(sizeStub(att.name, att.data.length, 'PDF')); continue; }
      out.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: att.data },
        title: att.name,
      } as any);
      continue;
    }

    if (kind === 'image') {
      if (att.data.length > IMG_B64_LIMIT) { out.push(sizeStub(att.name, att.data.length, 'image')); continue; }
      out.push({
        type: 'image',
        source: { type: 'base64', media_type: att.mediaType as any, data: att.data },
      });
      continue;
    }

    if (kind === 'csv' || kind === 'txt') {
      const label = kind === 'csv' ? 'CSV' : 'text file';
      if (att.data.length > CSV_B64_LIMIT) { out.push(sizeStub(att.name, att.data.length, label)); continue; }
      const buf = Buffer.from(att.data, 'base64');
      // UTF-8 with BOM strip. Excel-on-Windows often produces Windows-1252.
      // utf8 decode of cp1252 bytes silently mojibakes; sniff for the replacement char
      // pattern and fall back to latin1 with a warning prefix.
      let text = STRIP_BOM(buf.toString('utf8'));
      if (text.includes('\uFFFD')) {
        text = STRIP_BOM(buf.toString('latin1'));
        text = `[note: ${label} decoded as latin1; if the source was UTF-8 the bytes were corrupted]\n${text}`;
      }
      out.push(plainTextDocument(att.name, truncate(text, label)));
      continue;
    }

    if (kind === 'xlsx') {
      if (att.data.length > COMPRESSED_B64_LIMIT) { out.push(sizeStub(att.name, att.data.length, 'spreadsheet')); continue; }
      try {
        const workbook = XLSX.read(Buffer.from(att.data, 'base64'), { type: 'buffer' });
        const sheets = workbook.SheetNames.map(
          (name) => `--- Sheet: ${name} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`,
        );
        out.push(plainTextDocument(att.name, truncate(sheets.join('\n\n'), 'spreadsheet')));
      } catch {
        out.push({ type: 'text', text: `[Failed to parse spreadsheet "${att.name}". The file may be corrupted.]` });
      }
      continue;
    }

    if (kind === 'docx') {
      if (att.data.length > COMPRESSED_B64_LIMIT) { out.push(sizeStub(att.name, att.data.length, 'document')); continue; }
      try {
        // extractRawText flattens tables, lists, headings, and footnotes. If users
        // hit this limitation, escalate to mammoth.convertToHtml + sanitization
        // and emit a BetaContentBlockSource document instead.
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(att.data, 'base64') });
        out.push(plainTextDocument(att.name, truncate(value, 'document')));
      } catch {
        out.push({ type: 'text', text: `[Failed to parse document "${att.name}". The file may be corrupted or password-protected.]` });
      }
      continue;
    }
  }
  return out;
}
