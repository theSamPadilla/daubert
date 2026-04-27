// backend/src/modules/ai/investigation-data.utils.ts

export interface AgentNode {
  id: string;
  address: string;
  chain: string;
  label: string;
  tags: string[];
  notes?: string;
  addressType?: string;
  groupId?: string;
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
