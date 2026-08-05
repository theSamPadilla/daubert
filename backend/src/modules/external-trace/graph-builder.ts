// backend/src/modules/external-trace/graph-builder.ts
import type { TransactionResult } from '../blockchain/blockchain.service';
import type { UtxoContext } from '../blockchain/types';

export interface GraphNode {
  id: string;
  address: string;
  chain: string;
  isRoot: boolean;
  txCount: number;
  label: { name: string; category: string } | null;
  /** Present only on Bitcoin transaction-junction nodes (see graph-builder's BTC handling). */
  kind?: 'txJunction';
  /**
   * Counts-only summary of the junction's ledger record. Present only alongside
   * `kind: 'txJunction'`. The raw inputs/outputs arrays never leave the backend
   * on this public endpoint -- mirrors AgentUtxoSummary in
   * ai/investigation-data.utils.ts.
   */
  utxoSummary?: { inputs: number; outputs: number; fee: string };
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
      label: null,
    };
    nodesMap.set(address, node);
    return node;
  };

  // A BTC transaction with many inputs names no single sender. Rather than
  // inventing one, the row is drawn as a compact "N in / M out" junction node
  // standing for the transaction itself -- never marked root, even in the
  // (impossible in practice) case where a txid string equalled rootAddress.
  const ensureJunctionNode = (txHash: string, chain: string, utxo: UtxoContext) => {
    if (nodesMap.has(txHash)) return nodesMap.get(txHash)!;
    if (nodesMap.size >= nodeCap) {
      truncated = true;
      return null;
    }
    const node: GraphNode = {
      id: txHash,
      address: txHash,
      chain,
      isRoot: false,
      txCount: 0,
      label: null,
      kind: 'txJunction',
      utxoSummary: {
        // RAW array lengths (including coinbase / OP_RETURN slots): an
        // investigator reading "1 in / 3 out" is reading the transaction as
        // it exists on-chain, matching planJunction's labeling.
        inputs: utxo.inputs.length,
        outputs: utxo.outputs.length,
        fee: utxo.fee,
      },
    };
    nodesMap.set(txHash, node);
    return node;
  };

  // Key by token.address so two contracts both calling themselves USDC stay separate.
  const upsertEdge = (
    edgeKey: string,
    from: string,
    to: string,
    token: { address: string; symbol: string; decimals: number },
    raw: bigint,
    timestamp: string,
    txHash: string,
  ) => {
    const existing = edgesMap.get(edgeKey);
    if (existing) {
      existing.rawAmount += raw;
      existing.txCount += 1;
      if (timestamp > existing.lastTimestamp) {
        existing.lastTimestamp = timestamp;
        existing.lastTxHash = txHash;
      }
      return;
    }
    if (edgesMap.size >= edgeCap) {
      truncated = true;
      return;
    }
    edgesMap.set(edgeKey, {
      id: edgeKey,
      from,
      to,
      token: { ...token },
      rawAmount: raw,
      txCount: 1,
      lastTimestamp: timestamp,
      lastTxHash: txHash,
    });
  };

  for (const tx of txs) {
    // Junction handling triggers on the row's explicit `utxo.junction` flag,
    // NOT on an empty `from` -- the outgoing/address-in-inputs shape carries
    // a POPULATED `from` (see map-btc-history.ts).
    if (tx.chain === 'bitcoin' && tx.utxo?.junction === true) {
      const junctionId = tx.txHash;
      // Incoming shape: from: '', to = traced address -> junction -> tx.to.
      // Outgoing/address-in-inputs shape: from = traced address, to = a
      // counterparty -> tx.from -> junction. The counterparty (tx.to) is
      // deliberately never drawn as a node.
      const isIncoming = tx.from === '';
      const otherAddress = isIncoming ? tx.to : tx.from;

      const junctionNode = ensureJunctionNode(junctionId, tx.chain, tx.utxo);
      const otherNode = ensureNode(otherAddress, tx.chain);
      if (!junctionNode || !otherNode) continue;

      junctionNode.txCount += 1;
      otherNode.txCount += 1;

      const edgeFrom = isIncoming ? junctionId : tx.from;
      const edgeTo = isIncoming ? tx.to : junctionId;
      const edgeKey = `${edgeFrom}->${edgeTo}->${tx.token.address}`;
      upsertEdge(edgeKey, edgeFrom, edgeTo, tx.token, parseRaw(tx.amount), tx.timestamp, tx.txHash);
      continue;
    }

    if (!tx.from || !tx.to) continue;
    const fromNode = ensureNode(tx.from, tx.chain);
    const toNode = ensureNode(tx.to, tx.chain);
    if (!fromNode || !toNode) continue;
    fromNode.txCount += 1;
    toNode.txCount += 1;

    const edgeKey = `${tx.from}->${tx.to}->${tx.token.address}`;
    upsertEdge(edgeKey, tx.from, tx.to, tx.token, parseRaw(tx.amount), tx.timestamp, tx.txHash);
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
