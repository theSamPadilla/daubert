// backend/src/modules/ai/investigation-data.utils.ts

import type { SolanaContext } from '../blockchain/types';

export interface AgentNode {
  id: string;
  address: string;
  chain: string;
  label: string;
  tags: string[];
  notes?: string;
  addressType?: string;
  groupId?: string;
  /** 'txJunction' for Bitcoin transaction junctions; absent for wallets. */
  kind?: string;
}

/**
 * A COUNT-ONLY view of an edge's UTXO provenance.
 *
 * The full inputs/outputs arrays are deliberately NOT sent to the agent: a
 * 400-input consolidation would blow the context window for information the
 * model can request on demand. Counts, fee, and the change verdict for this
 * particular edge are what a model needs to reason about the flow.
 */
export interface AgentUtxoSummary {
  inputs: number;
  outputs: number;
  /** Satoshis, as a decimal string. */
  fee: string;
  /** Which output of the transaction this edge represents. */
  vout?: number;
  /** 'input' | 'output' on junction leg edges. */
  legType?: string;
  warnings?: string[];
  /**
   * True when THIS edge's output is flagged as change. Absent means "not
   * flagged" — change detection is an inference, so we surface only the
   * positive verdict rather than asserting a negative.
   */
  change?: boolean;
}

export interface AgentEdge {
  id: string;
  from: string;
  to: string;
  fromAddress: string | null;
  toAddress: string | null;
  txHash: string;
  chain: string;
  timestamp: string;
  amount: string;
  token: string;
  blockNumber?: number;
  tags: string[];
  notes?: string;
  crossTrace?: boolean;
  utxoSummary?: AgentUtxoSummary;
  /**
   * Solana per-transfer context, forwarded WHOLE — unlike `utxo`, which is
   * summarized. SolanaContext is bounded (~12 scalars, no arrays of objects),
   * so there is nothing to collapse and the transferIndex / spam verdict are
   * exactly what the model needs to tell two legs of one signature apart.
   */
  solana?: SolanaContext;
}

export interface AgentGroup {
  id: string;
  name: string;
  nodeIds: string[];
}

export interface AgentEdgeBundle {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  token: string;
  edgeIds: string[];
}

export interface AgentTraceData {
  nodes: AgentNode[];
  edges: AgentEdge[];
  groups: AgentGroup[];
  edgeBundles: AgentEdgeBundle[];
}

/**
 * Collapse an edge's raw `utxo` block into counts + this edge's own slice.
 *
 * Junction LEG edges carry a slim context with no fee and no transaction-wide
 * inputs/outputs — the full ledger record lives once on the junction node. An
 * input leg therefore summarizes as 0/0 with an empty fee; an output leg
 * carries a single-entry `outputs` array describing only its OWN output, so it
 * summarizes as 0 in / 1 out and its change verdict still surfaces. Both are
 * honest: the leg carries exactly the slice it represents.
 *
 * Exported: also reused by the MCP blockchain_fetch_history handler
 * (mcp/tools/blockchain-tools.ts) to collapse each row's `utxo` block before
 * the 8 KB result cap is applied — same duck-typed shape (a TransactionResult
 * row's UtxoContext), same reasoning (never send raw inputs/outputs arrays to
 * a model).
 */
export function summarizeUtxo(utxo: unknown): AgentUtxoSummary | undefined {
  if (!utxo || typeof utxo !== 'object') return undefined;
  const u = utxo as Record<string, any>;

  const inputs = Array.isArray(u.inputs) ? u.inputs.length : 0;
  const outputs = Array.isArray(u.outputs) ? u.outputs.length : 0;
  const vout = typeof u.vout === 'number' ? u.vout : undefined;

  // The change verdict that applies to THIS edge is the one on the output the
  // edge represents — not any change output elsewhere in the transaction.
  const ownOutput =
    vout !== undefined && Array.isArray(u.outputs)
      ? u.outputs.find((o: any) => o?.index === vout)
      : undefined;
  const change = ownOutput?.change === true ? true : undefined;

  const warnings =
    Array.isArray(u.warnings) && u.warnings.length > 0 ? u.warnings : undefined;

  return {
    inputs,
    outputs,
    fee: typeof u.fee === 'string' ? u.fee : '',
    vout,
    legType: typeof u.legType === 'string' ? u.legType : undefined,
    warnings,
    change,
  };
}

export function stripTraceForAgent(data: Record<string, unknown>): AgentTraceData {
  const rawNodes: any[] = (data as any)?.nodes || [];
  const rawEdges: any[] = (data as any)?.edges || [];
  const rawGroups: any[] = (data as any)?.groups || [];
  const rawBundles: any[] = (data as any)?.edgeBundles || [];

  const nodeIdToAddress = new Map<string, string>();
  for (const n of rawNodes) {
    if (n.id && n.address) nodeIdToAddress.set(n.id, n.address);
  }

  const nodes: AgentNode[] = rawNodes.map((n) => ({
    id: n.id,
    address: n.address,
    chain: n.chain,
    label: n.label,
    tags: n.tags ?? [],
    notes: n.notes || undefined,
    addressType: n.addressType || undefined,
    groupId: n.groupId || undefined,
    kind: n.kind || undefined,
  }));

  const edges: AgentEdge[] = rawEdges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    fromAddress: nodeIdToAddress.get(e.from) ?? null,
    toAddress: nodeIdToAddress.get(e.to) ?? null,
    txHash: e.txHash,
    chain: e.chain,
    timestamp: e.timestamp,
    amount: e.amount,
    token: e.token,
    blockNumber: e.blockNumber ?? undefined,
    tags: e.tags ?? [],
    notes: e.notes || undefined,
    crossTrace: e.crossTrace || undefined,
    // Counts only — the raw inputs/outputs arrays never reach the agent.
    utxoSummary: summarizeUtxo(e.utxo),
    // Passed through AS-IS: SolanaContext is a bounded scalar record, so there
    // is no oversized payload to summarize away (contrast `utxo` above).
    solana: e.solana ?? undefined,
  }));

  const groupNodeIds = new Map<string, string[]>();
  for (const n of rawNodes) {
    if (n.groupId) {
      const list = groupNodeIds.get(n.groupId) || [];
      list.push(n.id);
      groupNodeIds.set(n.groupId, list);
    }
  }
  const groups: AgentGroup[] = rawGroups.map((g) => ({
    id: g.id,
    name: g.name,
    nodeIds: groupNodeIds.get(g.id) || [],
  }));

  const edgeBundles: AgentEdgeBundle[] = rawBundles.map((b) => ({
    id: b.id,
    fromNodeId: b.fromNodeId,
    toNodeId: b.toNodeId,
    token: b.token,
    edgeIds: b.edgeIds ?? [],
  }));

  return { nodes, edges, groups, edgeBundles };
}

export function filterTraceData(
  data: AgentTraceData,
  address?: string,
  token?: string,
): AgentTraceData {
  if (!address && !token) return data;

  let { nodes, edges, groups, edgeBundles } = data;

  const addressMatchIds = new Set<string>();
  if (address) {
    const addr = address.toLowerCase();
    for (const n of nodes) {
      if (n.address?.toLowerCase() === addr) addressMatchIds.add(n.id);
    }
    edges = edges.filter(
      (e) => addressMatchIds.has(e.from) || addressMatchIds.has(e.to),
    );
  }

  if (token) {
    const tok = token.toLowerCase();
    edges = edges.filter((e) => e.token?.toLowerCase() === tok);
  }

  const edgeNodeIds = new Set(edges.flatMap((e) => [e.from, e.to]));
  const keepNodeIds = new Set([...addressMatchIds, ...edgeNodeIds]);
  nodes = nodes.filter((n) => keepNodeIds.has(n.id));

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const edgeIdSet = new Set(edges.map((e) => e.id));

  groups = groups
    .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => nodeIdSet.has(id)) }))
    .filter((g) => g.nodeIds.length > 0);

  edgeBundles = edgeBundles
    .map((b) => ({ ...b, edgeIds: b.edgeIds.filter((id) => edgeIdSet.has(id)) }))
    .filter((b) => b.edgeIds.length > 0);

  return { nodes, edges, groups, edgeBundles };
}
