import { RunEventRow, RunEventWriter } from './run-event-writer';

describe('RunEventWriter', () => {
  let written: RunEventRow[][];
  let writer: RunEventWriter;

  beforeEach(() => {
    jest.useFakeTimers();
    written = [];
    writer = new RunEventWriter(async (rows) => { written.push(rows); }, 250);
  });
  afterEach(() => jest.useRealTimers());

  it('coalesces consecutive text deltas into one row per window', async () => {
    await writer.push({ type: 'text_delta', data: { content: 'Hel' } });
    await writer.push({ type: 'text_delta', data: { content: 'lo' } });
    expect(written).toEqual([]);
    await jest.advanceTimersByTimeAsync(250);
    expect(written).toEqual([[{ seq: 1, type: 'text_delta', data: { content: 'Hello' } }]]);
  });

  it('flushes pending text before any other event, preserving order', async () => {
    await writer.push({ type: 'text_delta', data: { content: 'a' } });
    await writer.push({ type: 'tool_start', data: { name: 'x' } });
    expect(written).toEqual([[
      { seq: 1, type: 'text_delta', data: { content: 'a' } },
      { seq: 2, type: 'tool_start', data: { name: 'x' } },
    ]]);
  });

  it('flush() writes pending text', async () => {
    await writer.push({ type: 'text_delta', data: { content: 'tail' } });
    await writer.flush();
    expect(written.flat().map((r) => r.data)).toEqual([{ content: 'tail' }]);
  });

  it('surfaces an append failure on the next push', async () => {
    writer = new RunEventWriter(async () => { throw new Error('db down'); }, 250);
    await expect(writer.push({ type: 'tool_start', data: {} })).rejects.toThrow('db down');
    await expect(writer.push({ type: 'tool_done', data: {} })).rejects.toThrow('db down');
  });
});
