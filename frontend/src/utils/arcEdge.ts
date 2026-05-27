import type { Investigation } from '@/types/investigation';

interface ArcMutators {
  updateTransaction: (traceId: string, txId: string, patch: { hasArc?: boolean; arcOffset?: number }) => void;
  updateEdgeBundle: (traceId: string, bundleId: string, patch: { hasArc?: boolean; arcOffset?: number }) => void;
}

/**
 * Persist an arc-offset delta on the backing entity (TransactionEdge or EdgeBundle)
 * for the edge identified by `edgeId`. Returns true when a backing entity was found
 * and the mutation dispatched. Returns false for synthetic aggregated edges, which
 * have no backing entity — caller falls back to ephemeral cy-only override.
 *
 * `delta === null` resets the arc (clears hasArc + arcOffset). Otherwise the delta
 * is added to the current arcOffset (default 0).
 */
export function applyArcDelta(
  investigation: Investigation | null,
  edgeId: string,
  delta: number | null,
  mutators: ArcMutators
): boolean {
  if (!investigation) return false;
  for (const trace of investigation.traces) {
    const edge = trace.edges.find((e) => e.id === edgeId);
    if (edge) {
      if (delta === null) {
        mutators.updateTransaction(trace.id, edgeId, { hasArc: undefined, arcOffset: undefined });
      } else {
        const next = (edge.arcOffset ?? 0) + delta;
        mutators.updateTransaction(trace.id, edgeId, { hasArc: true, arcOffset: next });
      }
      return true;
    }
    const bundle = (trace.edgeBundles || []).find((b) => b.id === edgeId);
    if (bundle) {
      if (delta === null) {
        mutators.updateEdgeBundle(trace.id, edgeId, { hasArc: undefined, arcOffset: undefined });
      } else {
        const next = (bundle.arcOffset ?? 0) + delta;
        mutators.updateEdgeBundle(trace.id, edgeId, { hasArc: true, arcOffset: next });
      }
      return true;
    }
  }
  return false;
}
