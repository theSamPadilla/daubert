// backend/src/modules/productions/redline-data.ts

export interface RedlineSource {
  fileId: string; // data_room_files.id at snapshot time
  fileName: string;
  mimeType: string;
  kind: 'docx' | 'pdf';
  extractedAt: string; // ISO timestamp
}

export interface RedlineAnchor {
  text: string; // the verbatim quoted span as matched in baseText (raw, not normalized)
  start: number; // raw char offset into baseText, inclusive
  end: number; // raw char offset, exclusive
}

export type RedlineEditKind = 'replace' | 'delete' | 'insert_after';
export type RedlineEditStatus = 'proposed' | 'accepted' | 'rejected';

export interface RedlineEdit {
  id: string; // server-generated UUID
  kind: RedlineEditKind;
  anchor: RedlineAnchor;
  newText: string; // '' for kind 'delete'
  basis: string; // the forensic justification
  comment?: string; // optional extra drafting note
  status: RedlineEditStatus; // always 'proposed' on creation
  origin: 'agent' | 'user';
}

export interface RedlineComment {
  // document-level cover note
  id: string;
  title: string;
  text: string;
}

export interface RedlineData {
  schemaVersion: 1;
  source: RedlineSource;
  baseText: string; // immutable snapshot; paragraphs separated by '\n\n'
  edits: RedlineEdit[];
  comments: RedlineComment[];
}

const CHAR_MAP: Record<string, string> = {
  '‘': "'", // ‘
  '’': "'", // ’
  '“': '"', // “
  '”': '"', // ”
  ' ': ' ', // NBSP
  '‑': '-', // non-breaking hyphen
  'ﬁ': 'fi', // ﬁ
  'ﬂ': 'fl', // ﬂ
};

export const MIN_ANCHOR_LENGTH = 8;

/** Normalize text for anchor matching. Whitespace runs collapse to one space. */
export function normalizeForAnchor(s: string): string {
  return mapChars(s).replace(/\s+/g, ' ').trim();
}

function mapChars(s: string): string {
  let out = '';
  for (const ch of s) out += CHAR_MAP[ch] ?? ch;
  return out;
}

interface NormalizedIndex {
  text: string;
  starts: number[];
  ends: number[];
}

/**
 * Build normalized text plus per-normalized-char raw [start, end) offsets,
 * in a single pass over the raw string. Avoids the O(n^2) blowup of
 * re-deriving raw offsets per anchor lookup on large documents.
 */
export function buildNormalizedIndex(raw: string): NormalizedIndex {
  const textParts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  let inRun = false;
  let runStart = -1;
  let runEnd = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const s = i;
    const e = i + 1;
    const mapped = CHAR_MAP[ch] ?? ch;

    for (const outCh of mapped) {
      if (/\s/.test(outCh)) {
        if (!inRun) {
          inRun = true;
          runStart = s;
        }
        runEnd = e;
      } else {
        if (inRun) {
          // Collapse the pending whitespace run to a single space, unless
          // it's leading whitespace (nothing emitted yet) — matches trim().
          if (textParts.length > 0) {
            textParts.push(' ');
            starts.push(runStart);
            ends.push(runEnd);
          }
          inRun = false;
        }
        textParts.push(outCh);
        starts.push(s);
        ends.push(e);
      }
    }
  }
  // Trailing whitespace run (if any) is dropped — matches trim().

  return { text: textParts.join(''), starts, ends };
}

export type AnchorResolution =
  | { start: number; end: number }
  | { error: 'anchor_too_short' | 'anchor_not_found' | 'anchor_crosses_paragraphs' }
  | { error: 'anchor_ambiguous'; count: number };

export function resolveAnchor(baseText: string, anchorText: string): AnchorResolution {
  const needle = normalizeForAnchor(anchorText);
  if (needle.length < MIN_ANCHOR_LENGTH) return { error: 'anchor_too_short' };

  const idx = buildNormalizedIndex(baseText);
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const p = idx.text.indexOf(needle, from);
    if (p < 0) break;
    positions.push(p);
    from = p + 1;
  }

  if (positions.length === 0) return { error: 'anchor_not_found' };
  if (positions.length > 1) return { error: 'anchor_ambiguous', count: positions.length };

  const p = positions[0];
  const start = idx.starts[p];
  const end = idx.ends[p + needle.length - 1];
  if (baseText.slice(start, end).includes('\n')) return { error: 'anchor_crosses_paragraphs' };
  return { start, end };
}

/** Adjacent/touching spans do NOT overlap. */
export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function seedRedlineData(source: RedlineSource, baseText: string): RedlineData {
  return { schemaVersion: 1, source, baseText, edits: [], comments: [] };
}
