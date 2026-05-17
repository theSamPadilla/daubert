// backend/src/modules/external-trace/graph-builder.ts
import type { TransactionResult } from '../blockchain/blockchain.service';

export interface GraphNode {
  id: string;
  address: string;
  chain: string;
  isRoot: boolean;
  txCount: number;
  label?: { name: string; category: string };
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  token: { address: string; symbol: string; decimals: number };
  amount: string;       // formatted decimal string, e.g. "1.5234"
  txCount: number;
  lastTimestamp: string;
  lastTxHash: string;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface BuildOptions {
  nodeCap?: number;
  edgeCap?: number;
}

interface InternalEdge {
  id: string;
  from: string;
  to: string;
  token: { address: string; symbol: string; decimals: number };
  rawAmount: bigint;
  txCount: number;
  lastTimestamp: string;
  lastTxHash: string;
}

function formatAmount(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  if (fraction === 0n) return whole.toString();
  const fracStr = fraction.toString().padStart(decimals, '0').slice(0, 4);
  const trimmed = fracStr.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function parseRaw(amount: string): bigint {
  try {
    return BigInt(amount);
  } catch {
    return 0n;
  }
}

export function buildGraph(
  txs: TransactionResult[],
  rootAddress: string,
  opts: BuildOptions = {},
): GraphResult {
  const nodeCap = opts.nodeCap ?? 100;
  const edgeCap = opts.edgeCap ?? 200;

  const nodesMap = new Map<string, GraphNode>();
  const edgesMap = new Map<string, InternalEdge>();
  let truncated = false;

  const ensureNode = (address: string, chain: string) => {
    if (nodesMap.has(address)) return nodesMap.get(address)!;
    if (nodesMap.size >= nodeCap) {
      truncated = true;
      return null;
    }
    const node: GraphNode = {
      id: address,
      address,
      chain,
      isRoot: address === rootAddress,
      txCount: 0,
    };
    nodesMap.set(address, node);
    return node;
  };

  for (const tx of txs) {
    if (!tx.from || !tx.to) continue;
    const fromNode = ensureNode(tx.from, tx.chain);
    const toNode = ensureNode(tx.to, tx.chain);
    if (!fromNode || !toNode) continue;
    fromNode.txCount += 1;
    toNode.txCount += 1;

    // Key by token.address so two contracts both calling themselves USDC stay separate.
    const edgeKey = `${tx.from}->${tx.to}->${tx.token.address}`;
    const raw = parseRaw(tx.amount);
    const existing = edgesMap.get(edgeKey);

    if (existing) {
      existing.rawAmount += raw;
      existing.txCount += 1;
      if (tx.timestamp > existing.lastTimestamp) {
        existing.lastTimestamp = tx.timestamp;
        existing.lastTxHash = tx.txHash;
      }
    } else {
      if (edgesMap.size >= edgeCap) {
        truncated = true;
        continue;
      }
      edgesMap.set(edgeKey, {
        id: edgeKey,
        from: tx.from,
        to: tx.to,
        token: { ...tx.token },
        rawAmount: raw,
        txCount: 1,
        lastTimestamp: tx.timestamp,
        lastTxHash: tx.txHash,
      });
    }
  }

  const edges: GraphEdge[] = [...edgesMap.values()].map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    token: e.token,
    amount: formatAmount(e.rawAmount, e.token.decimals),
    txCount: e.txCount,
    lastTimestamp: e.lastTimestamp,
    lastTxHash: e.lastTxHash,
  }));

  return {
    nodes: [...nodesMap.values()],
    edges,
    truncated,
  };
}
