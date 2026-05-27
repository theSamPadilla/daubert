'use client';

import { useCallback, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { buildGraphContextMenu, buildLabelContextMenu } from '@/components/Graph/graphContextMenu';
import type { ContextMenuItem } from '@/components/Graph/ContextMenu';
import type { CytoscapeCallbacks } from '@/hooks/useCytoscape';
import type { GraphCanvasHandle } from '@/components/Graph/GraphCanvas';
import type { Investigation, WalletNode, Trace, TraceLabel } from '@/types/investigation';
import type { PanelMode } from '@/types/panel';

const TRACE_COLORS = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308', '#ef4444'];

interface UseGraphContextMenuArgs {
  investigation: Investigation | null;
  activeInvestigationId: string | null;
  graphRef: React.RefObject<GraphCanvasHandle>;

  addTrace: (trace: Trace) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateWallet: (traceId: string, walletId: string, patch: Partial<WalletNode>) => void;
  updateGroup: (traceId: string, groupId: string, patch: { size: number }) => void;
  deleteWallet: (traceId: string, walletId: string) => void;
  deleteTransaction: (traceId: string, txId: string) => void;
  toggleTraceVisibility: (traceId: string) => void;
  toggleTraceCollapsed: (traceId: string) => void;
  addLabel: (traceId: string, label: TraceLabel) => void;
  deleteLabel: (traceId: string, labelId: string) => void;

  setSelectedItem: (item: any) => void;
  setSelectedNodeIds: (ids: { id: string; traceId: string }[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  setPanelMode: (mode: PanelMode) => void;
  setContextMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void;
  onFetchHistory: (address: string, chain: string) => void;
  resolveFocusItem: (focusItem: any, investigation: Investigation | null) => any;
}

export function useGraphContextMenu(args: UseGraphContextMenuArgs) {
  const {
    investigation, activeInvestigationId, graphRef,
    addTrace, updateNodePosition, updateWallet, updateGroup,
    deleteWallet, deleteTransaction, toggleTraceVisibility, toggleTraceCollapsed,
    addLabel, deleteLabel,
    setSelectedItem, setSelectedNodeIds, setSelectedEdgeIds, setPanelMode, setContextMenu,
    onFetchHistory, resolveFocusItem,
  } = args;

  const [lastFocusedTraceId, setLastFocusedTraceId] = useState<string | null>(null);

  const handleAddTrace = useCallback(async (): Promise<string | undefined> => {
    if (!activeInvestigationId) return undefined;
    const color = TRACE_COLORS[(investigation?.traces.length || 0) % TRACE_COLORS.length];
    const name = `Trace ${(investigation?.traces.length || 0) + 1}`;
    try {
      const created = await apiClient.createTrace(activeInvestigationId, { name, color });
      const trace: Trace = {
        id: created.id, name: created.name, criteria: { type: 'custom' },
        visible: true, collapsed: false, color, nodes: [], edges: [], position: { x: 0, y: 0 },
      };
      addTrace(trace);
      setSelectedItem({ type: 'trace', data: trace });
      return trace.id;
    } catch (err) {
      console.error('Failed to create trace:', err);
      return undefined;
    }
  }, [addTrace, investigation?.traces.length, activeInvestigationId, setSelectedItem]);

  const handleCreateWalletAtPosition = useCallback((position: { x: number; y: number }) => {
    setPanelMode({ type: 'createWallet', position });
  }, [setPanelMode]);

  const handleContextMenu = useCallback(
    (event: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number; modelPosition?: { x: number; y: number } }) => {
      if (!investigation) return;
      const items = buildGraphContextMenu(event, {
        investigation, lastFocusedTraceId, setLastFocusedTraceId, setSelectedItem,
        toggleTraceVisibility, toggleTraceCollapsed, deleteWallet, deleteTransaction,
        addLabel, deleteLabel, handleCreateWalletAtPosition, handleAddTrace,
        handleFetchHistory: onFetchHistory, graphRef,
      });
      if (items.length > 0) setContextMenu({ x: event.x, y: event.y, items });
    },
    [investigation, lastFocusedTraceId, toggleTraceVisibility, toggleTraceCollapsed,
     deleteWallet, deleteTransaction, onFetchHistory, handleCreateWalletAtPosition,
     handleAddTrace, addLabel, deleteLabel, setSelectedItem, setContextMenu, graphRef]
  );

  const handleLabelContextMenu = useCallback(
    (traceId: string, labelId: string, x: number, y: number) => {
      if (!investigation) return;
      const items = buildLabelContextMenu(traceId, labelId, {
        investigation, lastFocusedTraceId, setLastFocusedTraceId,
        setSelectedItem, toggleTraceVisibility, toggleTraceCollapsed, deleteWallet,
        deleteTransaction, addLabel, deleteLabel, handleCreateWalletAtPosition,
        handleAddTrace, handleFetchHistory: onFetchHistory, graphRef,
      });
      setContextMenu({ x, y, items });
    },
    [deleteLabel, graphRef, investigation, lastFocusedTraceId, setSelectedItem,
     toggleTraceVisibility, toggleTraceCollapsed, deleteWallet, deleteTransaction,
     addLabel, handleCreateWalletAtPosition, handleAddTrace, onFetchHistory, setContextMenu]
  );

  const cytoscapeCallbacks: CytoscapeCallbacks = useMemo(() => ({
    onSelectionChange: ({ nodeIds, edgeIds, focusItem }) => {
      setSelectedNodeIds(nodeIds);
      setSelectedEdgeIds(edgeIds);
      setSelectedItem(resolveFocusItem(focusItem, investigation));
      if (focusItem && focusItem.type !== 'trace' && 'traceId' in focusItem) {
        setLastFocusedTraceId(focusItem.traceId);
      } else if (focusItem?.type === 'trace') {
        setLastFocusedTraceId(focusItem.id);
      }
    },
    onNodeDrag: updateNodePosition,
    onGroupDrag: (groupId, newPos) => {
      if (!investigation) return;
      for (const trace of investigation.traces) {
        const group = (trace.groups || []).find((g) => g.id === groupId);
        if (!group) continue;
        const members = trace.nodes.filter((n) => n.groupId === groupId);
        if (members.length === 0) break;
        const oldCx = members.reduce((s, n) => s + n.position.x, 0) / members.length;
        const oldCy = members.reduce((s, n) => s + n.position.y, 0) / members.length;
        const dx = newPos.x - oldCx;
        const dy = newPos.y - oldCy;
        members.forEach((n) => updateNodePosition(n.id, { x: n.position.x + dx, y: n.position.y + dy }));
        break;
      }
    },
    onResizeNode: (nodeId, traceId, size) => {
      const isGroup = investigation?.traces.some((t) => (t.groups || []).some((g) => g.id === nodeId));
      if (isGroup) updateGroup(traceId, nodeId, { size });
      else updateWallet(traceId, nodeId, { size });
    },
    onContextMenu: handleContextMenu,
  }), [
    updateNodePosition, updateWallet, updateGroup, investigation,
    handleContextMenu, handleCreateWalletAtPosition,
    setSelectedNodeIds, setSelectedEdgeIds, setSelectedItem, resolveFocusItem,
  ]);

  return {
    lastFocusedTraceId,
    handleAddTrace,
    handleCreateWalletAtPosition,
    handleContextMenu,
    handleLabelContextMenu,
    cytoscapeCallbacks,
  };
}
