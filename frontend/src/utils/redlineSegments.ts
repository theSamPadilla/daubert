import type { components } from '../generated/api-types';

export type RedlineEdit = components['schemas']['RedlineEdit'];
export type RedlineEditStatus = components['schemas']['RedlineEdit']['status'];

/** How a run of text is displayed in the marked-up document pane. */
export type SegmentRole = 'context' | 'del' | 'ins';

export interface Segment {
  /** The literal text to render. */
  text: string;
  role: SegmentRole;
  /** Present on marked ('del'/'ins') segments — the edit that produced them. */
  editId?: string;
  status?: RedlineEditStatus;
}

/** One rendered document paragraph: an ordered list of segments. */
export type Paragraph = Segment[];

interface ParaRange {
  /** Raw UTF-16 offset of this paragraph's first char in baseText. */
  start: number;
  /** Raw UTF-16 offset just past this paragraph's last char. */
  end: number;
  text: string;
}

/**
 * Split baseText on '\n\n', tracking each paragraph's raw [start, end) offset
 * range so edit anchors (which are offsets into baseText) can be mapped back to
 * the paragraph and slice they belong to.
 */
function splitParagraphs(baseText: string): ParaRange[] {
  const out: ParaRange[] = [];
  let cursor = 0;
  for (const part of baseText.split('\n\n')) {
    const start = cursor;
    const end = start + part.length;
    out.push({ start, end, text: part });
    cursor = end + 2; // account for the '\n\n' separator
  }
  return out;
}

function isShown(status: RedlineEditStatus, filter: Set<RedlineEditStatus> | 'all'): boolean {
  return filter === 'all' || filter.has(status);
}

/**
 * Build the per-paragraph segment lists for rendering baseText with inline
 * redline marks.
 *
 * - Paragraphs come from splitting baseText on '\n\n'; each edit is attributed
 *   to the paragraph containing its `anchor.start`.
 * - Within a paragraph, edits are walked in `anchor.start` order (regardless of
 *   input order) with a cursor emitting plain 'context' between them:
 *     - `replace` → a 'del' (the anchor span) then an 'ins' (newText).
 *     - `delete`  → a 'del' (the anchor span).
 *     - `insert_after` → the anchor stays 'context' (unmarked) then an 'ins'.
 * - An edit whose status is excluded by `statusFilter` renders its span as
 *   plain 'context' (no mark; for insert_after, simply no trailing ins).
 *
 * Offsets from the backend are UTF-16-safe; this function only slices at those
 * boundaries, so it never subdivides a surrogate pair.
 */
export function buildRedlineSegments(
  baseText: string,
  edits: RedlineEdit[],
  statusFilter: Set<RedlineEditStatus> | 'all',
): Paragraph[] {
  const paragraphs = splitParagraphs(baseText);

  const byPara: RedlineEdit[][] = paragraphs.map(() => []);
  for (const edit of edits) {
    const idx = paragraphs.findIndex(
      (p) => edit.anchor.start >= p.start && edit.anchor.start < p.end,
    );
    if (idx >= 0) byPara[idx].push(edit);
  }

  return paragraphs.map((para, i) => buildParagraph(para, byPara[i], statusFilter));
}

function buildParagraph(
  para: ParaRange,
  edits: RedlineEdit[],
  filter: Set<RedlineEditStatus> | 'all',
): Paragraph {
  const segments: Paragraph = [];
  const sorted = [...edits].sort(
    (a, b) => a.anchor.start - b.anchor.start || a.anchor.end - b.anchor.end,
  );
  let cursor = 0; // offset relative to para.text

  const pushContext = (text: string) => {
    if (text.length > 0) segments.push({ text, role: 'context' });
  };

  for (const edit of sorted) {
    // Clamp against the cursor to stay sound if a rejected span was freed and a
    // new edit was proposed overlapping it.
    const aStart = Math.max(edit.anchor.start - para.start, cursor);
    const aEnd = edit.anchor.end - para.start;
    if (aEnd <= cursor) continue; // fully consumed by an earlier edit

    if (aStart > cursor) pushContext(para.text.slice(cursor, aStart));

    const anchorText = para.text.slice(aStart, aEnd);
    const shown = isShown(edit.status, filter);

    if (edit.kind === 'insert_after') {
      pushContext(anchorText); // anchor is never struck
      if (shown && edit.newText.length > 0) {
        segments.push({ text: edit.newText, role: 'ins', editId: edit.id, status: edit.status });
      }
    } else if (!shown) {
      pushContext(anchorText);
    } else if (edit.kind === 'delete') {
      segments.push({ text: anchorText, role: 'del', editId: edit.id, status: edit.status });
    } else {
      // replace
      segments.push({ text: anchorText, role: 'del', editId: edit.id, status: edit.status });
      if (edit.newText.length > 0) {
        segments.push({ text: edit.newText, role: 'ins', editId: edit.id, status: edit.status });
      }
    }

    cursor = Math.max(cursor, aEnd);
  }

  pushContext(para.text.slice(cursor));
  return segments;
}
