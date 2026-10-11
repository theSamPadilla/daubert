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
  it('purges messages, then emptied conversations, then run events, then seed summaries, all with the 30-day window', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ count: 8 }])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 4 }]);

    const result = await service.purge();

    expect(result).toEqual({ messages: 8, conversations: 2, runEvents: 1, seedSummaries: 4 });
    const [messagesSql, conversationsSql, eventsSql, seedSql] = dataSource.query.mock.calls.map((c) => c[0] as string);
    expect(messagesSql).toContain('DELETE FROM messages');
    expect(conversationsSql).toContain('DELETE FROM conversations');
    expect(eventsSql).toContain('DELETE FROM agent_run_events');
    expect(seedSql).toContain('SET seed_summary = NULL');
    for (const call of dataSource.query.mock.calls) expect(call[1]).toEqual([CHAT_RETENTION_DAYS]);
    expect(CHAT_RETENTION_DAYS).toBe(30);
  });

  it('keeps tool-result rows from counting as the start of a turn', async () => {
    dataSource.query.mockResolvedValue([{ count: 0 }]);
    await service.purge();
    expect(dataSource.query.mock.calls[0][0]).toContain(`NOT p.content @> '[{"type":"tool_result"}]'::jsonb`);
  });

  it('stamps history_truncated_at only on conversations that lost messages, still returning the deleted count', async () => {
    dataSource.query.mockResolvedValue([{ count: 0 }]);
    await service.purge();
    const sql = (dataSource.query.mock.calls[0][0] as string).replace(/\s+/g, ' ');
    // The DELETE hands back the conversation of every removed row...
    expect(sql).toContain('RETURNING m.conversation_id');
    // ...and only those conversations are stamped. A conversation with no
    // deleted rows never appears in `deleted`, so it stays unstamped.
    expect(sql).toContain('UPDATE conversations c SET history_truncated_at = NOW(), context_tokens = 0');
    expect(sql).toContain('WHERE c.id IN (SELECT DISTINCT conversation_id FROM deleted)');
    expect(sql).not.toMatch(/UPDATE conversations[^)]*WHERE c\.id IN \(SELECT [^)]*FROM expired/);
    // The reported number is still deleted messages, not stamped conversations.
    expect(sql).toMatch(/SELECT COUNT\(\*\)::int AS count FROM deleted$/);
  });

  it('keeps the prompt filters of the keep set intact alongside the stamp', async () => {
    dataSource.query.mockResolvedValue([{ count: 0 }]);
    await service.purge();
    const sql = dataSource.query.mock.calls[0][0] as string;
    const keep = sql.slice(sql.indexOf('keep AS ('), sql.indexOf('deleted AS ('));
    expect(keep).toContain(`p.role = 'user'`);
    expect(keep).toContain(`NOT p.content @> '[{"type":"tool_result"}]'::jsonb`);
  });

  it('does not keep from a read-pointer row, so it is purged like any agent-loop row', async () => {
    dataSource.query.mockResolvedValue([{ count: 0 }]);
    await service.purge();
    const sql = dataSource.query.mock.calls[0][0] as string;
    const keep = sql.slice(sql.indexOf('keep AS ('), sql.indexOf('deleted AS ('));
    expect(keep).toContain(`AND NOT p.content @> '[{"type":"data_room_ref","origin":"read"}]'::jsonb`);
  });

  it('still keeps from a normal prompt and from an upload-only prompt row', async () => {
    dataSource.query.mockResolvedValue([{ count: 0 }]);
    await service.purge();
    const sql = dataSource.query.mock.calls[0][0] as string;
    const keep = sql.slice(sql.indexOf('keep AS ('), sql.indexOf('deleted AS ('));
    // Exclusions are only tool_result rows and read pointers: a text prompt and
    // a row of origin 'upload' pointers (attachment-only message) both qualify.
    const exclusions = keep.match(/NOT p\.content @> '[^']*'::jsonb/g);
    expect(exclusions).toEqual([
      `NOT p.content @> '[{"type":"tool_result"}]'::jsonb`,
      `NOT p.content @> '[{"type":"data_room_ref","origin":"read"}]'::jsonb`,
    ]);
    expect(keep).not.toContain('"upload"');
    expect(keep).not.toMatch(/NOT p\.content @> '\[\{"type":"data_room_ref"\}\]'/);
  });

  it('never deletes a conversation whose run is queued or running', async () => {
    dataSource.query.mockResolvedValue([{ count: 0 }]);
    await service.purge();
    expect(dataSource.query.mock.calls[1][0]).toContain(`r.status IN ('queued', 'running')`);
  });

  it('clears only non-null seed summaries on conversations older than the window, without deleting rows', async () => {
    dataSource.query.mockResolvedValue([{ count: 0 }]);
    await service.purge();
    const sql = (dataSource.query.mock.calls[3][0] as string).replace(/\s+/g, ' ');
    expect(sql).toContain('UPDATE conversations SET seed_summary = NULL');
    expect(sql).toContain('WHERE seed_summary IS NOT NULL');
    expect(sql).toContain('created_at < NOW() - make_interval(days => $1::int)');
    expect(sql).not.toContain('DELETE');
    // The messages purge is left alone by this step.
    expect(dataSource.query.mock.calls[0][0]).not.toContain('seed_summary');
  });

  it('logs the counts', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 5 }])
      .mockResolvedValueOnce([{ count: 2 }]);
    await service.purge();
    expect(Logger.prototype.log).toHaveBeenCalledWith('chat_retention_purge days=30 messages=3 conversations=0 runEvents=5 seedSummaries=2');
  });
});
