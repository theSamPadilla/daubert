'use client';

import { useCallback } from 'react';
import type { Investigation, EdgeBundle } from '@/types/investigation';
import {
  computeDirectionalBundlingPlan,
  computeSelectionBundlingPlan,
  type BundleDirection,
} from '@/utils/edgeBundling';

interface UseEdgeBundlingArgs {
  investigation: Investigation | null;
  selectedEdgeIds: string[];
  setSelectedEdgeIds: (ids: string[]) => void;
  addEdgeBundle: (traceId: string, bundle: EdgeBundle) => void;
  deleteEdgeBundle: (traceId: string, bundleId: string) => void;
  updateTransaction: (traceId: string, txId: string, patch: { color?: string }) => void;
  deleteOutboundEdges: (walletId: string) => void;
  deleteInboundEdges: (walletId: string) => void;
}

export function useEdgeBundling({
  investigation,
  selectedEdgeIds,
  setSelectedEdgeIds,
  addEdgeBundle,
  deleteEdgeBundle,
  updateTransaction,
  deleteOutboundEdges,
  deleteInboundEdges,
}: UseEdgeBundlingArgs) {
  const handleBundleEdges = useCallback(() => {
    if (!investigation || selectedEdgeIds.length < 2) return;
    const plan = computeSelectionBundlingPlan(investigation, selectedEdgeIds);
    for (const { traceId, bundleId } of plan.consumedBundleIds) {
      deleteEdgeBundle(traceId, bundleId);
    }
    for (const { traceId, bundle } of plan.newBundles) {
      addEdgeBundle(traceId, {
        id: crypto.randomUUID(),
        traceId,
        fromNodeId: bundle.fromNodeId,
        toNodeId: bundle.toNodeId,
        token: bundle.token,
        collapsed: true,
        edgeIds: bundle.edgeIds,
      });
    }
    setSelectedEdgeIds([]);
  }, [investigation, selectedEdgeIds, addEdgeBundle, deleteEdgeBundle, setSelectedEdgeIds]);

  const bundleByDirection = useCallback((walletId: string, color: string, direction: BundleDirection) => {
    if (!investigation) return;
    const plan = computeDirectionalBundlingPlan(investigation, walletId, direction);
    if (!plan) return;

    // Color all affected edges so the bundle's color is consistent if later un-bundled.
    for (const trace of investigation.traces) {
      for (const edge of trace.edges) {
        if (plan.affectedEdgeIds.has(edge.id)) {
          updateTransaction(trace.id, edge.id, { color });
        }
      }
    }

    for (const { traceId, bundleId } of plan.consumedBundleIds) {
      deleteEdgeBundle(traceId, bundleId);
    }

    for (const bundle of plan.newBundles) {
      addEdgeBundle(plan.walletTraceId, {
        id: crypto.randomUUID(),
        traceId: plan.walletTraceId,
        fromNodeId: bundle.fromNodeId,
        toNodeId: bundle.toNodeId,
        token: bundle.token,
        collapsed: true,
        edgeIds: bundle.edgeIds,
        color,
      });
    }
  }, [investigation, addEdgeBundle, deleteEdgeBundle, updateTransaction]);

  const handleBundleAllOutbound = useCallback(
    (walletId: string, color: string) => bundleByDirection(walletId, color, 'outbound'),
    [bundleByDirection]
  );
  const handleBundleAllInbound = useCallback(
    (walletId: string, color: string) => bundleByDirection(walletId, color, 'inbound'),
    [bundleByDirection]
  );
  const handleDeleteAllOutbound = useCallback(
    (walletId: string) => deleteOutboundEdges(walletId),
    [deleteOutboundEdges]
  );
  const handleDeleteAllInbound = useCallback(
    (walletId: string) => deleteInboundEdges(walletId),
    [deleteInboundEdges]
  );

  return {
    handleBundleEdges,
    handleBundleAllOutbound,
    handleBundleAllInbound,
    handleDeleteAllOutbound,
    handleDeleteAllInbound,
  };
}
