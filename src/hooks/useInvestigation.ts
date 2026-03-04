import { useReducer, useCallback } from 'react';
import { Investigation, Trace, WalletNode, TransactionEdge } from '../types/investigation';

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
  | { type: 'UPDATE_NODE_POSITION'; payload: { nodeId: string; position: { x: number; y: number } } };

function mapTrace(state: Investigation | null, traceId: string, fn: (trace: Trace) => Trace): Investigation | null {
  if (!state) return state;
  return {
    ...state,
    traces: state.traces.map((t) => (t.id === traceId ? fn(t) : t)),
  };
}

function investigationReducer(state: Investigation | null, action: Action): Investigation | null {
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

    case 'DELETE_WALLET': {
      return mapTrace(state, action.payload.traceId, (t) => ({
        ...t,
        nodes: t.nodes.filter((n) => n.id !== action.payload.walletId),
        edges: t.edges.filter(
          (e) => e.from !== action.payload.walletId && e.to !== action.payload.walletId
        ),
      }));
    }

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

    default:
      return state;
  }
}

export function useInvestigation(initial: Investigation | null) {
  const [investigation, dispatch] = useReducer(investigationReducer, initial);

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

  return {
    investigation,
    dispatch,
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
  };
}
