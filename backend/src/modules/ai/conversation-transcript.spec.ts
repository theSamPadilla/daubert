import { MessageEntity } from '../../database/entities/message.entity';
import { buildTranscript, transcriptToText, TranscriptEntry } from './conversation-transcript';
import { STOP_NOTES, TOOL_RESULT_TERMINATOR } from './runs/run-abort';

let clock = Date.parse('2026-10-01T10:00:00.000Z');

function row(role: 'user' | 'assistant', content: unknown[]): MessageEntity {
  clock += 1000;
  return {
    id: `m-${clock}`,
    conversationId: 'c1',
    role,
    content,
    createdAt: new Date(clock),
    updatedAt: new Date(clock),
  } as MessageEntity;
}

const text = (t: string) => ({ type: 'text', text: t });
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: 'tool_use', id, name, input });
const toolResult = (id: string, result: unknown) => ({
  type: 'tool_result',
  tool_use_id: id,
  content: typeof result === 'string' ? result : JSON.stringify(result),
});

const actions = (entries: TranscriptEntry[]) =>
  entries.filter((e): e is Extract<TranscriptEntry, { kind: 'action' }> => e.kind === 'action');

describe('buildTranscript', () => {
  it('renders a plain chat as user and assistant turns with timestamps', () => {
    const u = row('user', [text('What happened to the funds?')]);
    const a = row('assistant', [{ type: 'thinking', thinking: 'hmm', signature: 'x' }, text('They moved to **Binance**.')]);
    const entries = buildTranscript([u, a]);
    expect(entries).toEqual([
      { kind: 'user', at: u.createdAt.toISOString(), text: 'What happened to the funds?', attachments: [] },
      { kind: 'assistant', at: a.createdAt.toISOString(), markdown: 'They moved to **Binance**.' },
    ]);
  });

  it('pairs tool_use with tool_result across rows; tool_result rows are not user turns', () => {
    const entries = buildTranscript([
      row('user', [text('Load the skill')]),
      row('assistant', [text('Loading it.'), toolUse('t1', 'get_skill', { name: 'productions' })]),
      row('user', [toolResult('t1', { content: 'skill body' })]),
      row('assistant', [text('Done.')]),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(['user', 'assistant', 'action', 'assistant']);
    expect(actions(entries)[0]).toMatchObject({ label: 'Loaded skill', target: 'productions', failed: false });
  });

  it('flags a failed tool from its { error } result', () => {
    const entries = buildTranscript([
      row('assistant', [toolUse('t1', 'create_investigation', { name: 'Hack' })]),
      row('user', [toolResult('t1', { error: 'No case context.' })]),
    ]);
    expect(actions(entries)[0]).toMatchObject({ label: 'Created investigation', target: 'Hack', failed: true });
  });

  it('flags execute_script with status error', () => {
    const entries = buildTranscript([
      row('assistant', [toolUse('t1', 'execute_script', { name: 'trace hops', code: '...' })]),
      row('user', [toolResult('t1', { status: 'timeout' })]),
    ]);
    expect(actions(entries)[0]).toMatchObject({ label: 'Ran script', target: 'trace hops', failed: true });
  });

  it('treats an unparseable (truncated) result as not failed', () => {
    const entries = buildTranscript([
      row('assistant', [toolUse('t1', 'update_production', { productionId: 'p1' })]),
      row('user', [toolResult('t1', '{"error": "boom", "name": "Rep...[truncated]')]),
    ]);
    expect(actions(entries)[0]).toMatchObject({ label: 'Updated production', failed: false });
    expect(actions(entries)[0].target).toBeUndefined();
  });

  it('treats a tool_use with no result as not failed', () => {
    const entries = buildTranscript([row('assistant', [toolUse('t1', 'get_case_data')])]);
    expect(actions(entries)).toEqual([
      { kind: 'action', at: expect.any(String), label: 'Read case data', failed: false },
    ]);
  });

  it('read_data_room_file targets the file name from the result, falling back when absent', () => {
    const entries = buildTranscript([
      row('assistant', [
        toolUse('t1', 'read_data_room_file', { fileId: '3f2b7c1e-1111-4222-8333-444455556666' }),
        toolUse('t2', 'read_data_room_file', { fileId: '3f2b7c1e-1111-4222-8333-777788889999' }),
        toolUse('t3', 'read_data_room_file', { fileId: '3f2b7c1e-1111-4222-8333-000000000000' }),
      ]),
      row('user', [
        toolResult('t1', { name: 'Affidavit.pdf', mimeType: 'application/pdf', size: 10 }),
        toolResult('t2', { error: 'File "Huge.pdf" is too large', name: 'Huge.pdf' }),
        toolResult('t3', { error: 'File not found in this case.' }),
      ]),
    ]);
    expect(actions(entries)).toEqual([
      { kind: 'action', at: expect.any(String), label: 'Read data room file', target: 'Affidavit.pdf', failed: false },
      { kind: 'action', at: expect.any(String), label: 'Read data room file', target: 'Huge.pdf', failed: true },
      { kind: 'action', at: expect.any(String), label: 'Read data room file', target: 'a data room file', failed: true },
    ]);
    expect(JSON.stringify(entries)).not.toContain('3f2b7c1e');
  });

  it('production tools target the production name from the result, never the id', () => {
    const entries = buildTranscript([
      row('assistant', [
        toolUse('t1', 'create_production', { name: 'Draft', type: 'report', data: {} }),
        toolUse('t2', 'read_production', { productionId: 'prod-123' }),
        toolUse('t3', 'update_production', { productionId: 'prod-123' }),
      ]),
      row('user', [
        toolResult('t1', { id: 'prod-123', name: 'Flow of Funds', type: 'report' }),
        toolResult('t2', { id: 'prod-123', name: 'Flow of Funds', type: 'report' }),
        toolResult('t3', { error: 'Production not found' }),
      ]),
    ]);
    expect(actions(entries).map((a) => [a.label, a.target, a.failed])).toEqual([
      ['Created production', 'Flow of Funds', false],
      ['Read production', 'Flow of Funds', false],
      ['Updated production', undefined, true],
    ]);
    expect(JSON.stringify(entries)).not.toContain('prod-123');
  });

  it('a failed create_production falls back to the input name', () => {
    const entries = buildTranscript([
      row('assistant', [toolUse('t1', 'create_production', { name: 'Draft', type: 'report', data: {} })]),
      row('user', [toolResult('t1', { error: 'Invalid data' })]),
    ]);
    expect(actions(entries).map((a) => [a.label, a.target, a.failed])).toEqual([['Created production', 'Draft', true]]);
  });

  it('label tools target their text when present, otherwise no target', () => {
    const entries = buildTranscript([
      row('assistant', [
        toolUse('t1', 'add_label', { traceId: 'tr1', text: 'Exchange deposit' }),
        toolUse('t2', 'update_label', { traceId: 'tr1', labelId: 'l1', text: 'Mixer' }),
        toolUse('t3', 'delete_label', { traceId: 'tr1', labelId: 'l1' }),
      ]),
    ]);
    expect(actions(entries).map((a) => [a.label, a.target])).toEqual([
      ['Added label', 'Exchange deposit'],
      ['Updated label', 'Mixer'],
      ['Deleted label', undefined],
    ]);
  });

  it('never prints id-like key inputs; unknown tools fall back to the spaced name', () => {
    const entries = buildTranscript([
      row('assistant', [
        toolUse('t1', 'get_investigation', { investigationId: 'inv-9' }),
        toolUse('t2', 'get_investigation', { address: '0xabc' }),
        toolUse('t3', 'import_transactions', { traceId: 'tr-9' }),
        toolUse('t4', 'some_new_tool', {}),
      ]),
    ]);
    expect(actions(entries).map((a) => [a.label, a.target])).toEqual([
      ['Read investigation', undefined],
      ['Read investigation', '0xabc'],
      ['Imported transactions', undefined],
      ['some new tool', undefined],
    ]);
  });

  it('turns server web searches into actions, flags failures, and skips other server tools', () => {
    const entries = buildTranscript([
      row('assistant', [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Lazarus bridge hack' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', title: 'T', url: 'https://x' }] },
        { type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: 'second query' } },
        { type: 'web_search_tool_result', tool_use_id: 's2', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
        { type: 'server_tool_use', id: 's3', name: 'code_execution', input: { code: 'print(1)' } },
        { type: 'code_execution_tool_result', tool_use_id: 's3', content: {} },
        text('Here is what I found.'),
      ]),
    ]);
    expect(entries).toEqual([
      { kind: 'action', at: expect.any(String), label: 'Web search', target: 'Lazarus bridge hack', failed: false },
      { kind: 'action', at: expect.any(String), label: 'Web search', target: 'second query', failed: true },
      { kind: 'assistant', at: expect.any(String), markdown: 'Here is what I found.' },
    ]);
  });

  it('skips synthetic and terminator texts and compaction, but keeps stop notes', () => {
    const entries = buildTranscript([
      row('assistant', [{ type: 'compaction', content: 'summary of earlier turns' }]),
      row('assistant', [text('(file content follows)')]),
      row('assistant', [text('(continuing)')]),
      row('assistant', [text(TOOL_RESULT_TERMINATOR)]),
      row('assistant', [{ type: 'redacted_thinking', data: 'x' }, text(`Partial answer\n\n${STOP_NOTES.cancelled}`)]),
      row('assistant', [text(STOP_NOTES.time_limit)]),
    ]);
    expect(entries).toEqual([
      { kind: 'assistant', at: expect.any(String), markdown: `Partial answer\n\n${STOP_NOTES.cancelled}` },
      { kind: 'assistant', at: expect.any(String), markdown: STOP_NOTES.time_limit },
    ]);
  });

  it('skips the (attachment) placeholder and lists inline attachments by name only', () => {
    const entries = buildTranscript([
      row('user', [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'SECRETBYTES' }, title: 'Contract.pdf' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'IMGBYTES' } },
        text('(attachment)'),
      ]),
    ]);
    expect(entries).toEqual([
      { kind: 'user', at: expect.any(String), text: '', attachments: ['Contract.pdf', 'Image'] },
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/SECRETBYTES|IMGBYTES/);
  });

  it('strips the data-room attachment note, lists upload refs, and drops read-ref rows', () => {
    const entries = buildTranscript([
      row('user', [
        { type: 'data_room_ref', origin: 'upload', fileId: 'f1', name: 'Wallets.csv', mediaType: 'text/csv' },
        text('Attached files saved to the data room: Wallets.csv (fileId f1). Record notes for each with record_file_notes before answering.'),
        text('Summarize this'),
      ]),
      row('assistant', [toolUse('t1', 'read_data_room_file', { fileId: 'f2' })]),
      row('user', [toolResult('t1', { name: 'Bank.pdf' })]),
      row('assistant', [text('(file content follows)')]),
      row('user', [{ type: 'data_room_ref', origin: 'read', fileId: 'f2', name: 'Bank.pdf', mediaType: 'application/pdf' }]),
      row('assistant', [text('Summary.')]),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(['user', 'action', 'assistant']);
    expect(entries[0]).toMatchObject({ text: 'Summarize this', attachments: ['Wallets.csv'] });
    expect(JSON.stringify(entries)).not.toContain('fileId');
  });

  it('starts mid-conversation when the oldest turns were purged', () => {
    const entries = buildTranscript([
      row('user', [toolResult('gone', { ok: true })]),
      row('assistant', [text('Continuing the analysis.')]),
      row('user', [text('Thanks')]),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(['assistant', 'user']);
  });
});

describe('transcriptToText', () => {
  it('renders a plain-text transcript with actions and failures', () => {
    const out = transcriptToText([
      { kind: 'user', at: '2026-10-01T10:00:00.000Z', text: 'Look into this', attachments: ['Wallets.csv', 'Image'] },
      { kind: 'action', at: '2026-10-01T10:00:01.000Z', label: 'Read data room file', target: 'Wallets.csv', failed: false },
      { kind: 'action', at: '2026-10-01T10:00:02.000Z', label: 'Read case data', failed: true },
      { kind: 'assistant', at: '2026-10-01T10:00:03.000Z', markdown: 'Found **two** wallets.' },
    ]);
    expect(out).toBe(
      [
        'User (2026-10-01T10:00:00.000Z):',
        'Look into this',
        'Attachments: Wallets.csv, Image',
        '',
        '- Read data room file: Wallets.csv',
        '- Read case data (failed)',
        '',
        'Assistant (2026-10-01T10:00:03.000Z):',
        'Found **two** wallets.',
      ].join('\n'),
    );
  });

  it('returns an empty string for no entries', () => {
    expect(transcriptToText([])).toBe('');
  });
});
