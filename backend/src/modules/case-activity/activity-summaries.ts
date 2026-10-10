import type { CaseActivityStatus } from '../../database/entities/case-activity-log.entity';

const MAX_STRING = 200;
const MAX_ERROR = 500;
const MAX_KEYS = 12;
const MAX_SOURCES = 20;

export interface ActivityOutcome {
  status: CaseActivityStatus;
  summary: Record<string, unknown> | null;
}

type Block = { type: string; [key: string]: unknown };

function clip(s: string, max = MAX_STRING): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

/**
 * A short, content-light description of a result: top-level scalars (strings
 * clipped) and array sizes. Full results live in the case already or are
 * public chain data; the log keeps what happened, not a copy.
 */
export function summarizeValue(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return { count: value.length };
  if (!value || typeof value !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (key.startsWith('__')) continue;
    if (typeof v === 'string') out[key] = clip(v);
    else if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (Array.isArray(v)) out[`${key}Count`] = v.length;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Chat tools report failure in a normal result: `{ error: string }`, or for
 * execute_script a `status` of 'error' or 'timeout' (ScriptExecutionService).
 */
export function chatToolOutcome(action: string, input: unknown, result: unknown): ActivityOutcome {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.error === 'string') return { status: 'error', summary: { error: clip(r.error, MAX_ERROR) } };
    if (action === 'execute_script' && (r.status === 'error' || r.status === 'timeout')) {
      return { status: 'error', summary: summarizeValue(result) };
    }
    if ('__agentReadBlocks' in r) {
      const fileId = (input as { fileId?: unknown } | null)?.fileId;
      return { status: 'ok', summary: typeof fileId === 'string' ? { fileId } : null };
    }
  }
  return { status: 'ok', summary: summarizeValue(result) };
}

export function thrownOutcome(err: unknown): ActivityOutcome {
  const message = err instanceof Error ? err.message : String(err);
  return { status: 'error', summary: { error: clip(message, MAX_ERROR) } };
}

/** Server-side web searches never reach executeTool; pair each call with its result block. */
export function webSearchActivities(
  content: ReadonlyArray<Block>,
): Array<{ input: { query: string | null }; outcome: ActivityOutcome }> {
  const results = new Map<string, unknown>();
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && typeof b.tool_use_id === 'string') results.set(b.tool_use_id, b.content);
  }
  return content
    .filter((b) => b.type === 'server_tool_use' && b.name === 'web_search' && typeof b.id === 'string')
    .map((b) => {
      const rawQuery = (b.input as { query?: unknown } | undefined)?.query;
      const input = { query: typeof rawQuery === 'string' ? rawQuery : null };
      const res = results.get(b.id as string);
      if (Array.isArray(res)) {
        const sources = (res as Block[])
          .filter((r) => r.type === 'web_search_result')
          .slice(0, MAX_SOURCES)
          .map((r) => ({ title: clip(String(r.title ?? '')), url: String(r.url ?? '') }));
        return { input, outcome: { status: 'ok' as const, summary: { sources } } };
      }
      const errorCode = (res as { error_code?: unknown } | undefined)?.error_code;
      if (typeof errorCode === 'string') return { input, outcome: { status: 'error' as const, summary: { error: errorCode } } };
      return { input, outcome: { status: 'ok' as const, summary: null } };
    });
}

/** MCP handlers return `{ content: [...], isError? }` envelopes. */
export function mcpToolOutcome(result: unknown): ActivityOutcome {
  const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> } | undefined;
  const text = r?.content?.find((c) => c.type === 'text')?.text;
  if (r?.isError) return { status: 'error', summary: { error: clip(text ?? 'Tool error', MAX_ERROR) } };
  if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text) as unknown;
      const err = (parsed as { error?: unknown } | null)?.error;
      if (typeof err === 'string') return { status: 'error', summary: { error: clip(err, MAX_ERROR) } };
      return { status: 'ok', summary: summarizeValue(parsed) };
    } catch {
      return { status: 'ok', summary: { textLength: text.length } };
    }
  }
  return { status: 'ok', summary: r?.content ? { blocks: r.content.length } : null };
}
