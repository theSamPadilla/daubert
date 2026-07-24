// backend/src/modules/productions/redline-extract.ts
//
// Extracts an immutable base-text snapshot from a redline source document.
// DOCX-first (mammoth); PDF is a labeled reconstruction fallback (unpdf).

import * as mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { BadRequestException } from '@nestjs/common';

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Normalize extracted text before it becomes an immutable snapshot:
 * - CRLF and lone CR collapse to LF.
 * - Trailing spaces/tabs are stripped from every line.
 * - Runs of 3+ consecutive LFs collapse to exactly 2, so paragraph gaps stay
 *   `\n\n` (mammoth's extractRawText emits a trailing `\n\n` per paragraph,
 *   including the last one — this is what removes that trailing gap).
 * - Leading/trailing whitespace on the whole string is trimmed.
 */
export function normalizeNewlines(s: string): string {
  let out = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/** Join per-page PDF text into a single paragraph-separated document. */
export function joinPdfPages(pages: string[]): string {
  return normalizeNewlines(pages.join('\n\n'));
}

export async function extractBaseText(
  buffer: Buffer,
  mimeType: string,
): Promise<{ kind: 'docx' | 'pdf'; text: string }> {
  if (mimeType === DOCX_MIME) {
    const { value } = await mammoth.extractRawText({ buffer });
    return { kind: 'docx', text: normalizeNewlines(value) };
  }
  if (mimeType === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    return { kind: 'pdf', text: joinPdfPages(text) };
  }
  throw new BadRequestException(
    `Unsupported redline source type: ${mimeType}. Upload a .docx (preferred) or .pdf.`,
  );
}
