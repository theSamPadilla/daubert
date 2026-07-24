// backend/src/modules/export/docx-redline.spec.ts
import JSZip = require('jszip');
import { DOMParser } from '@xmldom/xmldom';
import * as mammoth from 'mammoth';

import { applyTrackedChangesToDocx } from './docx-redline';
import { RedlineEdit } from '../productions/redline-data';

const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ---------------------------------------------------------------------------
// Synthetic DOCX builder (no binary fixtures)
// ---------------------------------------------------------------------------

interface RunSpec {
  text: string;
  bold?: boolean;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function runXml(r: RunSpec): string {
  const rPr = r.bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`;
}

function paraXml(runs: RunSpec[]): string {
  return `<w:p>${runs.map(runXml).join('')}</w:p>`;
}

/** Build a minimal valid .docx buffer whose body is the given paragraphs. */
async function buildDocx(paras: RunSpec[][]): Promise<Buffer> {
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

async function readPart(buf: Buffer, name: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file(name);
  return f ? f.async('string') : null;
}

/**
 * Build a .docx buffer with a word/footnotes.xml part in addition to the
 * document body, registered in [Content_Types].xml and
 * word/_rels/document.xml.rels the way a real docx would.
 */
async function buildDocxWithFootnotes(
  paras: RunSpec[][],
  footnoteParas: RunSpec[][],
): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>` +
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
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>` +
      `</Relationships>`,
  );

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${WNS}"><w:body>` +
      paras.map(paraXml).join('') +
      `</w:body></w:document>`,
  );

  zip.file(
    'word/footnotes.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:footnotes xmlns:w="${WNS}">` +
      footnoteParas.map((runs, i) => `<w:footnote w:id="${i + 1}">${paraXml(runs)}</w:footnote>`).join('') +
      `</w:footnotes>`,
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Build a .docx buffer with a pre-existing word/comments.xml part, registered
 * in [Content_Types].xml and word/_rels/document.xml.rels the way a real
 * previously-reviewed docx would.
 */
async function buildDocxWithComments(paras: RunSpec[][], existingCommentsXml: string): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>` +
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
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>` +
      `</Relationships>`,
  );

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${WNS}"><w:body>` +
      paras.map(paraXml).join('') +
      `</w:body></w:document>`,
  );

  zip.file('word/comments.xml', existingCommentsXml);

  return zip.generateAsync({ type: 'nodebuffer' });
}

// The canonical 3-paragraph document used across tests:
//  - Para A splits a sentence across two runs; run 2 is bold.
//  - Para B contains "990 trillion supply" flanked by curly quotes.
//  - Para C is a plain, never-edited paragraph.
function canonicalParas(): RunSpec[][] {
  return [
    [
      { text: 'The defendant transferred ' },
      { text: 'funds to the shell company.', bold: true },
    ],
    [{ text: 'Records show a “990 trillion supply” figure was cited.' }],
    [{ text: 'This closing paragraph remains untouched throughout.' }],
  ];
}

const OPTS = { author: 'Claude', date: '2026-07-24T00:00:00Z' };

function edit(over: Partial<RedlineEdit>): RedlineEdit {
  return {
    id: 'e1',
    kind: 'replace',
    anchor: { text: '', start: 0, end: 0 },
    newText: '',
    basis: 'forensic basis',
    status: 'proposed',
    origin: 'agent',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyTrackedChangesToDocx', () => {
  it('1: replace fully inside one run -> w:del(delText anchor) + adjacent w:ins(newText); surroundings intact', async () => {
    const docx = await buildDocx(canonicalParas());
    const { docx: out, failed } = await applyTrackedChangesToDocx(
      docx,
      [edit({ id: 'r1', kind: 'replace', anchor: { text: 'defendant', start: 0, end: 0 }, newText: 'respondent' })],
      OPTS,
    );

    expect(failed).toHaveLength(0);
    const xml = (await readPart(out, 'word/document.xml'))!;

    // del wraps a delText carrying the anchor text
    expect(xml).toMatch(/<w:del\b[^>]*>[\s\S]*?<w:delText[^>]*>defendant<\/w:delText>[\s\S]*?<\/w:del>/);
    // an ins directly after the del, whose run text is the newText
    expect(xml).toMatch(/<\/w:del><w:ins\b/);
    expect(xml).toMatch(/<w:ins\b[^>]*>[\s\S]*?<w:t[^>]*>respondent<\/w:t>[\s\S]*?<\/w:ins>/);
    // surrounding paragraph text is untouched
    expect(xml).toContain('The ');
    expect(xml).toContain('transferred');
    expect(xml).toContain('funds to the shell company.');
    // no plaintext replacement of the anchor
    expect(xml).not.toMatch(/<w:t[^>]*>respondent transferred/);
  });

  it('2: replace crossing a run boundary -> both fragments in w:del, boundary runs split, bold rPr preserved', async () => {
    const docx = await buildDocx(canonicalParas());
    const { docx: out, failed } = await applyTrackedChangesToDocx(
      docx,
      [
        edit({
          id: 'r2',
          kind: 'replace',
          anchor: { text: 'transferred funds', start: 0, end: 0 },
          newText: 'moved assets',
        }),
      ],
      OPTS,
    );

    expect(failed).toHaveLength(0);
    const xml = (await readPart(out, 'word/document.xml'))!;
    const delBlock = xml.match(/<w:del\b[\s\S]*?<\/w:del>/)![0];

    // both text fragments appear inside the del
    expect(delBlock).toContain('transferred');
    expect(delBlock).toContain('funds');
    // the bold run's rPr survives on its fragment
    expect(delBlock).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:delText[^>]*>funds<\/w:delText>/);
    // boundary runs were split: the non-anchor remainders survive as plain runs
    expect(xml).toContain('The defendant ');
    expect(xml).toContain(' to the shell company.');
    // inserted replacement present
    expect(xml).toMatch(/<w:ins\b[^>]*>[\s\S]*?moved assets[\s\S]*?<\/w:ins>/);
  });

  it('3: delete -> w:del present, no w:ins', async () => {
    const docx = await buildDocx(canonicalParas());
    const { docx: out, failed } = await applyTrackedChangesToDocx(
      docx,
      [edit({ id: 'd1', kind: 'delete', anchor: { text: 'defendant', start: 0, end: 0 }, newText: '' })],
      OPTS,
    );

    expect(failed).toHaveLength(0);
    const xml = (await readPart(out, 'word/document.xml'))!;
    expect(xml).toMatch(/<w:del\b/);
    expect(xml).toMatch(/<w:delText[^>]*>defendant<\/w:delText>/);
    expect(xml).not.toMatch(/<w:ins\b/);
  });

  it('4: insert_after -> w:ins only, after the anchor run, cloning the anchor run rPr', async () => {
    const docx = await buildDocx(canonicalParas());
    const { docx: out, failed } = await applyTrackedChangesToDocx(
      docx,
      [
        edit({
          id: 'i1',
          kind: 'insert_after',
          anchor: { text: 'shell company', start: 0, end: 0 },
          newText: ' (the respondent)',
        }),
      ],
      OPTS,
    );

    expect(failed).toHaveLength(0);
    const xml = (await readPart(out, 'word/document.xml'))!;

    expect(xml).not.toMatch(/<w:del\b/);
    const insBlock = xml.match(/<w:ins\b[\s\S]*?<\/w:ins>/)![0];
    // rPr cloned from the (bold) anchor run
    expect(insBlock).toMatch(/<w:rPr><w:b\/><\/w:rPr>/);
    expect(insBlock).toContain('(the respondent)');
    // placed after the anchor text in document order
    expect(xml.indexOf('shell company')).toBeLessThan(xml.indexOf('<w:ins'));
    // anchor text is not deleted
    expect(xml).toContain('shell company');
  });

  it('5: comments -> comments.xml + content-type override + rels + matching commentRange/Reference ids', async () => {
    const docx = await buildDocx(canonicalParas());
    const { docx: out, failed } = await applyTrackedChangesToDocx(
      docx,
      [
        edit({
          id: 'c1',
          kind: 'replace',
          anchor: { text: '990 trillion supply', start: 0, end: 0 },
          newText: 'roughly 1e12 units',
          basis: 'Contradicts on-chain max supply of 1e12.',
          comment: 'See exhibit 4.',
        }),
      ],
      OPTS,
    );

    expect(failed).toHaveLength(0);

    const commentsXml = (await readPart(out, 'word/comments.xml'))!;
    expect(commentsXml).toContain('Contradicts on-chain max supply of 1e12.');
    expect(commentsXml).toContain('See exhibit 4.');
    expect(commentsXml).toContain('w:author="Claude"');

    const ct = (await readPart(out, '[Content_Types].xml'))!;
    expect(ct).toContain('/word/comments.xml');
    expect(ct).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml');

    const rels = (await readPart(out, 'word/_rels/document.xml.rels'))!;
    expect(rels).toContain('http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments');
    expect(rels).toContain('Target="comments.xml"');

    const docXml = (await readPart(out, 'word/document.xml'))!;
    const startId = docXml.match(/<w:commentRangeStart[^>]*w:id="(\d+)"/)![1];
    expect(docXml).toMatch(new RegExp(`<w:commentRangeEnd[^>]*w:id="${startId}"`));
    expect(docXml).toMatch(new RegExp(`<w:commentReference[^>]*w:id="${startId}"`));
    expect(commentsXml).toMatch(new RegExp(`<w:comment[^>]*w:id="${startId}"`));
  });

  it('6: unlocatable anchor is reported in failed while other edits still apply', async () => {
    const docx = await buildDocx(canonicalParas());
    const { docx: out, failed } = await applyTrackedChangesToDocx(
      docx,
      [
        edit({ id: 'bad', kind: 'replace', anchor: { text: 'nonexistent phrase here', start: 0, end: 0 }, newText: 'x' }),
        edit({ id: 'good', kind: 'replace', anchor: { text: 'defendant', start: 0, end: 0 }, newText: 'respondent' }),
      ],
      OPTS,
    );

    expect(failed).toHaveLength(1);
    expect(failed[0].editId).toBe('bad');
    expect(failed[0].anchorText).toBe('nonexistent phrase here');
    expect(typeof failed[0].reason).toBe('string');

    const xml = (await readPart(out, 'word/document.xml'))!;
    expect(xml).toMatch(/<w:ins\b[^>]*>[\s\S]*?respondent[\s\S]*?<\/w:ins>/);
  });

  it('7: round-trips through mammoth -> unedited paragraphs verbatim; replace shows inserted not deleted text', async () => {
    const docx = await buildDocx(canonicalParas());
    const { docx: out } = await applyTrackedChangesToDocx(
      docx,
      [edit({ id: 'r', kind: 'replace', anchor: { text: 'defendant', start: 0, end: 0 }, newText: 'respondent' })],
      OPTS,
    );

    const res = await mammoth.extractRawText({ buffer: out });
    expect(res.value).toContain('This closing paragraph remains untouched throughout.');
    expect(res.value).toContain('990 trillion supply');
    expect(res.value).toContain('respondent');
    expect(res.value).not.toContain('defendant');
  });

  it('8: output re-parses with zero errors and every revision/comment w:id is unique', async () => {
    const docx = await buildDocx(canonicalParas());
    const { docx: out, failed } = await applyTrackedChangesToDocx(
      docx,
      [
        edit({ id: 'e1', kind: 'replace', anchor: { text: 'defendant', start: 0, end: 0 }, newText: 'respondent', basis: 'b1' }),
        edit({ id: 'e2', kind: 'delete', anchor: { text: 'shell company', start: 0, end: 0 }, newText: '', basis: 'b2' }),
        edit({ id: 'e3', kind: 'insert_after', anchor: { text: '990 trillion supply', start: 0, end: 0 }, newText: ' [sic]', basis: 'b3' }),
      ],
      OPTS,
    );

    expect(failed).toHaveLength(0);

    const docXml = (await readPart(out, 'word/document.xml'))!;
    const commentsXml = (await readPart(out, 'word/comments.xml'))!;

    const errs: string[] = [];
    new DOMParser({ onError: (_l, m) => errs.push(String(m)) }).parseFromString(docXml, 'text/xml');
    new DOMParser({ onError: (_l, m) => errs.push(String(m)) }).parseFromString(commentsXml, 'text/xml');
    expect(errs).toHaveLength(0);

    const ids: string[] = [];
    for (const m of docXml.matchAll(/<w:(?:del|ins)\b[^>]*w:id="(\d+)"/g)) ids.push(m[1]);
    for (const m of commentsXml.matchAll(/<w:comment\b[^>]*w:id="(\d+)"/g)) ids.push(m[1]);

    // replace: del+ins (2), delete: del (1), insert_after: ins (1) => 4 revisions; 3 comments => 7 total
    expect(ids.length).toBe(7);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('9: footnote anchor -> tracked change lands in word/footnotes.xml, with a comments relationship added to footnotes.xml.rels', async () => {
    const docx = await buildDocxWithFootnotes(
      [[{ text: 'Body text with a superscript reference.' }]],
      [[{ text: 'This footnote explains the citation in detail.' }]],
    );
    const { docx: out, failed } = await applyTrackedChangesToDocx(
      docx,
      [
        edit({
          id: 'fn1',
          kind: 'replace',
          anchor: { text: 'explains the citation', start: 0, end: 0 },
          newText: 'clarifies the citation',
          basis: 'Footnote citation needs correction.',
        }),
      ],
      OPTS,
    );

    expect(failed).toHaveLength(0);

    // document.xml is untouched -- the edit landed in the footnote, not the body
    const docXml = (await readPart(out, 'word/document.xml'))!;
    expect(docXml).not.toMatch(/<w:del\b/);
    expect(docXml).not.toMatch(/<w:ins\b/);

    const fnXml = (await readPart(out, 'word/footnotes.xml'))!;
    expect(fnXml).toMatch(
      /<w:del\b[^>]*>[\s\S]*?<w:delText[^>]*>explains the citation<\/w:delText>[\s\S]*?<\/w:del>/,
    );
    expect(fnXml).toMatch(/<w:ins\b[^>]*>[\s\S]*?clarifies the citation[\s\S]*?<\/w:ins>/);

    const fnRels = await readPart(out, 'word/_rels/footnotes.xml.rels');
    expect(fnRels).not.toBeNull();
    expect(fnRels).toContain(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
    );
  });

  it('10: pre-existing comments.xml is preserved, new ids allocate above the existing max, and content-type/rel stay singular', async () => {
    const existingCommentsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="${WNS}"><w:comment w:id="9500" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">` +
      `<w:p><w:r><w:t xml:space="preserve">Pre-existing comment.</w:t></w:r></w:p></w:comment></w:comments>`;
    const docx = await buildDocxWithComments(canonicalParas(), existingCommentsXml);

    const { docx: out, failed } = await applyTrackedChangesToDocx(
      docx,
      [
        edit({
          id: 'r1',
          kind: 'replace',
          anchor: { text: 'defendant', start: 0, end: 0 },
          newText: 'respondent',
          basis: 'new basis',
        }),
      ],
      OPTS,
    );

    expect(failed).toHaveLength(0);

    const commentsXml = (await readPart(out, 'word/comments.xml'))!;
    // (i) existing comment preserved, not discarded
    expect(commentsXml).toContain('w:id="9500"');
    expect(commentsXml).toContain('Pre-existing comment.');

    // (ii) new comment id allocated above the existing max (proves the FIX 2 id scan)
    const commentIds = [...commentsXml.matchAll(/<w:comment\b[^>]*w:id="(\d+)"/g)].map((m) =>
      parseInt(m[1], 10),
    );
    expect(commentIds.length).toBe(2);
    expect(Math.max(...commentIds)).toBeGreaterThan(9500);

    // (iii) idempotency: no duplicate content-type override or relationship
    const ct = (await readPart(out, '[Content_Types].xml'))!;
    expect(ct.match(/PartName="\/word\/comments\.xml"/g)?.length).toBe(1);

    const rels = (await readPart(out, 'word/_rels/document.xml.rels'))!;
    expect(
      rels.match(
        /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/comments"/g,
      )?.length,
    ).toBe(1);
  });
});
