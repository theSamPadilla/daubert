import type { FocusItem } from '@/hooks/useCytoscape';
import type { Investigation, TransactionEdge } from '@/types/investigation';

// Resolve an endpoint id (wallet id, group id, or trace id) to the display label
// that matches the on-graph label. Precedence mirrors cytoscapeSync.ts label logic:
//   1. Trace id with collapsed=true  → "TraceName (N)"
//   2. Trace id (any)                → "TraceName"
//   3. Group id with collapsed=true  → "GroupName (N)"
//   4. Group id (expanded)           → "GroupName"
//   5. Wallet id                     → wallet.label || truncAddr || ""
//   6. Fallback                      → first 8 chars + "…"
export function resolveEndpointLabel(id: string, investigation: Investigation): string {
  // 1 & 2: trace id match
  for (const trace of investigation.traces) {
    if (trace.id === id) {
      return trace.collapsed ? `${trace.name} (${trace.nodes.length})` : trace.name;
    }
  }

  // 3 & 4: group id match
  for (const trace of investigation.traces) {
    for (const group of trace.groups || []) {
      if (group.id === id) {
        if (group.collapsed) {
          const memberCount = trace.nodes.filter((n) => n.groupId === group.id).length;
          return `${group.name} (${memberCount})`;
        }
        return group.name;
      }
    }
  }

  // 5: wallet id match
  for (const trace of investigation.traces) {
    const wallet = trace.nodes.find((n) => n.id === id);
    if (wallet) {
      if (wallet.label) return wallet.label;
      const addr = wallet.address;
      if (addr) {
        return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
      }
      return '';
    }
  }

  // 6: fallback
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// Resolve a FocusItem (id-only, emitted by useCytoscape) into the legacy
// `{ type, data }` shape consumed by the right details panel. Walks the
// investigation traces to find the wallet/group/trace/transaction/edgeBundle
// matching the focusItem id. Returns null when no match (or focusItem is null).
export function resolveFocusItem(
  focusItem: FocusItem,
  investigation: Investigation | null
): { type: string; data: any } | null {
  if (!focusItem || !investigation) return null;
  if (focusItem.type === 'trace') {
    const trace = investigation.traces.find((t) => t.id === focusItem.id);
    return trace ? { type: 'trace', data: trace } : null;
  }
  if (focusItem.type === 'wallet') {
    for (const trace of investigation.traces) {
      const wallet = trace.nodes.find((n) => n.id === focusItem.id);
      if (wallet) return { type: 'wallet', data: wallet };
    }
    return null;
  }
  if (focusItem.type === 'txJunction') {
    for (const trace of investigation.traces) {
      const node = trace.nodes.find((n) => n.id === focusItem.id);
      if (node) return { type: 'txJunction', data: node };
    }
    return null;
  }
  if (focusItem.type === 'group') {
    for (const trace of investigation.traces) {
      const group = (trace.groups || []).find((g) => g.id === focusItem.id);
      if (group) return { type: 'group', data: group };
    }
    return null;
  }
  if (focusItem.type === 'transaction') {
    for (const trace of investigation.traces) {
      const tx = trace.edges.find((e) => e.id === focusItem.id);
      if (tx) return { type: 'transaction', data: tx };
    }
    return null;
  }
  if (focusItem.type === 'edgeBundle') {
    for (const trace of investigation.traces) {
      const bundle = (trace.edgeBundles || []).find((b) => b.id === focusItem.id);
      if (bundle) return { type: 'edgeBundle', data: bundle };
    }
    return null;
  }
  if (focusItem.type === 'aggregatedEdge') {
    const trace = investigation.traces.find((t) => t.id === focusItem.traceId);
    if (!trace) return null;

    const edges = focusItem.edgeIds
      .map((id) => trace.edges.find((e) => e.id === id))
      .filter(Boolean) as TransactionEdge[];
    // Race after delete: underlying txs may be gone. Return null so the panel
    // simply collapses — preferred over a "no transactions" placeholder for a
    // synthetic edge that itself will disappear on the next syncCytoscape pass.
    if (edges.length === 0) return null;

    // The synthetic edge id encodes both endpoints: "${effFrom}::${effTo}::${tokenKey}".
    // Parse them out — they may be wallet ids, group ids, or trace ids.
    const [srcId, tgtId] = focusItem.id.split('::');

    return {
      type: 'aggregatedEdge',
      data: {
        edges,
        traceId: trace.id,
        fromNodeId: srcId,
        toNodeId: tgtId,
        fromLabel: resolveEndpointLabel(srcId, investigation),
        toLabel: resolveEndpointLabel(tgtId, investigation),
        syntheticEdgeId: focusItem.id,
      },
    };
  }
  return null;
}
