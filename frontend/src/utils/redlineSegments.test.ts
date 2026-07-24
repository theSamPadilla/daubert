import { buildRedlineSegments } from './redlineSegments';
import type { RedlineEdit, RedlineEditStatus } from './redlineSegments';

// ── Fixture builder ──────────────────────────────────────────────────────────

function mkEdit(
  id: string,
  kind: RedlineEdit['kind'],
  start: number,
  end: number,
  text: string,
  newText: string,
  status: RedlineEditStatus = 'proposed',
): RedlineEdit {
  return {
    id,
    kind,
    anchor: { text, start, end },
    newText,
    basis: 'basis',
    status,
    origin: 'agent',
  };
}

describe('buildRedlineSegments', () => {
  it('renders a replace as adjacent del + ins carrying editId + status', () => {
    // "The quick brown fox jumps." — "quick brown" = [4, 15)
    const base = 'The quick brown fox jumps.';
    const edits = [mkEdit('e1', 'replace', 4, 15, 'quick brown', 'swift red')];

    const [para] = buildRedlineSegments(base, edits, 'all');

    expect(para).toEqual([
      { text: 'The ', role: 'context' },
      { text: 'quick brown', role: 'del', editId: 'e1', status: 'proposed' },
      { text: 'swift red', role: 'ins', editId: 'e1', status: 'proposed' },
      { text: ' fox jumps.', role: 'context' },
    ]);
  });

  it('renders a delete as a single del segment', () => {
    // "one two three four five." — "four five" = [14, 23)
    const base = 'one two three four five.';
    const edits = [mkEdit('d1', 'delete', 14, 23, 'four five', '')];

    const [para] = buildRedlineSegments(base, edits, 'all');

    expect(para).toEqual([
      { text: 'one two three ', role: 'context' },
      { text: 'four five', role: 'del', editId: 'd1', status: 'proposed' },
      { text: '.', role: 'context' },
    ]);
  });

  it('renders insert_after as unmarked anchor context followed by an ins', () => {
    // "Alpha beta gamma delta." — "Alpha beta" = [0, 10)
    const base = 'Alpha beta gamma delta.';
    const edits = [mkEdit('i1', 'insert_after', 0, 10, 'Alpha beta', ' INSERTED')];

    const [para] = buildRedlineSegments(base, edits, 'all');

    expect(para).toEqual([
      { text: 'Alpha beta', role: 'context' },
      { text: ' INSERTED', role: 'ins', editId: 'i1', status: 'proposed' },
      { text: ' gamma delta.', role: 'context' },
    ]);
  });

  it('renders a filtered-out edit as plain context (no marks)', () => {
    const base = 'The quick brown fox jumps.';
    const edits = [mkEdit('e1', 'replace', 4, 15, 'quick brown', 'swift red', 'rejected')];

    // rejected is excluded from the active filter
    const filter = new Set<RedlineEditStatus>(['proposed', 'accepted']);
    const [para] = buildRedlineSegments(base, edits, filter);

    expect(para.every((s) => s.role === 'context')).toBe(true);
    expect(para.map((s) => s.text).join('')).toBe(base);
  });

  it('maps each edit to the paragraph containing its anchor', () => {
    // Para 0 = [0, 21); "\n\n" at 21,22; Para 1 starts at 23.
    // "Second paragraph" = [23, 39)
    const base = 'First paragraph here.\n\nSecond paragraph here.';
    const edits = [mkEdit('e1', 'delete', 23, 39, 'Second paragraph', '')];

    const paragraphs = buildRedlineSegments(base, edits, 'all');

    expect(paragraphs).toHaveLength(2);
    // Para 0 untouched — a single context segment
    expect(paragraphs[0]).toEqual([{ text: 'First paragraph here.', role: 'context' }]);
    // Para 1 carries the del
    expect(paragraphs[1]).toContainEqual({
      text: 'Second paragraph',
      role: 'del',
      editId: 'e1',
      status: 'proposed',
    });
  });

  it('emits edits sorted by anchor.start regardless of input order', () => {
    // "one two three four five." — "one two" = [0, 7), "four five" = [14, 23)
    const base = 'one two three four five.';
    // Provided out of order (B before A)
    const edits = [
      mkEdit('B', 'replace', 14, 23, 'four five', 'FF'),
      mkEdit('A', 'replace', 0, 7, 'one two', 'X'),
    ];

    const [para] = buildRedlineSegments(base, edits, 'all');

    const editIdsInOrder = para.filter((s) => s.editId).map((s) => s.editId);
    // A's segments come before B's
    expect(editIdsInOrder).toEqual(['A', 'A', 'B', 'B']);
  });

  it('renders two edits in one paragraph with correct context between them', () => {
    // "one two three four five." — A replace [0,7), B delete [14,23)
    const base = 'one two three four five.';
    const edits = [
      mkEdit('A', 'replace', 0, 7, 'one two', '1 2'),
      mkEdit('B', 'delete', 14, 23, 'four five', ''),
    ];

    const [para] = buildRedlineSegments(base, edits, 'all');

    expect(para).toEqual([
      { text: 'one two', role: 'del', editId: 'A', status: 'proposed' },
      { text: '1 2', role: 'ins', editId: 'A', status: 'proposed' },
      { text: ' three ', role: 'context' },
      { text: 'four five', role: 'del', editId: 'B', status: 'proposed' },
      { text: '.', role: 'context' },
    ]);
  });

  it('never splits a surrogate pair in the context between edits', () => {
    // "AAAAAAAA 😀 BBBBBBBB done." — 😀 is a UTF-16 surrogate pair at [9, 11)
    const base = 'AAAAAAAA 😀 BBBBBBBB done.';
    const edits = [
      mkEdit('A', 'replace', 0, 8, 'AAAAAAAA', 'a'),
      mkEdit('B', 'replace', 12, 20, 'BBBBBBBB', 'b'),
    ];

    const [para] = buildRedlineSegments(base, edits, 'all');

    const context = para.find((s) => s.role === 'context');
    expect(context?.text).toBe(' 😀 ');
    // the emoji code point survives intact
    expect(context?.text).toContain('😀');
  });
});
