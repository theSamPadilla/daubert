import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Chat content older than this is deleted. This is a promise to customers:
 * change it only together with the privacy terms that state it.
 */
export const CHAT_RETENTION_DAYS = 30;

export interface ChatRetentionResult {
  messages: number;
  conversations: number;
  runEvents: number;
  seedSummaries: number;
}

const CUTOFF = `NOW() - make_interval(days => $1::int)`;

// A prompt is a user row that is not a tool-result row (those hold only
// tool_result blocks) and not a read-pointer row (the agent loop saves
// `data_room_ref` blocks with origin 'read' in their own row after a file
// read). Upload pointers (origin 'upload') sit in the user's own message row,
// which is a prompt even when it has no text. Deleting everything before a conversation's first
// prompt inside the window removes whole turns, so the history left behind
// still starts with a prompt and replays to the API without orphaned tool
// results. A conversation with no prompt inside the window loses every row.
// Every conversation that loses rows is stamped with history_truncated_at so
// exports can say its history is incomplete.
const PURGE_MESSAGES = `
  WITH expired AS (
    SELECT DISTINCT conversation_id FROM messages WHERE created_at < ${CUTOFF}
  ),
  keep AS (
    SELECT p.conversation_id, MIN(p.created_at) AS keep_from
    FROM messages p
    JOIN expired e ON e.conversation_id = p.conversation_id
    WHERE p.role = 'user'
      AND p.created_at >= ${CUTOFF}
      AND NOT p.content @> '[{"type":"tool_result"}]'::jsonb
      AND NOT p.content @> '[{"type":"data_room_ref","origin":"read"}]'::jsonb
    GROUP BY p.conversation_id
  ),
  deleted AS (
    DELETE FROM messages m
    USING expired e
    LEFT JOIN keep k ON k.conversation_id = e.conversation_id
    WHERE m.conversation_id = e.conversation_id
      AND m.created_at < COALESCE(k.keep_from, 'infinity'::timestamp)
    RETURNING m.conversation_id
  ),
  stamped AS (
    UPDATE conversations c
    SET history_truncated_at = NOW(), context_tokens = 0
    WHERE c.id IN (SELECT DISTINCT conversation_id FROM deleted)
    RETURNING 1
  )
  SELECT COUNT(*)::int AS count FROM deleted`;

// Conversations left with no messages. Skips one whose first run is being
// launched: the run row exists before its user message is written.
const PURGE_EMPTY_CONVERSATIONS = `
  WITH deleted AS (
    DELETE FROM conversations c
    WHERE c.created_at < ${CUTOFF}
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      AND NOT EXISTS (
        SELECT 1 FROM agent_runs r
        WHERE r.conversation_id = c.id AND r.status IN ('queued', 'running')
      )
    RETURNING 1
  )
  SELECT COUNT(*)::int AS count FROM deleted`;

// Run events carry streamed copies of message text. Each new run clears the
// conversation's older events, so these are the last run of idle chats.
const PURGE_RUN_EVENTS = `
  WITH deleted AS (
    DELETE FROM agent_run_events WHERE created_at < ${CUTOFF}
    RETURNING 1
  )
  SELECT COUNT(*)::int AS count FROM deleted`;

// A continuation's seed summary is a model-written digest of the old chat, so
// it is chat content and expires with the conversation's age. The row stays.
const PURGE_SEED_SUMMARIES = `
  WITH cleared AS (
    UPDATE conversations
    SET seed_summary = NULL
    WHERE seed_summary IS NOT NULL
      AND created_at < ${CUTOFF}
    RETURNING 1
  )
  SELECT COUNT(*)::int AS count FROM cleared`;

@Injectable()
export class ChatRetentionService {
  private readonly logger = new Logger(ChatRetentionService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Delete chat content past the retention window. Idempotent; safe to rerun. */
  async purge(): Promise<ChatRetentionResult> {
    const messages = await this.count(PURGE_MESSAGES);
    const conversations = await this.count(PURGE_EMPTY_CONVERSATIONS);
    const runEvents = await this.count(PURGE_RUN_EVENTS);
    const seedSummaries = await this.count(PURGE_SEED_SUMMARIES);
    this.logger.log(
      `chat_retention_purge days=${CHAT_RETENTION_DAYS} messages=${messages} conversations=${conversations} runEvents=${runEvents} seedSummaries=${seedSummaries}`,
    );
    return { messages, conversations, runEvents, seedSummaries };
  }

  private async count(sql: string): Promise<number> {
    const [row] = await this.dataSource.query(sql, [CHAT_RETENTION_DAYS]);
    return Number(row?.count ?? 0);
  }
}
