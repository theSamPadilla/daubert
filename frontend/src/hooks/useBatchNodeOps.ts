'use client';

import { useCallback, useMemo } from 'react';
import type { Investigation, WalletNode, Group, Trace } from '@/types/investigation';
import { apiClient } from '@/lib/api-client';

const TRACE_COLORS = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308', '#ef4444'];

interface UseBatchNodeOpsArgs {
  investigation: Investigation | null;
  activeInvestigationId: string | null;
  selectedNodeIds: { id: string; traceId: string }[];
  setSelectedNodeIds: (ids: { id: string; traceId: string }[]) => void;
  updateWallet: (traceId: string, walletId: string, patch: Partial<WalletNode>) => void;
  deleteWallet: (traceId: string, walletId: string) => void;
  createGroup: (traceId: string, group: Group, nodeIds: string[]) => void;
  setNodeGroup: (traceId: string, nodeIds: string[], groupId: string | null) => void;
  extractToTrace: (nodeIds: string[], newTrace: Trace) => void;
}

export function useBatchNodeOps({
  investigation,
  activeInvestigationId,
  selectedNodeIds,
  setSelectedNodeIds,
  updateWallet,
  deleteWallet,
  createGroup,
  setNodeGroup,
  extractToTrace,
}: UseBatchNodeOpsArgs) {
  const handleBatchRename = useCallback((prefix: string) => {
    selectedNodeIds.forEach(({ id, traceId }, i) => {
      updateWallet(traceId, id, { label: `${prefix} ${i + 1}` });
    });
    setSelectedNodeIds([]);
  }, [selectedNodeIds, updateWallet, setSelectedNodeIds]);

  const handleBatchRecolor = useCallback((color: string) => {
    selectedNodeIds.forEach(({ id, traceId }) => {
      updateWallet(traceId, id, { color });
    });
    setSelectedNodeIds([]);
  }, [selectedNodeIds, updateWallet, setSelectedNodeIds]);

  const handleBatchDelete = useCallback(() => {
    selectedNodeIds.forEach(({ id, traceId }) => {
      deleteWallet(traceId, id);
    });
    setSelectedNodeIds([]);
  }, [selectedNodeIds, deleteWallet, setSelectedNodeIds]);

  const handleGroupNodes = useCallback((name: string) => {
    if (selectedNodeIds.length < 2) return;
    const traceId = selectedNodeIds[0].traceId;
    const group: Group = { id: crypto.randomUUID(), name, traceId };
    createGroup(traceId, group, selectedNodeIds.map((n) => n.id));
    setSelectedNodeIds([]);
  }, [selectedNodeIds, createGroup, setSelectedNodeIds]);

  const selectedGroupEntry = useMemo(() => {
    if (!investigation || selectedNodeIds.length < 2) return null;
    for (const { id, traceId } of selectedNodeIds) {
      const trace = investigation.traces.find((t) => t.id === traceId);
      const group = (trace?.groups || []).find((g) => g.id === id);
      if (group) return { group, traceId };
    }
    return null;
  }, [selectedNodeIds, investigation]);

  const handleAddToGroup = useCallback(() => {
    if (!selectedGroupEntry) return;
    const { group, traceId } = selectedGroupEntry;
    const nodeIds = selectedNodeIds
      .filter(({ id }) => id !== group.id)
      .map(({ id }) => id);
    setNodeGroup(traceId, nodeIds, group.id);
    setSelectedNodeIds([]);
  }, [selectedGroupEntry, selectedNodeIds, setNodeGroup, setSelectedNodeIds]);

  const handleExtractToTrace = useCallback(async () => {
    if (!activeInvestigationId || selectedNodeIds.length < 2) return;
    const color = TRACE_COLORS[(investigation?.traces.length || 0) % TRACE_COLORS.length];
    const name = `Trace ${(investigation?.traces.length || 0) + 1}`;
    try {
      const created = await apiClient.createTrace(activeInvestigationId, { name, color });
      const newTrace: Trace = {
        id: created.id,
        name: created.name,
        criteria: { type: 'wallet-group' },
        visible: true,
        collapsed: false,
        color,
        nodes: [],
        edges: [],
        position: { x: 0, y: 0 },
      };
      extractToTrace(selectedNodeIds.map((n) => n.id), newTrace);
      setSelectedNodeIds([]);
    } catch (err) {
      console.error('Failed to extract to trace:', err);
    }
  }, [activeInvestigationId, selectedNodeIds, investigation?.traces.length, extractToTrace, setSelectedNodeIds]);

  return {
    handleBatchRename,
    handleBatchRecolor,
    handleBatchDelete,
    handleGroupNodes,
    selectedGroupEntry,
    handleAddToGroup,
    handleExtractToTrace,
  };
}
