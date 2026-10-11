import type { MessageEntity } from '../../database/entities/message.entity';
import { chatToolOutcome, webSearchActivities } from '../case-activity/activity-summaries';
import { DATA_ROOM_ATTACHED_PREFIX, FILE_CONTENT_MARKER } from './data-room-rehydrate';
import { TOOL_RESULT_TERMINATOR } from './runs/run-abort';
import { KEY_INPUT, toolLabel } from './tool-labels';

/**
 * A readable transcript of a persisted conversation: user turns, assistant
 * prose, and one line per agent action. Pure: no IO. Used by the conversation
 * export and by the long-conversation handoff summary.
 */
export type TranscriptEntry =
  | { kind: 'user'; at: string; text: string; attachments: string[] }
  | { kind: 'assistant'; at: string; markdown: string }
  | { kind: 'action'; at: string; label: string; target?: string; failed: boolean };

type Block = { type: string; [key: string]: unknown };

/** Text stored by persistUserMessage for a turn with no text. */
const ATTACHMENT_PLACEHOLDER = '(attachment)';

/** Synthetic assistant separator inserted by mergeConsecutiveRoles. */
const CONTINUING_TEXT = '(continuing)';

const SKIPPED_ASSISTANT_TEXTS = new Set([FILE_CONTENT_MARKER, CONTINUING_TEXT, TOOL_RESULT_TERMINATOR]);

const PRODUCTION_TOOLS = new Set(['create_production', 'read_production', 'update_production']);
const LABEL_TOOLS = new Set(['add_label', 'update_label', 'delete_label', 'move_label', 'tether_label']);

const TARGET_MAX = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Marks a tool_result whose content could not be parsed (e.g. truncated). */
const UNPARSEABLE = Symbol('unparseable');
type ParsedResult = unknown | typeof UNPARSEABLE;

function blocksOf(row: MessageEntity): Block[] {
  return Array.isArray(row.content)
    ? (row.content.filter((b) => b && typeof b === 'object' && typeof (b as Block).type === 'string') as Block[])
    : [];
}

function clip(s: string): string {
  return s.length > TARGET_MAX ? `${s.slice(0, TARGET_MAX - 3)}...` : s;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function toolResultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter((c): c is { type: string; text: string } => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text);
    return parts.length ? parts.join('') : undefined;
  }
  return undefined;
}

function parseResult(content: unknown): ParsedResult {
  const raw = toolResultText(content);
  if (raw === undefined) return UNPARSEABLE;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return UNPARSEABLE;
  }
}

/** Every tool_result in the history, keyed by tool_use_id. */
function collectResults(rows: MessageEntity[]): Map<string, ParsedResult> {
  const results = new Map<string, ParsedResult>();
  for (const row of rows) {
    if (row.role !== 'user') continue;
    for (const b of blocksOf(row)) {
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        results.set(b.tool_use_id, parseResult(b.content));
      }
    }
  }
  return results;
}

function resultName(result: ParsedResult): string | undefined {
  if (result === UNPARSEABLE || !result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  return nonEmptyString((result as Record<string, unknown>).name);
}

function isIdField(key: string, value: string): boolean {
  return /Id$/.test(key) || key === 'id' || UUID_RE.test(value);
}

function actionTarget(name: string, input: unknown, result: ParsedResult | undefined): string | undefined {
  const fields = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  let target: string | undefined;
  if (name === 'read_data_room_file') {
    target = (result !== undefined ? resultName(result) : undefined) ?? 'a data room file';
  } else if (PRODUCTION_TOOLS.has(name)) {
    target =
      (result !== undefined ? resultName(result) : undefined) ??
      (name === 'create_production' ? nonEmptyString(fields.name) : undefined);
  } else if (LABEL_TOOLS.has(name)) {
    target = nonEmptyString(fields.text);
  } else {
    for (const key of KEY_INPUT[name] ?? []) {
      const v = nonEmptyString(fields[key]);
      if (v && !isIdField(key, v)) {
        target = v;
        break;
      }
    }
  }
  return target === undefined ? undefined : clip(target);
}

function actionEntry(at: string, label: string, target: string | undefined, failed: boolean): TranscriptEntry {
  return target === undefined ? { kind: 'action', at, label, failed } : { kind: 'action', at, label, target, failed };
}

function attachmentName(b: Block): string | undefined {
  if (b.type === 'document') return nonEmptyString(b.title) ?? nonEmptyString(b.name) ?? 'Document';
  if (b.type === 'image') return 'Image';
  if (b.type === 'data_room_ref' && b.origin === 'upload') return nonEmptyString(b.name) ?? 'Attached file';
  return undefined;
}

function userEntry(row: MessageEntity, at: string): TranscriptEntry | null {
  const texts: string[] = [];
  const attachments: string[] = [];
  const hasUpload = blocksOf(row).some((b) => b.type === 'data_room_ref' && b.origin === 'upload');
  for (const b of blocksOf(row)) {
    if (b.type === 'text' && typeof b.text === 'string') {
      const t = b.text.trim();
      if (!t || t === ATTACHMENT_PLACEHOLDER || (hasUpload && t.startsWith(DATA_ROOM_ATTACHED_PREFIX))) continue;
      texts.push(b.text);
      continue;
    }
    const name = attachmentName(b);
    if (name) attachments.push(name);
  }
  if (texts.length === 0 && attachments.length === 0) return null;
  return { kind: 'user', at, text: texts.join('\n\n').trim(), attachments };
}

function assistantEntries(row: MessageEntity, at: string, results: Map<string, ParsedResult>): TranscriptEntry[] {
  const blocks = blocksOf(row);
  const out: TranscriptEntry[] = [];
  const searches = webSearchActivities(blocks);
  let searchIdx = 0;
  let prose: string[] = [];
  const flush = () => {
    const markdown = prose.join('\n\n').trim();
    if (markdown) out.push({ kind: 'assistant', at, markdown });
    prose = [];
  };

  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') {
      if (SKIPPED_ASSISTANT_TEXTS.has(b.text.trim())) continue;
      prose.push(b.text);
    } else if (b.type === 'tool_use' && typeof b.name === 'string') {
      flush();
      const result = typeof b.id === 'string' ? results.get(b.id) : undefined;
      const failed =
        result !== undefined && result !== UNPARSEABLE && chatToolOutcome(b.name, b.input, result).status === 'error';
      out.push(actionEntry(at, toolLabel(b.name), actionTarget(b.name, b.input, result), failed));
    } else if (b.type === 'server_tool_use' && b.name === 'web_search' && typeof b.id === 'string') {
      // Same filter as webSearchActivities, so the two stay aligned by index.
      const search = searches[searchIdx++];
      if (!search) continue;
      flush();
      const query = search.input.query?.trim();
      out.push(actionEntry(at, toolLabel('web_search'), query ? clip(query) : undefined, search.outcome.status === 'error'));
    }
    // Everything else is skipped: thinking, redacted_thinking, compaction,
    // non-web-search server_tool_use, web_search_tool_result, code_execution*.
  }
  flush();
  return out;
}

export function buildTranscript(rows: MessageEntity[]): TranscriptEntry[] {
  const results = collectResults(rows);
  const entries: TranscriptEntry[] = [];
  for (const row of rows) {
    const at = new Date(row.createdAt).toISOString();
    if (row.role === 'assistant') {
      entries.push(...assistantEntries(row, at, results));
    } else {
      const entry = userEntry(row, at);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

/** Plain-text rendering: turns separated by blank lines, actions as bullet lines. */
export function transcriptToText(entries: TranscriptEntry[]): string {
  const chunks: string[] = [];
  let actions: string[] = [];
  const flushActions = () => {
    if (actions.length) chunks.push(actions.join('\n'));
    actions = [];
  };
  for (const e of entries) {
    if (e.kind === 'action') {
      actions.push(`- ${e.label}${e.target ? `: ${e.target}` : ''}${e.failed ? ' (failed)' : ''}`);
      continue;
    }
    flushActions();
    if (e.kind === 'user') {
      const lines = [`User (${e.at}):`];
      if (e.text) lines.push(e.text);
      if (e.attachments.length) lines.push(`Attachments: ${e.attachments.join(', ')}`);
      chunks.push(lines.join('\n'));
    } else {
      chunks.push(`Assistant (${e.at}):\n${e.markdown}`);
    }
  }
  flushActions();
  return chunks.join('\n\n');
}
