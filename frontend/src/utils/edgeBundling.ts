import type { Investigation, EdgeBundle, TransactionEdge } from '@/types/investigation';
import { normalizeToken } from '@/utils/formatAmount';

export type BundleDirection = 'outbound' | 'inbound';

export interface PlannedBundle {
  fromNodeId: string;
  toNodeId: string;
  token: string;
  edgeIds: string[];
}

export interface DirectionalBundlingPlan {
  walletTraceId: string;
  affectedEdgeIds: Set<string>;
  consumedBundleIds: { traceId: string; bundleId: string }[];
  newBundles: PlannedBundle[];
}

/**
 * Compute the set of new bundles + the existing bundles to consume, given a wallet
 * and a direction. Pure — does not mutate. Returns null if the wallet isn't in any
 * trace or if there are no edges in the requested direction.
 *
 * Used by handleBundleAllOutbound / handleBundleAllInbound.
 */
export function computeDirectionalBundlingPlan(
  investigation: Investigation,
  walletId: string,
  direction: BundleDirection
): DirectionalBundlingPlan | null {
  let walletTraceId = '';
  for (const t of investigation.traces) {
    if (t.nodes.some((n) => n.id === walletId)) { walletTraceId = t.id; break; }
  }
  if (!walletTraceId) return null;

  const nodeAddr = new Map<string, string>();
  for (const trace of investigation.traces) {
    for (const node of trace.nodes) nodeAddr.set(node.id, node.address);
  }

  const matchesDirection = (edge: TransactionEdge) =>
    direction === 'outbound' ? edge.from === walletId : edge.to === walletId;
  const bundleMatchesDirection = (b: EdgeBundle) =>
    direction === 'outbound' ? b.fromNodeId === walletId : b.toNodeId === walletId;

  const affectedEdgeIds = new Set<string>();
  const consumedBundleIds: { traceId: string; bundleId: string }[] = [];
  for (const trace of investigation.traces) {
    for (const edge of trace.edges) {
      if (matchesDirection(edge)) affectedEdgeIds.add(edge.id);
    }
    for (const bundle of trace.edgeBundles || []) {
      if (bundleMatchesDirection(bundle)) {
        bundle.edgeIds.forEach((eid) => affectedEdgeIds.add(eid));
        consumedBundleIds.push({ traceId: trace.id, bundleId: bundle.id });
      }
    }
  }
  if (affectedEdgeIds.size === 0) return null;

  const groups = new Map<string, PlannedBundle>();
  for (const trace of investigation.traces) {
    for (const edge of trace.edges) {
      if (!affectedEdgeIds.has(edge.id)) continue;
      const token = normalizeToken(edge.token).symbol;
      const counterpartyAddr = direction === 'outbound'
        ? (nodeAddr.get(edge.to) || edge.to)
        : (nodeAddr.get(edge.from) || edge.from);
      const key = `${counterpartyAddr}::${token}`;
      if (!groups.has(key)) {
        groups.set(key, { fromNodeId: edge.from, toNodeId: edge.to, token, edgeIds: [] });
      }
      groups.get(key)!.edgeIds.push(edge.id);
    }
  }

  return {
    walletTraceId,
    affectedEdgeIds,
    consumedBundleIds,
    newBundles: [...groups.values()].filter((g) => g.edgeIds.length >= 2),
  };
}

/**
 * Group selected edge ids (which may be a mix of raw edges and existing bundle ids)
 * by (fromAddr, toAddr, tokenSymbol). Used by handleBundleEdges (the multi-select
 * "Bundle" button path).
 */
export interface SelectionBundlingPlan {
  consumedBundleIds: { traceId: string; bundleId: string }[];
  newBundles: { traceId: string; bundle: PlannedBundle }[];
}

export function computeSelectionBundlingPlan(
  investigation: Investigation,
  selectedEdgeIds: string[]
): SelectionBundlingPlan {
  const nodeAddr = new Map<string, string>();
  for (const trace of investigation.traces) {
    for (const node of trace.nodes) nodeAddr.set(node.id, node.address);
  }

  const fromBundles = new Set<string>();
  const rawEdgeIds: string[] = [];
  const consumedBundleIds: { traceId: string; bundleId: string }[] = [];
  for (const id of selectedEdgeIds) {
    let found = false;
    for (const trace of investigation.traces) {
      const bundle = (trace.edgeBundles || []).find((b) => b.id === id);
      if (bundle) {
        bundle.edgeIds.forEach((eid) => fromBundles.add(eid));
        consumedBundleIds.push({ traceId: trace.id, bundleId: bundle.id });
        found = true;
        break;
      }
    }
    if (!found) rawEdgeIds.push(id);
  }
  const uniqueEdgeIds = new Set([...fromBundles, ...rawEdgeIds]);

  const groups = new Map<string, { fromNodeId: string; toNodeId: string; token: string; edgeIds: string[] }>();
  for (const trace of investigation.traces) {
    for (const edge of trace.edges) {
      if (!uniqueEdgeIds.has(edge.id)) continue;
      const token = normalizeToken(edge.token).symbol;
      const fromAddr = nodeAddr.get(edge.from) || edge.from;
      const toAddr = nodeAddr.get(edge.to) || edge.to;
      const key = `${fromAddr}::${toAddr}::${token}`;
      if (!groups.has(key)) groups.set(key, { fromNodeId: edge.from, toNodeId: edge.to, token, edgeIds: [] });
      groups.get(key)!.edgeIds.push(edge.id);
    }
  }

  const newBundles: { traceId: string; bundle: PlannedBundle }[] = [];
  for (const planned of groups.values()) {
    if (planned.edgeIds.length < 2) continue;
    let traceId = '';
    for (const t of investigation.traces) {
      if (t.edges.some((e) => e.id === planned.edgeIds[0])) { traceId = t.id; break; }
    }
    if (!traceId) continue;
    newBundles.push({ traceId, bundle: planned });
  }
  return { consumedBundleIds, newBundles };
}
