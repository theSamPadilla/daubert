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

  it('shows a tool status, then starts a fresh bubble for text after the tool', () => {
    const turn = make();
    turn.apply('text_delta', { content: 'Looking' });
    turn.apply('tool_start', { name: 'read_production' });
    expect(turn.bubbles().map((m) => [m.role, m.text, m.isStreaming])).toEqual([
      ['assistant', 'Looking', false],
      ['status', 'Running read_production', true],
    ]);
    turn.apply('tool_done', { name: 'read_production' });
    turn.apply('text_delta', { content: 'Done' });
    expect(turn.bubbles().map((m) => m.text)).toEqual(['Looking', 'Done']);
  });

  it('drops an empty placeholder when a tool starts', () => {
    const turn = make();
    turn.apply('tool_start', { name: 'x' });
    expect(turn.bubbles().map((m) => m.role)).toEqual(['status']);
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

  it('marks finished on done and settles: drops empties and status, appends failure', () => {
    const turn = make();
    turn.apply('done', { status: 'succeeded' });
    expect(turn.finished).toBe(true);
    const t2 = make();
    t2.apply('tool_start', { name: 'x' });
    // id1 = dropped placeholder, id2 = status (dropped by settle), id3 = failure bubble
    expect(t2.settle('Lost connection')).toEqual([{ id: 'id3', role: 'assistant', text: 'Lost connection' }]);
  });
});
