import { CSP_META } from './styles';
import { escapeHtml } from './util';
import { RedlineComment, RedlineData, RedlineEdit } from '../../productions/redline-data';

export interface RedlineRenderOptions {
  mode: 'triage' | 'accepted';
  /** Production name, shown in the header. Falls back to the source file name. */
  productionName?: string;
}

interface Paragraph {
  start: number; // raw offset into baseText, inclusive
  end: number; // raw offset into baseText, exclusive
  text: string;
}

/** Split baseText on '\n\n', tracking each paragraph's raw offset range. */
function splitParagraphs(baseText: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let cursor = 0;
  for (const part of baseText.split('\n\n')) {
    const start = cursor;
    const end = start + part.length;
    paragraphs.push({ start, end, text: part });
    cursor = end + 2; // '\n\n' separator
  }
  return paragraphs;
}

/** Group edits by the paragraph whose raw range contains anchor.start. */
function groupEditsByParagraph(paragraphs: Paragraph[], edits: RedlineEdit[]): RedlineEdit[][] {
  const byPara: RedlineEdit[][] = paragraphs.map(() => []);
  for (const edit of edits) {
    const idx = paragraphs.findIndex((p) => edit.anchor.start >= p.start && edit.anchor.start < p.end);
    if (idx >= 0) byPara[idx].push(edit);
  }
  return byPara;
}

function sortByAnchor(edits: RedlineEdit[]): RedlineEdit[] {
  return [...edits].sort((a, b) => a.anchor.start - b.anchor.start || a.anchor.end - b.anchor.end);
}

/**
 * Render one edit's active mark — the visual del/ins for a proposed or
 * accepted (i.e. non-rejected) edit. Reused by both triage and accepted mode.
 */
function renderActiveMark(edit: RedlineEdit, anchorText: string): string {
  const idAttr = `data-edit-id="${escapeHtml(edit.id)}"`;
  const cls = `class="status-${edit.status}"`;
  switch (edit.kind) {
    case 'replace':
      return `<del ${idAttr} ${cls}>${escapeHtml(anchorText)}</del><ins ${idAttr} ${cls}>${escapeHtml(edit.newText)}</ins>`;
    case 'delete':
      return `<del ${idAttr} ${cls}>${escapeHtml(anchorText)}</del>`;
    case 'insert_after':
      return `${escapeHtml(anchorText)}<ins ${idAttr} ${cls}>${escapeHtml(edit.newText)}</ins>`;
  }
}

interface EndnoteEntry {
  marker: number;
  edit: RedlineEdit;
}

/** Superscript marker for an edit, registering it in `endnotes` (document order). */
function renderMarker(edit: RedlineEdit, endnotes: EndnoteEntry[]): string {
  const marker = endnotes.length + 1;
  endnotes.push({ marker, edit });
  return `<sup class="fn-ref" data-edit-id="${escapeHtml(edit.id)}">[${marker}]</sup>`;
}

/**
 * Render one paragraph in triage mode: every edit in the paragraph is walked
 * in anchor order. Proposed/accepted edits render as active marks; rejected
 * edits render their original text unmarked (dimmed via status-rejected).
 * Every edit — regardless of status — emits a superscript marker linked to
 * the endnote list. If a later edit's anchor overlaps a span already
 * consumed by an earlier one (possible once an edit is rejected and a new
 * edit is proposed over the freed span), only the earlier edit renders the
 * text; the later, overlapping edit still gets its marker.
 */
function renderParagraphTriage(
  para: Paragraph,
  edits: RedlineEdit[],
  endnotes: EndnoteEntry[],
): string {
  const sorted = sortByAnchor(edits);
  let cursor = para.start;
  let out = '';

  for (const edit of sorted) {
    if (edit.anchor.start > cursor) {
      out += escapeHtml(para.text.slice(cursor - para.start, edit.anchor.start - para.start));
      cursor = edit.anchor.start;
    }
    if (edit.anchor.start < cursor) {
      // Span already rendered by an earlier edit — just attach this edit's marker.
      out += renderMarker(edit, endnotes);
      continue;
    }
    const anchorText = para.text.slice(edit.anchor.start - para.start, edit.anchor.end - para.start);
    if (edit.status === 'rejected') {
      out += `<span class="status-rejected" data-edit-id="${escapeHtml(edit.id)}">${escapeHtml(anchorText)}</span>`;
    } else {
      out += renderActiveMark(edit, anchorText);
    }
    out += renderMarker(edit, endnotes);
    cursor = edit.anchor.end;
  }

  out += escapeHtml(para.text.slice(cursor - para.start));
  return `<p class="redline-para">${out}</p>`;
}

/**
 * Render one paragraph in accepted mode: only accepted edits render as
 * marks; proposed/rejected edits are ignored entirely and their spans
 * render as plain base text (no markers, no endnotes).
 */
function renderParagraphAccepted(para: Paragraph, edits: RedlineEdit[]): string {
  const sorted = sortByAnchor(edits.filter((e) => e.status === 'accepted'));
  let cursor = para.start;
  let out = '';

  for (const edit of sorted) {
    if (edit.anchor.start > cursor) {
      out += escapeHtml(para.text.slice(cursor - para.start, edit.anchor.start - para.start));
      cursor = edit.anchor.start;
    }
    if (edit.anchor.start < cursor) continue; // overlapping accepted edit — shouldn't happen, skip defensively
    const anchorText = para.text.slice(edit.anchor.start - para.start, edit.anchor.end - para.start);
    out += renderActiveMark(edit, anchorText);
    cursor = edit.anchor.end;
  }

  out += escapeHtml(para.text.slice(cursor - para.start));
  return `<p class="redline-para">${out}</p>`;
}

function renderEndnotes(endnotes: EndnoteEntry[]): string {
  if (endnotes.length === 0) return '';
  const items = endnotes
    .map(({ marker, edit }) => {
      const parts = [
        `<b>Kind:</b> ${escapeHtml(edit.kind)}`,
        `<b>Status:</b> ${escapeHtml(edit.status)}`,
        `<b>Basis:</b> ${escapeHtml(edit.basis)}`,
      ];
      if (edit.comment) parts.push(`<b>Comment:</b> ${escapeHtml(edit.comment)}`);
      return `<div class="endnote"><span class="endnote-num">[${marker}]</span><span class="endnote-body">${parts.join(' &nbsp; ')}</span></div>`;
    })
    .join('');
  return `<div class="endnotes"><div class="endnotes-title">EDIT NOTES</div>${items}</div>`;
}

function renderReviewerNotes(comments: RedlineComment[]): string {
  if (comments.length === 0) return '';
  const items = comments
    .map(
      (c) =>
        `<div class="reviewer-note"><div class="reviewer-note-title">${escapeHtml(c.title)}</div><div class="reviewer-note-text">${escapeHtml(c.text)}</div></div>`,
    )
    .join('');
  return `<div class="reviewer-notes"><div class="reviewer-notes-title">Reviewer notes</div>${items}</div>`;
}

interface StatusCounts {
  proposed: number;
  accepted: number;
  rejected: number;
}

function countByStatus(edits: RedlineEdit[]): StatusCounts {
  const counts: StatusCounts = { proposed: 0, accepted: 0, rejected: 0 };
  for (const e of edits) counts[e.status] += 1;
  return counts;
}

function renderHeader(data: RedlineData, opts: RedlineRenderOptions, counts: StatusCounts): string {
  const title = escapeHtml(opts.productionName || data.source?.fileName || 'Redline');
  const label = opts.mode === 'accepted' ? 'Redline — accepted edits' : 'Redline — triage';
  const fileName = escapeHtml(data.source?.fileName ?? '');
  const countsHtml =
    opts.mode === 'triage'
      ? `<div class="redline-counts">Proposed: ${counts.proposed} | Accepted: ${counts.accepted} | Rejected: ${counts.rejected}</div>`
      : '';
  return `<div class="redline-header">
    <div class="redline-title">${title}</div>
    <div class="redline-label">${escapeHtml(label)}</div>
    <div class="redline-source">Source: ${fileName}</div>
    ${countsHtml}
  </div>`;
}

function redlineStyles(): string {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; color: #000; font-size: 12pt; line-height: 1.5; }
  .redline-banner { background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; padding: 8pt 12pt; margin-bottom: 12pt; font-weight: bold; font-size: 10pt; }
  .redline-header { margin-bottom: 18pt; border-bottom: 1px solid #999; padding-bottom: 8pt; }
  .redline-title { font-size: 16pt; font-weight: bold; }
  .redline-label { font-size: 11pt; color: #333; margin-top: 2pt; }
  .redline-source { font-size: 10pt; color: #555; margin-top: 4pt; }
  .redline-counts { font-size: 10pt; color: #555; margin-top: 4pt; }
  .redline-body { margin-bottom: 18pt; }
  p.redline-para { margin-bottom: 10pt; text-align: justify; }
  del { color: #b91c1c; text-decoration: line-through; }
  ins { color: #b91c1c; text-decoration: underline; }
  .status-proposed { outline: 1px dashed #b91c1c; outline-offset: 1px; }
  .status-rejected { opacity: 0.55; text-decoration: none; }
  .fn-ref { font-size: 8pt; vertical-align: super; color: #b91c1c; }
  .endnotes { margin-top: 24pt; border-top: 1px solid #999; padding-top: 8pt; }
  .endnotes-title { font-weight: bold; margin-bottom: 8pt; }
  .endnote { margin-bottom: 6pt; font-size: 9pt; }
  .endnote-num { font-weight: bold; margin-right: 4pt; }
  .reviewer-notes { margin-top: 24pt; border-top: 1px solid #999; padding-top: 8pt; }
  .reviewer-notes-title { font-weight: bold; margin-bottom: 8pt; }
  .reviewer-note { margin-bottom: 8pt; font-size: 10pt; }
  .reviewer-note-title { font-weight: bold; }
  `;
}

/**
 * Render a redline production to a full HTML document.
 *
 * mode 'triage': every edit (proposed/accepted/rejected) is shown — active
 * marks for proposed/accepted, dimmed unmarked text for rejected — with a
 * superscript marker per edit linked to an endnote (kind/basis/comment), plus
 * a "Reviewer notes" section for document-level comments and a header with
 * proposed/accepted/rejected counts.
 *
 * mode 'accepted': only accepted edits render as marks; proposed/rejected
 * spans render as plain base text. No endnotes, no reviewer notes — this is
 * the clean, court-ready view.
 *
 * If the source document was a PDF, a banner is rendered near the top
 * flagging that the layout is reconstructed, not the original.
 */
export function renderRedlineHtml(data: RedlineData, opts: RedlineRenderOptions): string {
  const baseText = data.baseText ?? '';
  const paragraphs = splitParagraphs(baseText);
  const editsByPara = groupEditsByParagraph(paragraphs, data.edits ?? []);

  const endnotes: EndnoteEntry[] = [];
  const bodyHtml = paragraphs
    .map((para, i) =>
      opts.mode === 'triage'
        ? renderParagraphTriage(para, editsByPara[i], endnotes)
        : renderParagraphAccepted(para, editsByPara[i]),
    )
    .join('');

  const counts = countByStatus(data.edits ?? []);
  const headerHtml = renderHeader(data, opts, counts);
  const bannerHtml =
    data.source?.kind === 'pdf'
      ? `<div class="redline-banner">Reconstructed redline — layout is not the original document</div>`
      : '';
  const endnotesHtml = opts.mode === 'triage' ? renderEndnotes(endnotes) : '';
  const reviewerNotesHtml = opts.mode === 'triage' ? renderReviewerNotes(data.comments ?? []) : '';

  const title = escapeHtml(opts.productionName || data.source?.fileName || 'Redline');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>${title}</title>
<style>${redlineStyles()}</style>
</head><body>
${bannerHtml}
${headerHtml}
<div class="redline-body">${bodyHtml}</div>
${endnotesHtml}
${reviewerNotesHtml}
</body></html>`;
}
