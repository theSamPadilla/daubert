/**
 * Colour palette for traces, in assignment order. A new trace takes
 * `TRACE_COLORS[existingTraceCount % TRACE_COLORS.length]`, so the first trace on
 * an investigation is always `TRACE_COLORS[0]`.
 *
 * Shared because the backend now mints the default trace on investigation
 * creation while the frontend mints every subsequent one — they have to agree on
 * the sequence or colours repeat immediately.
 */
export const TRACE_COLORS = [
  '#3b82f6', '#10b981', '#f97316', '#8b5cf6',
  '#ec4899', '#06b6d4', '#eab308', '#ef4444',
] as const;

export function traceColorForIndex(index: number): string {
  return TRACE_COLORS[index % TRACE_COLORS.length];
}
