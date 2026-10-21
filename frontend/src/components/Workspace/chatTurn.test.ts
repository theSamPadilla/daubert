import { ChatTurn } from './chatTurn';

const make = (placeholder = true) => {
  let n = 0;
  return new ChatTurn({ newId: () => `id${++n}`, formatToolStatus: (t) => `Running ${t.name}` }, { placeholder });
};

describe('ChatTurn', () => {
  it('fills the placeholder with streamed text, replacing the bubble object', () => {
    const turn = make();
    const before = turn.bubbles()[0];
    turn.apply('text_delta', { content: 'Hel' });
    turn.apply('text_delta', { content: 'lo' });
    expect(turn.bubbles()).toEqual([{ id: 'id1', role: 'assistant', text: 'Hello', isStreaming: true }]);
    expect(turn.bubbles()[0]).not.toBe(before);
  });

  it('keeps each tool call as a step that stays after the tool finishes', () => {
    const turn = make();
    turn.apply('text_delta', { content: 'Looking' });
    turn.apply('tool_start', { name: 'read_production' });
    expect(turn.bubbles().map((m) => [m.role, m.isStreaming])).toEqual([
      ['assistant', false],
      ['activity', true],
    ]);
    expect(turn.bubbles()[1].steps).toEqual([{ id: 'id2', text: 'Running read_production', state: 'running' }]);

    turn.apply('tool_done', { name: 'read_production' });
    expect(turn.bubbles()[1].steps?.[0].state).toBe('done');

    turn.apply('text_delta', { content: 'Done' });
    expect(turn.bubbles().map((m) => m.role)).toEqual(['assistant', 'activity', 'assistant']);
    expect(turn.bubbles().map((m) => m.text)).toEqual(['Looking', '', 'Done']);
  });

  it('groups consecutive tool calls into one activity bubble', () => {
    const turn = make();
    turn.apply('tool_start', { name: 'get_case_data' });
    turn.apply('tool_done', { name: 'get_case_data' });
    turn.apply('tool_start', { name: 'execute_script' });
    const bubbles = turn.bubbles();
    expect(bubbles.map((m) => m.role)).toEqual(['activity']);
    expect(bubbles[0].steps?.map((s) => [s.text, s.state])).toEqual([
      ['Running get_case_data', 'done'],
      ['Running execute_script', 'running'],
    ]);
  });

  it('starts a new activity bubble for tools after text', () => {
    const turn = make();
    turn.apply('tool_start', { name: 'a' });
    turn.apply('tool_done', { name: 'a' });
    turn.apply('text_delta', { content: 'Found it.' });
    turn.apply('tool_start', { name: 'b' });
    expect(turn.bubbles().map((m) => m.role)).toEqual(['activity', 'assistant', 'activity']);
  });

  it('drops an empty placeholder when a tool starts', () => {
    const turn = make();
    turn.apply('tool_start', { name: 'x' });
    expect(turn.bubbles().map((m) => m.role)).toEqual(['activity']);
  });

  it('marks a step still running when the run errors as stopped', () => {
    const turn = make();
    turn.apply('tool_start', { name: 'x' });
    turn.apply('error', { message: 'Boom' });
    expect(turn.bubbles()[0].steps?.[0].state).toBe('stopped');
    expect(turn.bubbles()[0].isStreaming).toBe(false);
  });

  it('returns side effects for graph and production updates', () => {
    const turn = make();
    expect(turn.apply('graph_updated', {})).toBe('graph');
    expect(turn.apply('production_updated', {})).toBe('production');
    expect(turn.apply('text_delta', { content: 'x' })).toBeNull();
  });

  it('keeps partial text and appends errors as their own bubble', () => {
    const turn = make();
    turn.apply('text_delta', { content: 'Partial' });
    turn.apply('error', { message: 'Boom', errorId: 'e1' });
    expect(turn.bubbles().map((m) => m.text)).toEqual(['Partial', 'Boom (ref: e1)']);
  });

  it('carries the error code on the error bubble', () => {
    const turn = make();
    turn.apply('error', { message: 'Too long', errorId: 'e2', code: 'context_overflow' });
    expect(turn.bubbles()).toEqual([
      { id: 'id1', role: 'assistant', text: 'Too long (ref: e2)', isStreaming: false, code: 'context_overflow' },
    ]);
    const t2 = make();
    t2.apply('text_delta', { content: 'Partial' });
    t2.apply('error', { message: 'Too long', code: 'context_overflow' });
    expect(t2.bubbles()[1].code).toBe('context_overflow');
  });

  it('returns a context side effect and records the token count', () => {
    const turn = make();
    expect(turn.contextTokens).toBeNull();
    expect(turn.apply('context_usage', { tokens: 210_000 })).toBe('context');
    expect(turn.contextTokens).toBe(210_000);
    expect(turn.apply('context_usage', {})).toBeNull();
    expect(turn.contextTokens).toBe(210_000);
  });

  it('marks finished on done and settles: drops empty text, keeps activity, appends failure', () => {
    const turn = make();
    turn.apply('done', { status: 'succeeded' });
    expect(turn.finished).toBe(true);
    const t2 = make();
    t2.apply('tool_start', { name: 'x' });
    // id1 = dropped placeholder, id2 = step, id3 = activity bubble, id4 = failure bubble
    expect(t2.settle('Lost connection')).toEqual([
      {
        id: 'id3',
        role: 'activity',
        text: '',
        isStreaming: false,
        steps: [{ id: 'id2', text: 'Running x', state: 'stopped' }],
      },
      { id: 'id4', role: 'assistant', text: 'Lost connection' },
    ]);
  });

  it('settles a step still running on a clean finish as done', () => {
    const turn = make();
    turn.apply('tool_start', { name: 'x' });
    expect(turn.settle(null)[0].steps?.[0].state).toBe('done');
  });
});
