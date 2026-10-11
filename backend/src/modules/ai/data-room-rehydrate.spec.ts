import { PDFDocument } from 'pdf-lib';
import {
  collectRefs,
  swapRefs,
  buildDataRoomRef,
  DataRoomRefBlock,
  FILE_WINDOW_PROMPTS,
  RefBudget,
} from './data-room-rehydrate';

type Msg = { role: 'user' | 'assistant'; content: any[] };

const BIG: RefBudget = { maxBytes: 1_000_000_000, maxPdfPages: 100_000 };
const opts = (budget: RefBudget = BIG) => ({ windowPrompts: FILE_WINDOW_PROMPTS, budget });

const prompt = (text: string): Msg => ({ role: 'user', content: [{ type: 'text', text }] });
const answer = (text = 'ok'): Msg => ({ role: 'assistant', content: [{ type: 'text', text }] });
const ref = (fileId: string, extra: Partial<DataRoomRefBlock> = {}): DataRoomRefBlock => ({
  type: 'data_room_ref', origin: 'read', fileId, name: `${fileId}.pdf`, mediaType: 'application/pdf', size: 100, pages: 1, ...extra,
});

/** One persisted read: tool_use, tool_result, marker, ref row. */
const readRows = (fileId: string, extra: Partial<DataRoomRefBlock> = {}): Msg[] => [
  { role: 'assistant', content: [{ type: 'tool_use', id: `tu-${fileId}`, name: 'read_data_room_file', input: { fileId } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu-${fileId}`, content: '{}' }] },
  answer('(file content follows)'),
  { role: 'user', content: [ref(fileId, extra)] },
];

/** A prompt that reads `fileId`, then the agent answers. */
const turnWithRead = (fileId: string, extra: Partial<DataRoomRefBlock> = {}): Msg[] => [
  prompt(`read ${fileId}`), ...readRows(fileId, extra), answer(),
];

/** `n` plain prompt/answer turns. */
const plainTurns = (n: number): Msg[] => Array.from({ length: n }, (_, i) => [prompt(`q${i}`), answer()]).flat();

const blocks = (msgs: any[]) => msgs.flatMap((m) => m.content);
const texts = (msgs: any[]) => blocks(msgs).filter((b: any) => b.type === 'text').map((b: any) => b.text as string);
const refs = (msgs: any[]) => blocks(msgs).filter((b: any) => b.type === 'data_room_ref');

describe('collectRefs: 10-message window', () => {
  it('loads a ref read 9 prompts back and stubs one read 11 prompts back', () => {
    // old read, then 1 plain turn, then recent read, then 8 more plain turns, then the new prompt.
    // Recent read: 8 plain + new prompt = 9 prompts after it. Old read: 9 + 1 + 1 = 11.
    const history = [
      ...turnWithRead('old'),
      ...plainTurns(1),
      ...turnWithRead('recent'),
      ...plainTurns(8),
      prompt('new'),
    ];
    const out = collectRefs(history, opts());
    expect(out.load.map((r) => r.fileId)).toEqual(['recent']);
    expect(out.stubFileIds).toEqual(['old']);
    expect(refs(out.messages).map((r: any) => r.fileId)).toEqual(['recent']);

    const swapped = swapRefs(
      out.messages,
      new Map([['recent', [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'R' }, title: 'recent.pdf' } as any]]]),
      new Map([['old', { summary: 'The old file says X.' } as any]]),
    );
    const stub = texts(swapped).find((t) => t.includes('old.pdf'))!;
    expect(stub).toBe(
      '[file old.pdf (fileId old) was read earlier in this conversation; full content pruned to keep this conversation light. Notes: The old file says X. Call get_file_notes for full notes or read_data_room_file for exact text.]',
    );
    expect(blocks(swapped).some((b: any) => b.type === 'document' && b.title === 'recent.pdf')).toBe(true);
  });

  it('a ref exactly 10 prompts back is outside the window', () => {
    const history = [...turnWithRead('f'), ...plainTurns(9), prompt('new')];
    expect(collectRefs(history, opts()).stubFileIds).toEqual(['f']);
  });

  it('does not count tool_result-only rows or read-pointer rows as prompts', () => {
    // Many reads in a single prompt add many tool_result and pointer rows; they
    // must not age the first read out of the window.
    const manyReads = Array.from({ length: 12 }, (_, i) => readRows(`r${i}`)).flat();
    const history = [prompt('read them all'), ...manyReads, answer(), prompt('new')];
    const out = collectRefs(history, opts());
    expect(out.stubFileIds).toEqual([]);
    expect(out.load).toHaveLength(12);
  });

  it('counts an upload-only user row as a prompt and loads its upload ref', () => {
    const upload = ref('u', { origin: 'upload' });
    const history = [{ role: 'user', content: [upload] } as Msg, answer(), ...plainTurns(9), prompt('new')];
    // The upload row is a prompt, 10 prompts after it: out of window.
    expect(collectRefs(history, opts()).stubFileIds).toEqual(['u']);
    const recent = [...plainTurns(2), { role: 'user', content: [upload] } as Msg];
    expect(collectRefs(recent, opts()).load.map((r) => r.fileId)).toEqual(['u']);
  });

  it('re-reading restarts the window: only the newest ref counts', () => {
    const history = [...turnWithRead('f'), ...plainTurns(12), ...turnWithRead('f'), prompt('new')];
    const out = collectRefs(history, opts());
    expect(out.load.map((r) => r.fileId)).toEqual(['f']);
    expect(out.stubFileIds).toEqual([]);
    expect(texts(out.messages)).toContain('[file f.pdf re-read later in this conversation]');
    expect(refs(out.messages)).toHaveLength(1);
  });

  it('dedupes duplicate refs to the last one', () => {
    const history = [prompt('q'), ...readRows('f'), ...readRows('g'), ...readRows('f'), answer(), prompt('new')];
    const out = collectRefs(history, opts());
    expect(out.load.map((r) => r.fileId).sort()).toEqual(['f', 'g']);
    const kept = refs(out.messages);
    expect(kept.map((r: any) => r.fileId)).toEqual(['g', 'f']);
    expect(texts(out.messages).filter((t) => t === '[file f.pdf re-read later in this conversation]')).toHaveLength(1);
  });
});

describe('collectRefs: legacy inline files', () => {
  const inlineDoc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' }, title: 'legacy.pdf' };
  const inlineImg = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } };

  it('stubs inline document/image blocks outside the window and keeps those inside', () => {
    const history = [
      { role: 'user', content: [inlineDoc, inlineImg, { type: 'text', text: 'see attached' }] } as Msg,
      answer(),
      ...plainTurns(10),
      { role: 'user', content: [{ ...inlineDoc, title: 'fresh.pdf' }, { type: 'text', text: 'and this' }] } as Msg,
      answer(),
      prompt('new'),
    ];
    const out = collectRefs(history, opts());
    const all = blocks(out.messages);
    expect(all.filter((b: any) => b.type === 'document').map((b: any) => b.title)).toEqual(['fresh.pdf']);
    expect(all.some((b: any) => b.type === 'image')).toBe(false);
    expect(texts(out.messages)).toEqual(expect.arrayContaining([
      '[attached file legacy.pdf was shared earlier in this conversation; its content is no longer loaded.]',
      '[attached file unnamed was shared earlier in this conversation; its content is no longer loaded.]',
      'see attached',
    ]));
  });

  it('never mutates the input rows', () => {
    const history = [{ role: 'user', content: [inlineDoc] } as Msg, answer(), ...plainTurns(10), prompt('new')];
    const before = structuredClone(history);
    collectRefs(history, opts());
    expect(history).toEqual(before);
  });
});

describe('collectRefs: compaction', () => {
  it('ignores refs before the last compaction block', () => {
    const history = [
      ...turnWithRead('before'),
      { role: 'assistant', content: [{ type: 'compaction', content: '<summary>' }, { type: 'text', text: 'ok' }] } as Msg,
      ...turnWithRead('after'),
      prompt('new'),
    ];
    const out = collectRefs(history, opts());
    expect(out.load.map((r) => r.fileId)).toEqual(['after']);
    expect(out.stubFileIds).toEqual([]);
    expect(refs(out.messages).map((r: any) => r.fileId)).toEqual(['after']);
    // The pre-compaction pointer is not sent raw.
    const swapped = swapRefs(out.messages, new Map());
    expect(refs(swapped)).toHaveLength(0);
    expect(JSON.stringify(swapped)).not.toContain('data_room_ref');
  });
});

describe('collectRefs: budget backstop', () => {
  it('stubs refs over the byte budget, oldest first', () => {
    const history = [
      prompt('q'),
      ...readRows('a', { size: 400, mediaType: 'text/plain', name: 'a.txt', pages: undefined }),
      ...readRows('b', { size: 400, mediaType: 'text/plain', name: 'b.txt', pages: undefined }),
      ...readRows('c', { size: 400, mediaType: 'text/plain', name: 'c.txt', pages: undefined }),
      answer(),
      prompt('new'),
    ];
    const out = collectRefs(history, opts({ maxBytes: 1000, maxPdfPages: 1000 }));
    expect(out.load.map((r) => r.fileId)).toEqual(['c', 'b']);
    expect(out.stubFileIds).toEqual(['a']);
    const swapped = swapRefs(out.messages, new Map(), new Map());
    expect(texts(swapped)).toContain(
      '[file a.txt (fileId a) was read earlier in this conversation; full content pruned to keep this conversation light. Notes: none recorded. Call get_file_notes for full notes or read_data_room_file for exact text.]',
    );
  });

  it('stubs PDFs over the page budget, oldest first', () => {
    const history = [
      prompt('q'),
      ...readRows('a', { pages: 60 }),
      ...readRows('b', { pages: 60 }),
      answer(),
      prompt('new'),
    ];
    const out = collectRefs(history, opts({ maxBytes: 1_000_000, maxPdfPages: 100 }));
    expect(out.load.map((r) => r.fileId)).toEqual(['b']);
    expect(out.stubFileIds).toEqual(['a']);
  });

  it('does not count bytes for a PDF that is sent by Files API id', () => {
    const big = 20 * 1024 * 1024;
    const history = [prompt('q'), ...readRows('a', { size: big }), ...readRows('b', { size: big }), answer(), prompt('new')];
    const out = collectRefs(history, opts({ maxBytes: 10 * 1024 * 1024, maxPdfPages: 600 }));
    expect(out.load).toHaveLength(2);
  });
});

describe('swapRefs', () => {
  it('turns a ref with no loaded blocks into a "no longer available" note', () => {
    const out = collectRefs([prompt('q'), ...readRows('gone'), answer(), prompt('new')], opts());
    const swapped = swapRefs(out.messages, new Map());
    expect(texts(swapped)).toContain('[file gone.pdf no longer available]');
    expect(refs(swapped)).toHaveLength(0);
  });

  it('says an unloadable file could not be loaded, not that it is gone', () => {
    const out = collectRefs([prompt('q'), ...readRows('big'), answer(), prompt('new')], opts());
    const swapped = swapRefs(out.messages, new Map(), new Map(), new Set(['big']));
    expect(texts(swapped)).toContain(
      '[file big.pdf (fileId big) could not be loaded into this request (too large or unsupported); call read_data_room_file for details.]',
    );
    expect(texts(swapped)).not.toContain('[file big.pdf no longer available]');
  });

  it('survives non-string note summaries', () => {
    const history = [...turnWithRead('f'), ...plainTurns(10), prompt('new')];
    const out = collectRefs(history, opts());
    const swapped = swapRefs(out.messages, new Map(), new Map([['f', { summary: { bad: true } } as any]]));
    expect(texts(swapped).some((t) => t.includes('Notes: none recorded.'))).toBe(true);
  });

  it('clips long note summaries to about 600 chars', () => {
    const history = [...turnWithRead('f'), ...plainTurns(10), prompt('new')];
    const out = collectRefs(history, opts());
    const swapped = swapRefs(out.messages, new Map(), new Map([['f', { summary: 'x'.repeat(2000) } as any]]));
    const stub = texts(swapped).find((t) => t.startsWith('[file f.pdf'))!;
    expect(stub.length).toBeLessThan(900);
    expect(stub).toContain('x'.repeat(600) + '...');
  });

  it('keeps strict role alternation and leaves no raw pointer in a mixed history', () => {
    const history: Msg[] = [
      { role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'A' }, title: 'old.pdf' }] },
      answer(),
      ...turnWithRead('a'),
      ...plainTurns(10),
      prompt('q'),
      ...readRows('b'),
      ...readRows('a'),
      ...readRows('gone'),
      answer(),
      { role: 'user', content: [ref('u', { origin: 'upload' }), { type: 'text', text: 'new' }] },
    ];
    const out = collectRefs(history, opts());
    const loaded = new Map(
      out.load.filter((r) => r.fileId !== 'gone').map((r) => [r.fileId, [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: r.fileId }, title: r.name } as any]]),
    );
    const swapped = swapRefs(out.messages, loaded, new Map());
    expect(swapped.map((m) => m.role)).toEqual(history.map((m) => m.role));
    for (let i = 1; i < swapped.length; i++) {
      // Adjacent same-role rows only where the input already had them.
      if (swapped[i].role === swapped[i - 1].role) expect(history[i].role).toBe(history[i - 1].role);
    }
    expect(JSON.stringify(swapped)).not.toContain('data_room_ref');
    expect(swapped.every((m) => Array.isArray(m.content) && m.content.length > 0)).toBe(true);
    const docTitles = blocks(swapped).filter((b: any) => b.type === 'document').map((b: any) => b.title);
    expect(docTitles.sort()).toEqual(['a.pdf', 'b.pdf', 'u.pdf']);
  });
});

describe('buildDataRoomRef', () => {
  it('records size and PDF page count', async () => {
    const doc = await PDFDocument.create();
    doc.addPage(); doc.addPage(); doc.addPage();
    const buf = Buffer.from(await doc.save());
    const r = await buildDataRoomRef({ origin: 'read', fileId: 'f', name: 'f.pdf', mediaType: 'application/pdf', buffer: buf });
    expect(r).toEqual({ type: 'data_room_ref', origin: 'read', fileId: 'f', name: 'f.pdf', mediaType: 'application/pdf', size: buf.length, pages: 3 });
  });

  it('omits pages for non-PDFs and for unparseable PDFs', async () => {
    const txt = await buildDataRoomRef({ origin: 'upload', fileId: 'f', name: 'f.txt', mediaType: 'text/plain', buffer: Buffer.from('hi') });
    expect(txt.pages).toBeUndefined();
    const bad = await buildDataRoomRef({ origin: 'read', fileId: 'f', name: 'f.pdf', mediaType: 'application/pdf', buffer: Buffer.from('nope') });
    expect(bad.pages).toBeUndefined();
    expect(bad.size).toBe(4);
  });
});
