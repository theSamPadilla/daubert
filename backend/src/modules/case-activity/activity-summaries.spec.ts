import {
  chatToolOutcome,
  mcpToolOutcome,
  summarizeValue,
  thrownOutcome,
  webSearchActivities,
} from './activity-summaries';

describe('summarizeValue', () => {
  it('keeps scalars, counts arrays, drops nested objects and internal keys', () => {
    expect(
      summarizeValue({ id: 'p1', status: 'success', rows: [1, 2, 3], data: { big: true }, __internal: 'x', ok: true }),
    ).toEqual({ id: 'p1', status: 'success', rowsCount: 3, ok: true });
  });

  it('clips long strings to 200 characters', () => {
    const s = summarizeValue({ output: 'a'.repeat(500) }) as { output: string };
    expect(s.output).toHaveLength(203);
    expect(s.output.endsWith('...')).toBe(true);
  });

  it('counts top-level arrays and returns null for empty objects', () => {
    expect(summarizeValue([1, 2])).toEqual({ count: 2 });
    expect(summarizeValue({ nested: { a: 1 } })).toBeNull();
    expect(summarizeValue(undefined)).toBeNull();
  });
});

describe('chatToolOutcome', () => {
  it('treats an { error } result as a failure', () => {
    expect(chatToolOutcome('get_case_data', {}, { error: 'No case context.' })).toEqual({
      status: 'error',
      summary: { error: 'No case context.' },
    });
  });

  it('summarizes a data room read by file id, not content', () => {
    expect(chatToolOutcome('read_data_room_file', { fileId: 'f1' }, { __agentReadBlocks: [{ type: 'document' }] })).toEqual({
      status: 'ok',
      summary: { fileId: 'f1' },
    });
  });

  it('summarizes other results generically', () => {
    expect(chatToolOutcome('execute_script', {}, { scriptRunId: 'r1', status: 'success' })).toEqual({
      status: 'ok',
      summary: { scriptRunId: 'r1', status: 'success' },
    });
  });

  it('treats a script that errored or timed out as a failure', () => {
    expect(chatToolOutcome('execute_script', {}, { status: 'error', output: 'TypeError: x' })).toEqual({
      status: 'error',
      summary: { status: 'error', output: 'TypeError: x' },
    });
    expect(chatToolOutcome('execute_script', {}, { status: 'timeout' }).status).toBe('error');
  });
});

describe('thrownOutcome', () => {
  it('records the error message', () => {
    expect(thrownOutcome(new Error('boom'))).toEqual({ status: 'error', summary: { error: 'boom' } });
  });
});

describe('webSearchActivities', () => {
  it('pairs each web search with its sources', () => {
    const out = webSearchActivities([
      { type: 'text', text: 'Looking' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'tornado cash' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: [{ type: 'web_search_result', title: 'OFAC', url: 'https://example.gov/a' }],
      },
    ]);
    expect(out).toEqual([
      {
        input: { query: 'tornado cash' },
        outcome: { status: 'ok', summary: { sources: [{ title: 'OFAC', url: 'https://example.gov/a' }] } },
      },
    ]);
  });

  it('marks a search error', () => {
    const out = webSearchActivities([
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
    ]);
    expect(out[0].outcome).toEqual({ status: 'error', summary: { error: 'max_uses_exceeded' } });
  });

  it('ignores other server tools', () => {
    expect(webSearchActivities([{ type: 'server_tool_use', id: 'c1', name: 'code_execution', input: {} }])).toEqual([]);
  });
});

describe('mcpToolOutcome', () => {
  it('reads error envelopes', () => {
    expect(mcpToolOutcome({ isError: true, content: [{ type: 'text', text: 'Forbidden' }] })).toEqual({
      status: 'error',
      summary: { error: 'Forbidden' },
    });
  });

  it('treats an error JSON body without isError as a failure', () => {
    expect(mcpToolOutcome({ content: [{ type: 'text', text: '{"error":"Investigation not found"}' }] })).toEqual({
      status: 'error',
      summary: { error: 'Investigation not found' },
    });
  });

  it('summarizes JSON text results', () => {
    expect(mcpToolOutcome({ content: [{ type: 'text', text: '{"id":"inv1","traces":[1,2]}' }] })).toEqual({
      status: 'ok',
      summary: { id: 'inv1', tracesCount: 2 },
    });
  });

  it('falls back to sizes for non-JSON content', () => {
    expect(mcpToolOutcome({ content: [{ type: 'text', text: 'not json' }] })).toEqual({
      status: 'ok',
      summary: { textLength: 8 },
    });
    expect(mcpToolOutcome({ content: [{ type: 'resource' }, { type: 'image' }] })).toEqual({
      status: 'ok',
      summary: { blocks: 2 },
    });
  });
});
