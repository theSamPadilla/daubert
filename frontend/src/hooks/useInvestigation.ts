import { useReducer, useCallback, useEffect } from 'react';
import { Investigation, Trace, WalletNode, TransactionEdge, Group, EdgeBundle } from '../types/investigation';

// Action types
type Action =
  | { type: 'SET_INVESTIGATION'; payload: Investigation | null }
  | { type: 'ADD_TRACE'; payload: Trace }
  | { type: 'UPDATE_TRACE'; payload: { traceId: string; updates: Partial<Trace> } }
  | { type: 'DELETE_TRACE'; payload: string }
  | { type: 'TOGGLE_TRACE_VISIBILITY'; payload: string }
  | { type: 'TOGGLE_TRACE_COLLAPSED'; payload: string }
  | { type: 'ADD_WALLET'; payload: { traceId: string; wallet: WalletNode } }
  | { type: 'UPDATE_WALLET'; payload: { traceId: string; walletId: string; updates: Partial<WalletNode> } }
  | { type: 'DELETE_WALLET'; payload: { traceId: string; walletId: string } }
  | { type: 'ADD_TRANSACTION'; payload: { traceId: string; transaction: TransactionEdge } }
  | { type: 'UPDATE_TRANSACTION'; payload: { traceId: string; transactionId: string; updates: Partial<TransactionEdge> } }
  | { type: 'DELETE_TRANSACTION'; payload: { traceId: string; transactionId: string } }
  | { type: 'UPDATE_NODE_POSITION'; payload: { nodeId: string; position: { x: number; y: number } } }
  | { type: 'EXTRACT_TO_TRACE'; payload: { nodeIds: string[]; newTrace: Trace } }
  | { type: 'CREATE_GROUP'; payload: { traceId: string; group: Group; nodeIds: string[] } }
  | { type: 'UPDATE_GROUP'; payload: { traceId: string; groupId: string; updates: Partial<Group> } }
  | { type: 'DELETE_GROUP'; payload: { traceId: string; groupId: string } }
  | { type: 'SET_NODE_GROUP'; payload: { traceId: string; nodeIds: string[]; groupId: string | null } }
  | { type: 'ADD_EDGE_BUNDLE'; payload: { traceId: string; bundle: EdgeBundle } }
  | { type: 'UPDATE_EDGE_BUNDLE'; payload: { traceId: string; bundleId: string; updates: Partial<EdgeBundle> } }
  | { type: 'TOGGLE_EDGE_BUNDLE'; payload: { traceId: string; bundleId: string } }
  | { type: 'DELETE_EDGE_BUNDLE'; payload: { traceId: string; bundleId: string } }
  | { type: 'UNDO' };

// Actions that bypass the history stack (too granular or are load operations)
const SKIP_HISTORY = new Set<Action['type']>(['SET_INVESTIGATION', 'UPDATE_NODE_POSITION', 'UNDO']);

const MAX_HISTORY = 50;

interface HistoryState {
  past: (Investigation | null)[];
  present: Investigation | null;
}

// ─── Pure investigation logic ────────────────────────────────────────────────

function aggregateCrossEdges(
  edges: TransactionEdge[],
  representativeNodeId: string,
  isOutgoing: boolean
): TransactionEdge[] {
  const groups = new Map<string, TransactionEdge[]>();
  for (const edge of edges) {
    const key = isOutgoing
      ? `${edge.to}::${edge.token.symbol}::${edge.token.address}`
      : `${edge.from}::${edge.token.symbol}::${edge.token.address}`;
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }
  const result: TransactionEdge[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    let totalAmount = BigInt(0);
    let totalUsd = 0;
    for (const edge of group) {
      try { totalAmount += BigInt(edge.amount); } catch { /* skip non-integer */ }
      totalUsd += edge.usdValue ?? 0;
    }
    const isMultiple = group.length > 1;

    // Sum amounts robustly: try BigInt for raw integer strings, fall back to
    // parseFloat for pre-formatted values (e.g. "1.5", "1,000,000")
    let sumBigInt = BigInt(0);
    let sumFloat = 0;
    let allBigInt = true;
    for (const edge of group) {
      try {
        sumBigInt += BigInt(edge.amount);
      } catch {
        allBigInt = false;
        sumFloat += parseFloat(String(edge.amount).replace(/,/g, '')) || 0;
      }
    }
    if (!allBigInt) {
      // Add the BigInt portion accumulated before first failure
      sumFloat += Number(sumBigInt);
    }
    const aggregatedAmount = allBigInt ? sumBigInt.toString() : sumFloat.toString();

    result.push({
      ...first,
      id: crypto.randomUUID(),
      from: isOutgoing ? representativeNodeId : first.from,
      to: isOutgoing ? first.to : representativeNodeId,
      amount: aggregatedAmount,
      usdValue: totalUsd > 0 ? totalUsd : undefined,
      token: {
        address: first.token?.address ?? '',
        symbol: first.token?.symbol ?? '',
        decimals: first.token?.decimals ?? 0,
      },
      txHash: isMultiple ? 'aggregated' : first.txHash,
      blockNumber: isMultiple ? 0 : first.blockNumber,
      label: isMultiple ? `${group.length} txns aggregated` : (first.label ?? ''),
      notes: isMultiple
        ? `Aggregated from ${group.length} transactions:\n${group.map((e) => e.txHash).join('\n')}`
        : first.notes,
      crossTrace: true,
    });
  }
  return result;
}

function mapTrace(state: Investigation | null, traceId: string, fn: (trace: Trace) => Trace): Investigation | null {
  if (!state) return state;
  return {
    ...state,
    traces: state.traces.map((t) => (t.id === traceId ? fn(t) : t)),
  };
}

function applyAction(state: Investigation | null, action: Action): Investigation | null {
  switch (action.type) {
    case 'SET_INVESTIGATION':
      return action.payload;

    case 'ADD_TRACE':
      if (!state) return state;
      return { ...state, traces: [...state.traces, action.payload] };

    case 'UPDATE_TRACE':
      return mapTrace(state, action.payload.traceId, (t) => ({ ...t, ...action.payload.updates }));

    case 'DELETE_TRACE':
      if (!state) return state;
      return { ...state, traces: state.traces.filter((t) => t.id !== action.payload) };

    case 'TOGGLE_TRACE_VISIBILITY':
      return mapTrace(state, action.payload, (t) => ({ ...t, visible: !t.visible }));

    case 'TOGGLE_TRACE_COLLAPSED':
      return mapTrace(state, action.payload, (t) => ({ ...t, collapsed: !t.collapsed }));

    case 'ADD_WALLET':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        nodes: [...t.nodes, action.payload.wallet],
      }));

    case 'UPDATE_WALLET':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        nodes: t.nodes.map((n) =>
          n.id === action.payload.walletId ? { ...n, ...action.payload.updates } : n
        ),
      }));

    case 'DELETE_WALLET':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        nodes: t.nodes.filter((n) => n.id !== action.payload.walletId),
        edges: t.edges.filter(
          (e) => e.from !== action.payload.walletId && e.to !== action.payload.walletId
        ),
      }));

    case 'ADD_TRANSACTION':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        edges: [...t.edges, action.payload.transaction],
      }));

    case 'UPDATE_TRANSACTION':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        edges: t.edges.map((e) =>
          e.id === action.payload.transactionId ? { ...e, ...action.payload.updates } : e
        ),
      }));

    case 'DELETE_TRANSACTION':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        edges: t.edges.filter((e) => e.id !== action.payload.transactionId),
      }));

    case 'UPDATE_NODE_POSITION': {
      if (!state) return state;
      return {
        ...state,
        traces: state.traces.map((t) => ({
          ...t,
          nodes: t.nodes.map((n) =>
            n.id === action.payload.nodeId ? { ...n, position: action.payload.position } : n
          ),
        })),
      };
    }

    case 'CREATE_GROUP': {
      const { traceId, group, nodeIds } = action.payload;
      const nodeIdSet = new Set(nodeIds);
      return mapTrace(state, traceId, (t) => ({
        ...t,
        groups: [...(t.groups || []), group],
        nodes: t.nodes.map((n) => nodeIdSet.has(n.id) ? { ...n, groupId: group.id } : n),
      }));
    }

    case 'UPDATE_GROUP':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        groups: (t.groups || []).map((g) =>
          g.id === action.payload.groupId ? { ...g, ...action.payload.updates } : g
        ),
      }));

    case 'DELETE_GROUP':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        groups: (t.groups || []).filter((g) => g.id !== action.payload.groupId),
        nodes: t.nodes.map((n) =>
          n.groupId === action.payload.groupId ? { ...n, groupId: undefined } : n
        ),
      }));

    case 'SET_NODE_GROUP': {
      const { traceId, nodeIds, groupId } = action.payload;
      const nodeIdSet = new Set(nodeIds);
      return mapTrace(state, traceId, (t) => ({
        ...t,
        nodes: t.nodes.map((n) =>
          nodeIdSet.has(n.id) ? { ...n, groupId: groupId ?? undefined } : n
        ),
      }));
    }

    case 'ADD_EDGE_BUNDLE':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        edgeBundles: [...(t.edgeBundles || []), action.payload.bundle],
      }));

    case 'UPDATE_EDGE_BUNDLE':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        edgeBundles: (t.edgeBundles || []).map((b) =>
          b.id === action.payload.bundleId ? { ...b, ...action.payload.updates } : b
        ),
      }));

    case 'TOGGLE_EDGE_BUNDLE':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        edgeBundles: (t.edgeBundles || []).map((b) =>
          b.id === action.payload.bundleId ? { ...b, collapsed: !b.collapsed } : b
        ),
      }));

    case 'DELETE_EDGE_BUNDLE':
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        edgeBundles: (t.edgeBundles || []).filter((b) => b.id !== action.payload.bundleId),
      }));

    case 'EXTRACT_TO_TRACE': {
      if (!state) return state;
      const { nodeIds, newTrace } = action.payload;
      const nodeIdSet = new Set(nodeIds);

      const selectedNodes: WalletNode[] = [];
      for (const trace of state.traces) {
        for (const node of trace.nodes) {
          if (nodeIdSet.has(node.id)) {
            selectedNodes.push({ ...node, parentTrace: newTrace.id, groupId: undefined });
          }
        }
      }
      const representativeId = selectedNodes[0]?.id;
      if (!representativeId) return state;

      const internalEdges: TransactionEdge[] = [];
      const crossEdgesIn: TransactionEdge[] = [];
      const crossEdgesOut: TransactionEdge[] = [];
      for (const trace of state.traces) {
        for (const edge of trace.edges) {
          const fromSelected = nodeIdSet.has(edge.from);
          const toSelected = nodeIdSet.has(edge.to);
          if (fromSelected && toSelected) {
            internalEdges.push({ ...edge });
          } else if (!fromSelected && toSelected) {
            crossEdgesIn.push({ ...edge });
          } else if (fromSelected && !toSelected) {
            crossEdgesOut.push({ ...edge });
          }
        }
      }

      const filledTrace: Trace = {
        ...newTrace,
        nodes: selectedNodes,
        edges: [
          ...internalEdges,
          ...aggregateCrossEdges(crossEdgesIn, representativeId, false),
          ...aggregateCrossEdges(crossEdgesOut, representativeId, true),
        ],
      };

      const updatedTraces = state.traces.map((trace) => ({
        ...trace,
        nodes: trace.nodes.filter((n) => !nodeIdSet.has(n.id)),
        edges: trace.edges.filter((e) => !nodeIdSet.has(e.from) && !nodeIdSet.has(e.to)),
      }));

      return { ...state, traces: [...updatedTraces, filledTrace] };
    }

    default:
      return state;
  }
}

// ─── History-aware wrapper reducer ──────────────────────────────────────────

function historyReducer(state: HistoryState, action: Action): HistoryState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      present: previous,
    };
  }

  const nextPresent = applyAction(state.present, action);

  // SET_INVESTIGATION resets history entirely (fresh load)
  if (action.type === 'SET_INVESTIGATION') {
    return { past: [], present: nextPresent };
  }

  if (SKIP_HISTORY.has(action.type)) {
    return { ...state, present: nextPresent };
  }

  return {
    past: [...state.past.slice(-MAX_HISTORY + 1), state.present],
    present: nextPresent,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useInvestigation(initial: Investigation | null) {
  const [{ past, present: investigation }, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initial,
  });

  const canUndo = past.length > 0;

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);

  // Cmd+Z / Ctrl+Z keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const setInvestigation = useCallback(
    (inv: Investigation | null) => dispatch({ type: 'SET_INVESTIGATION', payload: inv }),
    []
  );

  const addTrace = useCallback(
    (trace: Trace) => dispatch({ type: 'ADD_TRACE', payload: trace }),
    []
  );

  const updateTrace = useCallback(
    (traceId: string, updates: Partial<Trace>) =>
      dispatch({ type: 'UPDATE_TRACE', payload: { traceId, updates } }),
    []
  );

  const deleteTrace = useCallback(
    (traceId: string) => dispatch({ type: 'DELETE_TRACE', payload: traceId }),
    []
  );

  const toggleTraceVisibility = useCallback(
    (traceId: string) => dispatch({ type: 'TOGGLE_TRACE_VISIBILITY', payload: traceId }),
    []
  );

  const toggleTraceCollapsed = useCallback(
    (traceId: string) => dispatch({ type: 'TOGGLE_TRACE_COLLAPSED', payload: traceId }),
    []
  );

  const addWallet = useCallback(
    (traceId: string, wallet: WalletNode) =>
      dispatch({ type: 'ADD_WALLET', payload: { traceId, wallet } }),
    []
  );

  const updateWallet = useCallback(
    (traceId: string, walletId: string, updates: Partial<WalletNode>) =>
      dispatch({ type: 'UPDATE_WALLET', payload: { traceId, walletId, updates } }),
    []
  );

  const deleteWallet = useCallback(
    (traceId: string, walletId: string) =>
      dispatch({ type: 'DELETE_WALLET', payload: { traceId, walletId } }),
    []
  );

  const addTransaction = useCallback(
    (traceId: string, transaction: TransactionEdge) =>
      dispatch({ type: 'ADD_TRANSACTION', payload: { traceId, transaction } }),
    []
  );

  const updateTransaction = useCallback(
    (traceId: string, transactionId: string, updates: Partial<TransactionEdge>) =>
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { traceId, transactionId, updates } }),
    []
  );

  const deleteTransaction = useCallback(
    (traceId: string, transactionId: string) =>
      dispatch({ type: 'DELETE_TRANSACTION', payload: { traceId, transactionId } }),
    []
  );

  const updateNodePosition = useCallback(
    (nodeId: string, position: { x: number; y: number }) =>
      dispatch({ type: 'UPDATE_NODE_POSITION', payload: { nodeId, position } }),
    []
  );

  const extractToTrace = useCallback(
    (nodeIds: string[], newTrace: Trace) =>
      dispatch({ type: 'EXTRACT_TO_TRACE', payload: { nodeIds, newTrace } }),
    []
  );

  const createGroup = useCallback(
    (traceId: string, group: Group, nodeIds: string[]) =>
      dispatch({ type: 'CREATE_GROUP', payload: { traceId, group, nodeIds } }),
    []
  );

  const updateGroup = useCallback(
    (traceId: string, groupId: string, updates: Partial<Group>) =>
      dispatch({ type: 'UPDATE_GROUP', payload: { traceId, groupId, updates } }),
    []
  );

  const deleteGroup = useCallback(
    (traceId: string, groupId: string) =>
      dispatch({ type: 'DELETE_GROUP', payload: { traceId, groupId } }),
    []
  );

  const setNodeGroup = useCallback(
    (traceId: string, nodeIds: string[], groupId: string | null) =>
      dispatch({ type: 'SET_NODE_GROUP', payload: { traceId, nodeIds, groupId } }),
    []
  );

  const addEdgeBundle = useCallback(
    (traceId: string, bundle: EdgeBundle) =>
      dispatch({ type: 'ADD_EDGE_BUNDLE', payload: { traceId, bundle } }),
    []
  );

  const updateEdgeBundle = useCallback(
    (traceId: string, bundleId: string, updates: Partial<EdgeBundle>) =>
      dispatch({ type: 'UPDATE_EDGE_BUNDLE', payload: { traceId, bundleId, updates } }),
    []
  );

  const toggleEdgeBundle = useCallback(
    (traceId: string, bundleId: string) =>
      dispatch({ type: 'TOGGLE_EDGE_BUNDLE', payload: { traceId, bundleId } }),
    []
  );

  const deleteEdgeBundle = useCallback(
    (traceId: string, bundleId: string) =>
      dispatch({ type: 'DELETE_EDGE_BUNDLE', payload: { traceId, bundleId } }),
    []
  );

  return {
    investigation,
    dispatch,
    canUndo,
    undo,
    setInvestigation,
    addTrace,
    updateTrace,
    deleteTrace,
    toggleTraceVisibility,
    toggleTraceCollapsed,
    addWallet,
    updateWallet,
    deleteWallet,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    updateNodePosition,
    extractToTrace,
    createGroup,
    updateGroup,
    deleteGroup,
    setNodeGroup,
    addEdgeBundle,
    updateEdgeBundle,
    toggleEdgeBundle,
    deleteEdgeBundle,
  };
}
