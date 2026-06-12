/**
 * Shared MCP tool helpers.
 *
 * Every Daubert MCP tool service uses these to produce a uniform result shape
 * and to cap result payloads. Centralizing them here means later tool tasks
 * (graph reads, edits, member ops, etc.) reuse the same cap/truncation policy
 * without re-deriving it.
 *
 * Result cap rationale (BYOA / belong-mc Decision #11, mirrored here):
 *   8 KB per tool result. Chat clients trim huge tool outputs anyway and
 *   unbounded JSON blasts the model's context. We serialize the value, slice
 *   at the cap, and append a `…[truncated: N more bytes omitted]` suffix so
 *   the caller is explicitly told something was dropped (silently truncating
 *   is worse — the model would treat the partial JSON as authoritative).
 *
 * Error shape:
 *   MCP tool errors are surfaced through the result envelope
 *   (`{ isError: true, content: [{ type: 'text', text }] }`), NOT thrown.
 *   Throwing inside a handler propagates through the MCP transport as a
 *   protocol error which closes the session — that is the wrong UX for a
 *   recoverable per-tool failure (forbidden, not found, validation, etc.).
 *
 * Usage:
 *   try {
 *     const data = await someService.doWork(...);
 *     return textResult(data);
 *   } catch (e) {
 *     return errorResult(e);
 *   }
 */

export const RESULT_CAP_BYTES = 8192;

/**
 * Serialize `value` to JSON and truncate to RESULT_CAP_BYTES, appending a
 * human-readable suffix when truncation occurs.
 */
export function truncatedJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json.length <= RESULT_CAP_BYTES) return json;
  const suffix = `\n…[truncated: ${json.length - RESULT_CAP_BYTES} more bytes omitted]`;
  return json.slice(0, RESULT_CAP_BYTES) + suffix;
}

/**
 * Wrap a successful tool value in the MCP `content` envelope.
 */
export function textResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return { content: [{ type: 'text' as const, text: truncatedJson(value) }] };
}

/**
 * Wrap a thrown error as an MCP tool error. The message is taken from
 * `err.message` for `Error` instances and `String(err)` otherwise. Nest's
 * HTTP exception subclasses (ForbiddenException etc.) extend Error so their
 * `message` field is used directly — that is how `cross_org_access`,
 * `case_not_found`, etc. propagate to the MCP caller.
 */
export function errorResult(err: unknown): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: message }],
  };
}
