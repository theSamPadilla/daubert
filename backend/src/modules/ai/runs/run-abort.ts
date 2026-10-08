/**
 * Why a run's AbortController fired. The executor calls
 * `controller.abort(reason)` and AiService.runTurn reads it back from
 * `signal.reason`.
 */
export type RunAbortReason = 'cancelled' | 'time_limit' | 'lease_lost';

export function abortReasonOf(signal: AbortSignal): RunAbortReason | null {
  if (!signal.aborted) return null;
  const r = signal.reason;
  return r === 'cancelled' || r === 'time_limit' || r === 'lease_lost' ? r : 'cancelled';
}

/** Appended to whatever text the user already saw when a run stops early. */
export const STOP_NOTES: Record<Exclude<RunAbortReason, 'lease_lost'>, string> = {
  cancelled: '(Stopped by user.)',
  time_limit:
    '(Stopped after reaching the time limit for one response. Send another message to continue.)',
};

/**
 * Persisted when a turn ends with a user(tool_result) tail. The compact beta
 * rejects a next user turn that mixes text into a tool-responding turn, so
 * leaving that tail wedges the conversation.
 */
export const TOOL_RESULT_TERMINATOR =
  '(Stopped before continuation. Send another message to resume.)';
