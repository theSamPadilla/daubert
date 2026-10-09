import { Logger } from '@nestjs/common';
import { ChatRetentionService, CHAT_RETENTION_DAYS } from './chat-retention.service';

// The SQL itself is exercised against Postgres (see docs/chat-retention.md);
// these tests pin the order of the steps and how their counts are reported.

let dataSource: { query: jest.Mock };
let service: ChatRetentionService;

beforeEach(() => {
  dataSource = { query: jest.fn() };
  service = new ChatRetentionService(dataSource as any);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('ChatRetentionService.purge', () => {
  it('purges messages, then emptied conversations, then run events, all with the 30-day window', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ count: 8 }])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 1 }]);

    const result = await service.purge();

    expect(result).toEqual({ messages: 8, conversations: 2, runEvents: 1 });
    const [messagesSql, conversationsSql, eventsSql] = dataSource.query.mock.calls.map((c) => c[0] as string);
    expect(messagesSql).toContain('DELETE FROM messages');
    expect(conversationsSql).toContain('DELETE FROM conversations');
    expect(eventsSql).toContain('DELETE FROM agent_run_events');
    for (const call of dataSource.query.mock.calls) expect(call[1]).toEqual([CHAT_RETENTION_DAYS]);
    expect(CHAT_RETENTION_DAYS).toBe(30);
  });

  it('keeps tool-result rows from counting as the start of a turn', async () => {
    dataSource.query.mockResolvedValue([{ count: 0 }]);
    await service.purge();
    expect(dataSource.query.mock.calls[0][0]).toContain(`NOT p.content @> '[{"type":"tool_result"}]'::jsonb`);
  });

  it('never deletes a conversation whose run is queued or running', async () => {
    dataSource.query.mockResolvedValue([{ count: 0 }]);
    await service.purge();
    expect(dataSource.query.mock.calls[1][0]).toContain(`r.status IN ('queued', 'running')`);
  });

  it('logs the counts', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 5 }]);
    await service.purge();
    expect(Logger.prototype.log).toHaveBeenCalledWith('chat_retention_purge days=30 messages=3 conversations=0 runEvents=5');
  });
});
