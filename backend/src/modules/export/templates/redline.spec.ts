import { renderRedlineHtml } from './redline';
import { RedlineData, RedlineSource } from '../../productions/redline-data';

function makeSource(kind: 'docx' | 'pdf' = 'docx'): RedlineSource {
  return {
    fileId: 'file-1',
    fileName: 'Agreement & Terms.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind,
    extractedAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * Two paragraphs. First contains a replace edit (proposed) and a rejected
 * delete edit; second contains an accepted insert_after edit. Offsets are
 * computed via indexOf so they stay correct if the prose changes.
 */
function makeSample(sourceKind: 'docx' | 'pdf' = 'docx'): RedlineData {
  const para1 = 'The quick brown fox jumps over the lazy dog & <runs> away.';
  const para2 = 'This second paragraph mentions Acme Corp explicitly here.';
  const baseText = `${para1}\n\n${para2}`;

  const replaceAnchor = 'quick brown fox';
  const replaceStart = para1.indexOf(replaceAnchor);
  const replaceEnd = replaceStart + replaceAnchor.length;

  const rejectAnchor = 'lazy dog';
  const rejectStart = para1.indexOf(rejectAnchor);
  const rejectEnd = rejectStart + rejectAnchor.length;

  const acceptAnchor = 'Acme Corp';
  const acceptStartInPara2 = para2.indexOf(acceptAnchor);
  const acceptStart = para1.length + 2 + acceptStartInPara2; // +2 for the '\n\n' separator
  const acceptEnd = acceptStart + acceptAnchor.length;

  return {
    schemaVersion: 1,
    source: makeSource(sourceKind),
    baseText,
    edits: [
      {
        id: 'edit-replace',
        kind: 'replace',
        anchor: { text: replaceAnchor, start: replaceStart, end: replaceEnd },
        newText: 'slow red fox',
        basis: 'Ambiguous species reference in original filing',
        status: 'proposed',
        origin: 'agent',
      },
      {
        id: 'edit-reject',
        kind: 'delete',
        anchor: { text: rejectAnchor, start: rejectStart, end: rejectEnd },
        newText: '',
        basis: 'Redundant modifier',
        comment: 'Discussed with client on call',
        status: 'rejected',
        origin: 'user',
      },
      {
        id: 'edit-accept',
        kind: 'insert_after',
        anchor: { text: acceptAnchor, start: acceptStart, end: acceptEnd },
        newText: ' (a Delaware corporation)',
        basis: 'Clarify corporate identity',
        status: 'accepted',
        origin: 'agent',
      },
    ],
    comments: [{ id: 'c1', title: 'Overall', text: 'Reviewed for consistency across sections.' }],
  };
}

describe('renderRedlineHtml — triage mode', () => {
  it('HTML-escapes base text', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'triage' });
    expect(html).toContain('&amp;');
    expect(html).not.toContain('<runs>');
  });

  it('splits baseText into paragraphs on \\n\\n', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'triage' });
    const paraCount = (html.match(/<p class="redline-para">/g) || []).length;
    expect(paraCount).toBe(2);
    expect(html).toContain('explicitly here');
  });

  it('renders a replace edit as <del>+<ins> with data-edit-id and a status class', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'triage' });
    expect(html).toContain('<del data-edit-id="edit-replace" class="status-proposed">quick brown fox</del>');
    expect(html).toContain('<ins data-edit-id="edit-replace" class="status-proposed">slow red fox</ins>');
  });

  it('renders an insert_after edit with unmarked anchor text followed by <ins>', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'triage' });
    expect(html).toContain('Acme Corp<ins data-edit-id="edit-accept" class="status-accepted"> (a Delaware corporation)</ins>');
  });

  it('renders a rejected edit unmarked (status-rejected class, no <del>/<ins>)', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'triage' });
    expect(html).toContain('<span class="status-rejected" data-edit-id="edit-reject">lazy dog</span>');
    expect(html).not.toContain('<del data-edit-id="edit-reject"');
  });

  it('emits a superscript marker per edit linked to an endnote with kind/basis/comment', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'triage' });
    expect(html).toMatch(/<sup class="fn-ref" data-edit-id="edit-replace">\[\d+\]<\/sup>/);
    expect(html).toMatch(/<sup class="fn-ref" data-edit-id="edit-reject">\[\d+\]<\/sup>/);
    expect(html).toMatch(/<sup class="fn-ref" data-edit-id="edit-accept">\[\d+\]<\/sup>/);
    expect(html).toContain('<b>Kind:</b> replace');
    expect(html).toContain('<b>Basis:</b> Ambiguous species reference in original filing');
    expect(html).toContain('<b>Comment:</b> Discussed with client on call');
    // All three edits produce an endnote entry, even the rejected one.
    expect((html.match(/class="endnote"/g) || []).length).toBe(3);
  });

  it('renders a "Reviewer notes" section for document-level comments', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'triage' });
    expect(html).toContain('Reviewer notes');
    expect(html).toContain('Reviewed for consistency across sections.');
  });

  it('omits the Reviewer notes section when there are no comments', () => {
    const data = { ...makeSample(), comments: [] };
    const html = renderRedlineHtml(data, { mode: 'triage' });
    expect(html).not.toContain('Reviewer notes');
  });

  it('header shows productionName, source fileName, and proposed/accepted/rejected counts', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'triage', productionName: 'Widmann Redline Draft' });
    expect(html).toContain('Widmann Redline Draft');
    expect(html).toContain('Agreement &amp; Terms.docx');
    expect(html).toContain('Proposed: 1 | Accepted: 1 | Rejected: 1');
  });

  it('falls back to the source fileName in the header when productionName is absent', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'triage' });
    expect(html).toContain('<div class="redline-title">Agreement &amp; Terms.docx</div>');
  });

  it('does not render the PDF-source banner for a docx source', () => {
    const html = renderRedlineHtml(makeSample('docx'), { mode: 'triage' });
    expect(html).not.toContain('Reconstructed redline');
  });
});

describe('renderRedlineHtml — accepted mode', () => {
  it('marks only accepted edits; proposed and rejected edits render as plain unmarked text', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'accepted' });
    // accepted insert_after still marked
    expect(html).toContain('Acme Corp<ins data-edit-id="edit-accept" class="status-accepted"> (a Delaware corporation)</ins>');
    // proposed replace renders as plain original text, no del/ins
    expect(html).toContain('quick brown fox');
    expect(html).not.toContain('<del data-edit-id="edit-replace"');
    expect(html).not.toContain('slow red fox');
    // rejected delete renders as plain original text, no span wrapper
    expect(html).toContain('lazy dog');
    expect(html).not.toContain('<span class="status-rejected"');
  });

  it('omits endnotes and reviewer notes entirely', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'accepted' });
    expect(html).not.toMatch(/<sup class="fn-ref"/);
    expect(html).not.toContain('Reviewer notes');
    expect(html).not.toContain('EDIT NOTES');
  });

  it('header label reads "Redline — accepted edits"', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'accepted' });
    expect(html).toContain('Redline — accepted edits');
  });

  it('header omits the proposed/accepted/rejected counts row', () => {
    const html = renderRedlineHtml(makeSample(), { mode: 'accepted' });
    expect(html).not.toContain('<div class="redline-counts">');
  });
});

describe('renderRedlineHtml — pdf source banner', () => {
  it('renders the reconstructed-layout banner near the top when source.kind is "pdf"', () => {
    const html = renderRedlineHtml(makeSample('pdf'), { mode: 'triage' });
    expect(html).toContain('Reconstructed redline — layout is not the original document');
    // Banner appears before the body content.
    expect(html.indexOf('redline-banner')).toBeLessThan(html.indexOf('redline-body'));
  });

  it('renders the banner in accepted mode too', () => {
    const html = renderRedlineHtml(makeSample('pdf'), { mode: 'accepted' });
    expect(html).toContain('Reconstructed redline — layout is not the original document');
  });
});

describe('renderRedlineHtml — snapshots', () => {
  it('matches the triage-mode snapshot for the sample document', () => {
    expect(renderRedlineHtml(makeSample(), { mode: 'triage', productionName: 'Widmann Redline Draft' })).toMatchSnapshot();
  });

  it('matches the accepted-mode snapshot for the sample document', () => {
    expect(renderRedlineHtml(makeSample(), { mode: 'accepted', productionName: 'Widmann Redline Draft' })).toMatchSnapshot();
  });

  it('matches the pdf-source snapshot', () => {
    expect(renderRedlineHtml(makeSample('pdf'), { mode: 'triage', productionName: 'Widmann Redline Draft' })).toMatchSnapshot();
  });
});
