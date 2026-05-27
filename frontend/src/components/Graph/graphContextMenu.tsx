/**
 * Graph right-click context menu builders.
 *
 * Extracted from page.tsx so the menu-item construction logic (+ icon imports) lives
 * separately from the page component. page.tsx calls buildGraphContextMenu /
 * buildLabelContextMenu, then passes the resulting items to setContextMenu.
 */

import { ReactNode } from 'react';
import {
  FaPenToSquare,
  FaEyeSlash,
  FaEye,
  FaCompress,
  FaExpand,
  FaPlus,
  FaTag,
  FaCodeBranch,
  FaClockRotateLeft,
  FaTrash,
} from 'react-icons/fa6';
import { type ContextMenuItem } from './ContextMenu';
import { Investigation, TraceLabel, WalletNode, TransactionEdge, EdgeBundle } from '../../types/investigation';
import { buildEdgeAnchor, resolveActiveTraceId } from './GraphCanvas';
import type { GraphCanvasHandle } from './GraphCanvas';

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface GraphContextMenuDeps {
  investigation: Investigation;
  lastFocusedTraceId: string | null;
  setLastFocusedTraceId: (id: string) => void;
  setSelectedItem: (item: any) => void;
  toggleTraceVisibility: (traceId: string) => void;
  toggleTraceCollapsed: (traceId: string) => void;
  deleteWallet: (traceId: string, walletId: string) => void;
  deleteTransaction: (traceId: string, txId: string) => void;
  addLabel: (traceId: string, label: TraceLabel) => void;
  deleteLabel: (traceId: string, labelId: string) => void;
  handleCreateWalletAtPosition: (position: { x: number; y: number }) => void;
  handleAddTrace: () => void;
  handleFetchHistory: (address: string, chain: string) => void;
  graphRef: React.RefObject<GraphCanvasHandle | null>;
}

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

function icon(Component: React.ComponentType<{ className?: string }>): ReactNode {
  return <Component />;
}

// ---------------------------------------------------------------------------
// buildGraphContextMenu
// ---------------------------------------------------------------------------

/**
 * Builds context menu items for right-clicks on the graph canvas
 * (background, trace compound nodes, wallet nodes, transaction edges, edge bundles).
 *
 * @param event  The raw context-menu event from Cytoscape (forwarded via CytoscapeCallbacks.onContextMenu).
 * @param deps   All state + callbacks needed to construct the items.
 * @returns      Array of ContextMenuItem (may be empty — caller should gate on length > 0).
 */
export function buildGraphContextMenu(
  event: {
    type: 'node' | 'edge' | 'background';
    id?: string;
    x: number;
    y: number;
    modelPosition?: { x: number; y: number };
  },
  deps: GraphContextMenuDeps,
): ContextMenuItem[] {
  const {
    investigation,
    lastFocusedTraceId,
    setLastFocusedTraceId,
    setSelectedItem,
    toggleTraceVisibility,
    toggleTraceCollapsed,
    deleteWallet,
    deleteTransaction,
    addLabel,
    handleCreateWalletAtPosition,
    handleAddTrace,
    handleFetchHistory,
  } = deps;

  const items: ContextMenuItem[] = [];

  /**
   * Base canvas items — always shown when right-clicking the canvas background or a
   * trace compound node. The model-space position is used to place free-floating labels.
   * When called from the trace-compound branch, modelPos comes from the node's event.position
   * (emitted by cytoscapeEvents.ts onCxtTapNode). When called from the background branch,
   * it comes from event.position on the background tap. The `separator` flag renders a
   * divider above the first base item when trace-specific items precede them.
   */
  const buildBaseItems = (
    modelPos: { x: number; y: number },
    activeTraceId: string | null,
    withSeparator: boolean,
  ): ContextMenuItem[] => [
    {
      label: 'Add Address Here',
      separator: withSeparator,
      icon: icon(FaPlus),
      onClick: () => handleCreateWalletAtPosition({ x: event.x, y: event.y }),
    },
    {
      label: 'Add label here',
      icon: icon(FaTag),
      onClick: () => {
        if (!activeTraceId) return;
        const newLabel: TraceLabel = {
          id: crypto.randomUUID(),
          text: 'New label',
          anchor: { type: 'free', x: modelPos.x, y: modelPos.y },
        };
        addLabel(activeTraceId, newLabel);
      },
    },
    { label: 'Add Trace', icon: icon(FaCodeBranch), onClick: handleAddTrace },
  ];

  if (event.type === 'node' && event.id) {
    const trace = investigation.traces.find((t) => t.id === event.id);
    if (trace) {
      // Track the focused trace so free-floating labels have an owner.
      setLastFocusedTraceId(trace.id);
      const modelPos = event.modelPosition ?? { x: 0, y: 0 };
      const activeTraceId = resolveActiveTraceId(investigation, trace.id);
      // Trace-compound right-click: trace-specific items first, then base canvas items
      // separated by a divider so users can still add addresses/labels/traces from here.
      items.push(
        { label: 'Edit Trace', icon: icon(FaPenToSquare), onClick: () => setSelectedItem({ type: 'trace', data: trace }) },
        {
          label: trace.visible ? 'Hide' : 'Show',
          icon: icon(trace.visible ? FaEyeSlash : FaEye),
          onClick: () => toggleTraceVisibility(trace.id),
        },
        {
          label: trace.collapsed ? 'Expand' : 'Collapse',
          icon: icon(trace.collapsed ? FaExpand : FaCompress),
          onClick: () => toggleTraceCollapsed(trace.id),
        },
        ...buildBaseItems(modelPos, activeTraceId, true),
      );
    } else {
      let walletData: { wallet: WalletNode; traceId: string } | undefined;
      for (const t of investigation.traces) {
        const w = t.nodes.find((n) => n.id === event.id);
        if (w) { walletData = { wallet: w, traceId: t.id }; break; }
      }
      if (walletData) {
        // Track the focused trace.
        setLastFocusedTraceId(walletData.traceId);
        const wd = walletData;
        // Node-anchored label: place above the node. dy is in model coords;
        // using a fixed offset of -40 model units (≈ one node radius at default size).
        items.push(
          { label: 'Edit Address', icon: icon(FaPenToSquare), onClick: () => setSelectedItem({ type: 'wallet', data: wd.wallet }) },
          { label: 'Fetch History', icon: icon(FaClockRotateLeft), onClick: () => handleFetchHistory(wd.wallet.address, wd.wallet.chain) },
          {
            label: 'Attach label to this node',
            icon: icon(FaTag),
            onClick: () => {
              const newLabel: TraceLabel = {
                id: crypto.randomUUID(),
                text: 'New label',
                anchor: { type: 'node', anchorId: wd.wallet.id, dx: 0, dy: -40 },
              };
              addLabel(wd.traceId, newLabel);
            },
          },
          { label: 'Delete Address', icon: icon(FaTrash), onClick: () => deleteWallet(wd.traceId, wd.wallet.id), danger: true },
        );
      }
    }
  } else if (event.type === 'edge' && event.id) {
    let txData: { tx: TransactionEdge; traceId: string } | undefined;
    let bundleData: { bundle: EdgeBundle; traceId: string } | undefined;
    for (const t of investigation.traces) {
      const tx = t.edges.find((e) => e.id === event.id);
      if (tx) { txData = { tx, traceId: t.id }; break; }
      const bundle = (t.edgeBundles ?? []).find((b) => b.id === event.id);
      if (bundle) { bundleData = { bundle, traceId: t.id }; break; }
    }
    if (txData) {
      const td = txData;
      items.push(
        { label: 'Edit Transaction', icon: icon(FaPenToSquare), onClick: () => setSelectedItem({ type: 'transaction', data: td.tx }) },
        {
          label: 'Attach label to this edge',
          icon: icon(FaTag),
          onClick: () => {
            const newLabel: TraceLabel = {
              id: crypto.randomUUID(),
              text: 'New label',
              anchor: buildEdgeAnchor(td.tx),
            };
            addLabel(td.traceId, newLabel);
          },
        },
        { label: 'Delete Transaction', icon: icon(FaTrash), onClick: () => deleteTransaction(td.traceId, td.tx.id), danger: true },
      );
    } else if (bundleData) {
      const bd = bundleData;
      items.push(
        {
          label: 'Attach label to this edge',
          icon: icon(FaTag),
          onClick: () => {
            const newLabel: TraceLabel = {
              id: crypto.randomUUID(),
              text: 'New label',
              anchor: buildEdgeAnchor(bd.bundle),
            };
            addLabel(bd.traceId, newLabel);
          },
        },
      );
    }
  } else if (event.type === 'background') {
    // Resolve the model-space position for the free-floating label.
    // modelPosition is emitted by cytoscapeEvents.ts from event.position (model coords).
    const modelPos = event.modelPosition ?? { x: 0, y: 0 };
    const activeTraceId = resolveActiveTraceId(investigation, lastFocusedTraceId);
    items.push(...buildBaseItems(modelPos, activeTraceId, false));
  }

  return items;
}

// ---------------------------------------------------------------------------
// buildLabelContextMenu
// ---------------------------------------------------------------------------

/**
 * Builds context menu items for right-clicks on a label overlay.
 *
 * @param traceId  The trace that owns the label.
 * @param labelId  The label being right-clicked.
 * @param deps     All state + callbacks needed to construct the items.
 * @returns        Array of ContextMenuItem (always 2 items: Edit + Delete).
 */
export function buildLabelContextMenu(
  traceId: string,
  labelId: string,
  deps: GraphContextMenuDeps,
): ContextMenuItem[] {
  const { deleteLabel, graphRef } = deps;
  return [
    {
      label: 'Edit Label',
      icon: icon(FaPenToSquare),
      onClick: () => {
        // Architectural note: editingLabel state lives in GraphCanvas (popover position
        // resolution depends on `cy`). We call requestEditLabel() on the graph ref to
        // trigger setEditingLabel inside GraphCanvas without lifting state up to page.tsx.
        graphRef.current?.requestEditLabel(traceId, labelId);
      },
    },
    {
      label: 'Delete Label',
      icon: icon(FaTrash),
      danger: true,
      onClick: () => deleteLabel(traceId, labelId),
    },
  ];
}
