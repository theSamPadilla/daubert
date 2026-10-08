import { createSseParser } from './sse';

describe('createSseParser', () => {
  it('parses complete frames with id, event and data', () => {
    const p = createSseParser();
    expect(p.feed('id: 3\nevent: text_delta\ndata: {"content":"a"}\n\n')).toEqual([
      { id: '3', event: 'text_delta', data: '{"content":"a"}' },
    ]);
  });

  it('buffers frames split across chunks', () => {
    const p = createSseParser();
    expect(p.feed('id: 1\nevent: do')).toEqual([]);
    expect(p.feed('ne\ndata: {}\n')).toEqual([]);
    expect(p.feed('\n')).toEqual([{ id: '1', event: 'done', data: '{}' }]);
  });

  it('ignores comments and heartbeats, joins multi-line data, tolerates CRLF', () => {
    const p = createSseParser();
    expect(p.feed(': heartbeat\n\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n')).toEqual([
      { id: null, event: 'x', data: 'a\nb' },
    ]);
  });
});
