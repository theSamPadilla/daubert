// backend/src/modules/export/docx-redline.ts
//
// DOCX tracked-changes engine (SPIKE).
//
// Applies a set of RedlineEdits to a .docx as native Word tracked changes
// (w:ins / w:del) plus comments, leaving all untouched markup byte-faithful
// apart from the edited nodes. Pure function: Buffer in / Buffer out, no
// NestJS injection.
//
// Anchoring reuses Task 1's normalizer/index so an anchor resolves here
// exactly as it did when it was created against baseText.

import JSZip = require('jszip');
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { RedlineEdit, buildNormalizedIndex, normalizeForAnchor } from '../productions/redline-data';

const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

const COMMENTS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

export interface TrackedChangeOpts {
  author: string;
  date: string;
}

export interface FailedEdit {
  editId: string;
  anchorText: string;
  reason: string;
}

export interface TrackedChangeResult {
  docx: Buffer;
  failed: FailedEdit[];
}

/** Minimal XML escaper for text/attribute content built as raw strings. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Small DOM helpers (namespace-aware)
// ---------------------------------------------------------------------------

type El = Element;

function isW(node: Node | null, localName: string): node is El {
  return (
    !!node &&
    node.nodeType === 1 &&
    (node as El).namespaceURI === WNS &&
    (node as El).localName === localName
  );
}

/** Direct element children of `parent` with the given w: local name, in order. */
function childrenW(parent: El, localName: string): El[] {
  const out: El[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (isW(n, localName)) out.push(n as El);
  }
  return out;
}

/** First direct w: child with the given local name, or null. */
function firstChildW(parent: El, localName: string): El | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (isW(n, localName)) return n as El;
  }
  return null;
}

function createW(doc: Document, localName: string): El {
  return doc.createElementNS(WNS, `w:${localName}`) as unknown as El;
}

function setW(el: El, name: string, value: string): void {
  el.setAttributeNS(WNS, `w:${name}`, value);
}

// ---------------------------------------------------------------------------
// Paragraph text model
// ---------------------------------------------------------------------------

interface RunInfo {
  run: El; // the w:r element (a direct child of the paragraph)
  tNode: El; // its w:t element
  text: string; // the raw text of that w:t
  rawStart: number; // offset of this run's first char within the paragraph raw text
}

/**
 * Collect the paragraph's text-bearing runs in document order. Only direct
 * w:r children carrying a w:t are considered — runs already wrapped in
 * w:ins/w:del (from a prior edit in this call) or without text are ignored,
 * so re-scanning after an edit sees only the remaining live text.
 */
function collectRuns(p: El): RunInfo[] {
  const runs: RunInfo[] = [];
  let offset = 0;
  for (let n = p.firstChild; n; n = n.nextSibling) {
    if (!isW(n, 'r')) continue;
    const t = firstChildW(n as El, 't');
    if (!t) continue;
    const text = t.textContent ?? '';
    runs.push({ run: n as El, tNode: t, text, rawStart: offset });
    offset += text.length;
  }
  return runs;
}

function paragraphRawText(runs: RunInfo[]): string {
  let s = '';
  for (const r of runs) s += r.text;
  return s;
}

/** Set a run's single w:t text, marking xml:space=preserve so whitespace survives. */
function setRunText(run: El, text: string): void {
  const t = firstChildW(run, 't');
  if (!t) return;
  t.setAttribute('xml:space', 'preserve');
  t.textContent = text;
}

/**
 * If `boundary` falls strictly inside one of the runs, split that run into two
 * clones (each keeping a duplicated w:rPr), dividing the w:t text between them.
 * Returns true if a split happened.
 */
function splitAtBoundary(p: El, runs: RunInfo[], boundary: number): boolean {
  for (const ri of runs) {
    const start = ri.rawStart;
    const end = ri.rawStart + ri.text.length;
    if (boundary > start && boundary < end) {
      const off = boundary - start;
      const left = ri.run.cloneNode(true) as El;
      const right = ri.run.cloneNode(true) as El;
      setRunText(left, ri.text.slice(0, off));
      setRunText(right, ri.text.slice(off));
      const parent = ri.run.parentNode as El;
      parent.insertBefore(left, ri.run);
      parent.insertBefore(right, ri.run);
      parent.removeChild(ri.run);
      return true;
    }
  }
  return false;
}

/** Convert every direct w:t of a run into a w:delText, preserving xml:space. */
function convertRunToDelText(doc: Document, run: El): void {
  for (const t of childrenW(run, 't')) {
    const dt = createW(doc, 'delText');
    const sp = t.getAttribute('xml:space');
    dt.setAttribute('xml:space', sp || 'preserve');
    dt.appendChild(doc.createTextNode(t.textContent ?? ''));
    (t.parentNode as El).replaceChild(dt, t);
  }
}

/** Build a fresh w:r with a cloned rPr (if any) and a w:t carrying `text`. */
function makeRun(doc: Document, rPrSource: El | null, text: string): El {
  const r = createW(doc, 'r');
  const rPr = rPrSource ? firstChildW(rPrSource, 'rPr') : null;
  if (rPr) r.appendChild(rPr.cloneNode(true));
  const t = createW(doc, 't');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  return r;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

interface ParaRef {
  p: El;
  part: 'document' | 'footnotes';
}

interface Match {
  para: ParaRef;
  normPos: number; // start of the anchor within the paragraph's normalized text
}

/** All matches of `needle` (normalized) across every paragraph, in order. */
function findMatches(paras: ParaRef[], needle: string): Match[] {
  const matches: Match[] = [];
  for (const para of paras) {
    const raw = paragraphRawText(collectRuns(para.p));
    const idx = buildNormalizedIndex(raw);
    let from = 0;
    for (;;) {
      const pos = idx.text.indexOf(needle, from);
      if (pos < 0) break;
      matches.push({ para, normPos: pos });
      from = pos + 1;
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Applying one edit to a located paragraph
// ---------------------------------------------------------------------------

interface CommentRecord {
  id: string;
  part: 'document' | 'footnotes';
  author: string;
  date: string;
  body: string;
}

/**
 * Apply `edit` at normalized position `normPos` within paragraph `para`.
 * Allocates revision/comment ids from `nextId`, records the comment, and
 * mutates the paragraph's DOM in place.
 */
function applyEdit(
  doc: Document,
  para: ParaRef,
  normPos: number,
  needleLen: number,
  edit: RedlineEdit,
  opts: TrackedChangeOpts,
  nextId: () => string,
  comments: CommentRecord[],
): void {
  const p = para.p;

  // Map the normalized match span back to raw offsets in the paragraph text.
  const raw = paragraphRawText(collectRuns(p));
  const idx = buildNormalizedIndex(raw);
  const rawStart = idx.starts[normPos];
  const rawEnd = idx.ends[normPos + needleLen - 1];

  // Split boundary runs so the anchor occupies whole runs. Offsets are stable
  // absolute positions in `raw`, so re-collecting after the first split keeps
  // rawEnd valid.
  splitAtBoundary(p, collectRuns(p), rawStart);
  splitAtBoundary(p, collectRuns(p), rawEnd);

  const runs = collectRuns(p);
  const anchorRuns = runs.filter(
    (r) => r.rawStart >= rawStart && r.rawStart + r.text.length <= rawEnd && r.text.length > 0,
  );
  if (anchorRuns.length === 0) return; // defensive; should not happen once located

  const firstAnchor = anchorRuns[0].run;
  const lastAnchor = anchorRuns[anchorRuns.length - 1].run;
  const parent = firstAnchor.parentNode as El;
  const refNode = lastAnchor.nextSibling; // stable insertion point (may be null)

  const region: Node[] = [];

  if (edit.kind === 'delete' || edit.kind === 'replace') {
    const del = createW(doc, 'del');
    setW(del, 'id', nextId());
    setW(del, 'author', opts.author);
    setW(del, 'date', opts.date);
    const firstRPrSource = anchorRuns[0].run;
    for (const ar of anchorRuns) {
      convertRunToDelText(doc, ar.run);
      del.appendChild(ar.run); // moves the run out of the paragraph body
    }
    region.push(del);

    if (edit.kind === 'replace') {
      const ins = createW(doc, 'ins');
      setW(ins, 'id', nextId());
      setW(ins, 'author', opts.author);
      setW(ins, 'date', opts.date);
      ins.appendChild(makeRun(doc, firstRPrSource, edit.newText));
      region.push(ins);
    }
  } else {
    // insert_after: anchor runs stay; add an ins after them, cloning the last
    // anchor run's rPr.
    const ins = createW(doc, 'ins');
    setW(ins, 'id', nextId());
    setW(ins, 'author', opts.author);
    setW(ins, 'date', opts.date);
    ins.appendChild(makeRun(doc, lastAnchor, edit.newText));
    region.push(ins);
  }

  // Wrap the changed region with a comment range + reference.
  const commentId = nextId();
  const crs = createW(doc, 'commentRangeStart');
  setW(crs, 'id', commentId);
  const cre = createW(doc, 'commentRangeEnd');
  setW(cre, 'id', commentId);
  const refRun = createW(doc, 'r');
  const cref = createW(doc, 'commentReference');
  setW(cref, 'id', commentId);
  refRun.appendChild(cref);

  for (const node of [crs, ...region, cre, refRun]) {
    parent.insertBefore(node, refNode);
  }

  const body = edit.comment ? `${edit.basis}\n${edit.comment}` : edit.basis;
  comments.push({ id: commentId, part: para.part, author: opts.author, date: opts.date, body });
}

// ---------------------------------------------------------------------------
// Package parts: comments.xml, [Content_Types].xml, *.rels
// ---------------------------------------------------------------------------

function commentXml(c: CommentRecord): string {
  const lines = c.body.split('\n');
  const paras = lines
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');
  return (
    `<w:comment w:id="${c.id}" w:author="${escapeXml(c.author)}" w:date="${escapeXml(c.date)}">` +
    paras +
    `</w:comment>`
  );
}

function buildOrAppendComments(existing: string | null, records: CommentRecord[]): string {
  const body = records.map(commentXml).join('');
  // Appending assumes the existing part ends with a literal, w:-prefixed
  // `</w:comments>` closing tag (as our own writer and Word both produce).
  // If a source docx's comments.xml doesn't match that shape (e.g. a
  // self-closing or differently-namespaced root), bail loudly instead of
  // silently discarding whatever comments it already had.
  if (existing && !existing.includes('</w:comments>')) {
    throw new Error('Unsupported comments.xml structure in source document');
  }
  if (existing && existing.includes('</w:comments>')) {
    return existing.replace('</w:comments>', `${body}</w:comments>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:comments xmlns:w="${WNS}">${body}</w:comments>`
  );
}

/** Add the comments override to [Content_Types].xml if not already present. */
function ensureCommentsContentType(contentTypes: string): string {
  if (contentTypes.includes('/word/comments.xml')) return contentTypes;
  const override = `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CONTENT_TYPE}"/>`;
  return contentTypes.replace('</Types>', `${override}</Types>`);
}

/** Add the comments relationship to a rels part, creating the part if absent. */
function ensureCommentsRel(existing: string | null): string {
  if (existing && existing.includes(COMMENTS_REL_TYPE)) return existing;
  if (!existing) {
    existing =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  }
  // Allocate a fresh rId not already used in this part.
  let max = 0;
  for (const m of existing.matchAll(/Id="rId(\d+)"/g)) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  const rel = `<Relationship Id="rId${max + 1}" Type="${COMMENTS_REL_TYPE}" Target="comments.xml"/>`;
  return existing.replace('</Relationships>', `${rel}</Relationships>`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function applyTrackedChangesToDocx(
  docx: Buffer,
  edits: RedlineEdit[],
  opts: TrackedChangeOpts,
): Promise<TrackedChangeResult> {
  const zip = await JSZip.loadAsync(docx);

  const documentEntry = zip.file('word/document.xml');
  if (!documentEntry) {
    throw new Error('Invalid .docx: missing word/document.xml');
  }
  const documentXml = await documentEntry.async('string');
  const doc = new DOMParser().parseFromString(documentXml, 'text/xml') as unknown as Document;

  const footnotesEntry = zip.file('word/footnotes.xml');
  const footnotesDoc = footnotesEntry
    ? (new DOMParser().parseFromString(await footnotesEntry.async('string'), 'text/xml') as unknown as Document)
    : null;

  // Build the ordered list of paragraphs to search/apply against.
  const paras: ParaRef[] = [];
  const docParas = doc.getElementsByTagNameNS(WNS, 'p');
  for (let i = 0; i < docParas.length; i++) paras.push({ p: docParas[i] as El, part: 'document' });
  if (footnotesDoc) {
    const fnParas = footnotesDoc.getElementsByTagNameNS(WNS, 'p');
    for (let i = 0; i < fnParas.length; i++) paras.push({ p: fnParas[i] as El, part: 'footnotes' });
  }

  const failed: FailedEdit[] = [];
  const comments: CommentRecord[] = [];

  // Start the shared revision/comment id counter above any w:id already
  // present in the source, so we never collide with pre-existing revisions
  // or comments in a docx that's been edited/reviewed before.
  let maxId = 9000;
  const scanIds = (xml: string) => {
    for (const m of xml.matchAll(/w:id="(\d+)"/g)) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxId) maxId = n;
    }
  };
  scanIds(documentXml);
  if (footnotesEntry) scanIds(await footnotesEntry.async('string'));
  const existingCommentsForScan = zip.file('word/comments.xml');
  if (existingCommentsForScan) scanIds(await existingCommentsForScan.async('string'));
  let counter = maxId + 1;
  const nextId = () => String(counter++);

  for (const edit of edits) {
    const needle = normalizeForAnchor(edit.anchor.text);
    const matches = findMatches(paras, needle);

    if (matches.length !== 1) {
      failed.push({
        editId: edit.id,
        anchorText: edit.anchor.text,
        reason: matches.length === 0 ? 'anchor_not_found' : `anchor_ambiguous(${matches.length})`,
      });
      continue;
    }

    const m = matches[0];
    const targetDoc = m.para.part === 'footnotes' && footnotesDoc ? footnotesDoc : doc;
    applyEdit(targetDoc, m.para, m.normPos, needle.length, edit, opts, nextId, comments);
  }

  // Re-serialize the edited XML parts. (`doc` is typed as the lib.dom Document
  // for the element helpers; xmldom's XMLSerializer wants its own Node type, so
  // bridge with a cast — the runtime value is an xmldom document.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc as any));
  if (footnotesDoc) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zip.file('word/footnotes.xml', new XMLSerializer().serializeToString(footnotesDoc as any));
  }

  // Wire up comments only if any edit produced one.
  if (comments.length > 0) {
    const commentsEntry = zip.file('word/comments.xml');
    const existingComments = commentsEntry ? await commentsEntry.async('string') : null;
    zip.file('word/comments.xml', buildOrAppendComments(existingComments, comments));

    const ctEntry = zip.file('[Content_Types].xml');
    if (ctEntry) {
      zip.file('[Content_Types].xml', ensureCommentsContentType(await ctEntry.async('string')));
    }

    // Add the comments relationship to whichever part(s) hold comment references.
    const partsWithComments = new Set(comments.map((c) => c.part));
    const relsPathFor: Record<'document' | 'footnotes', string> = {
      document: 'word/_rels/document.xml.rels',
      footnotes: 'word/_rels/footnotes.xml.rels',
    };
    for (const part of partsWithComments) {
      const relsPath = relsPathFor[part];
      const relsEntry = zip.file(relsPath);
      const existingRels = relsEntry ? await relsEntry.async('string') : null;
      zip.file(relsPath, ensureCommentsRel(existingRels));
    }
  }

  const out = await zip.generateAsync({ type: 'nodebuffer' });
  return { docx: out, failed };
}
