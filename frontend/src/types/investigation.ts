import type { components } from '../generated/api-types';

/**
 * UTXO provenance carried by Bitcoin nodes/edges. Aliased from the generated
 * OpenAPI schema (contracts/schemas/blockchain.yaml#UtxoContext →
 * backend/src/modules/blockchain/types.ts#UtxoContext) rather than
 * hand-mirrored, so frontend and backend never drift.
 */
export type UtxoContext = components['schemas']['UtxoContext'];

/**
 * Per-transfer provenance carried by Solana edges. Aliased from the generated
 * OpenAPI schema the same way as UtxoContext, so frontend and backend never drift.
 */
export type SolanaContext = components['schemas']['SolanaContext'];

/**
 * Token contract standard, decoded from a transaction's logs. Aliased from
 * the generated OpenAPI schema the same way as UtxoContext/SolanaContext.
 */
export type TokenStandard = components['schemas']['TokenStandard'];

export interface Group {
  id: string;
  name: string;
  color?: string | null; // null = explicitly no color; undefined = use trace fallback
  traceId: string;
  collapsed?: boolean;
  size?: number;
}

export interface EdgeBundle {
  id: string;
  traceId: string;
  fromNodeId: string;
  toNodeId: string;
  token: string;         // token symbol e.g. "USDT"
  collapsed: boolean;
  edgeIds: string[];     // IDs of the bundled TransactionEdges
  color?: string;
  label?: string;        // optional display label; falls back to "<total> <token> (<n>)"
  width?: number;        // visual line thickness; undefined falls back to the base style
  // User-set curve offset (signed pixels along the perpendicular). Persisted so
  // arcs survive reloads and appear in exhibit-rendered snapshots.
  hasArc?: boolean;
  arcOffset?: number;
}

export type LabelAnchor =
  | { type: 'free'; x: number; y: number }
  | { type: 'node'; anchorId: string; dx: number; dy: number }
  | { type: 'edge'; anchorId: string; t: number; perpOffset: number }
  | { type: 'txEdge'; txHash: string; t: number; perpOffset: number };

export type LabelFontSize = 'sm' | 'md' | 'lg';

export type LabelShape = 'rectangle' | 'rounded' | 'pill' | 'ellipse';

export interface TraceLabel {
  id: string;
  text: string;
  anchor: LabelAnchor;
  /** Optional hex color (e.g. "#ef4444") applied to the whole label wrapper. */
  color?: string;
  /** Optional hex background color. Absent = the default semi-transparent dark fill. */
  bgColor?: string;
  /** Optional font size. Absent = 'md' (11px). */
  fontSize?: LabelFontSize;
  /** Optional wrapper shape. Absent = 'rounded' (preserves legacy 6px corner radius). */
  shape?: LabelShape;
}

export interface Investigation {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  traces: Trace[];
  metadata: Record<string, any>;
}

export interface Trace {
  id: string;
  name: string;
  criteria: {
    type: 'time' | 'wallet-group' | 'custom';
    timeRange?: { start: string; end: string };
    wallets?: string[];
    description?: string;
  };
  visible: boolean;
  color?: string;
  nodes: WalletNode[];
  edges: TransactionEdge[];
  groups?: Group[];
  edgeBundles?: EdgeBundle[];
  labels?: TraceLabel[];
  position?: { x: number; y: number };
  collapsed: boolean;
  hideTitle?: boolean;
}

export interface WalletNode {
  id: string;
  label: string;
  address: string;
  chain: string;
  color?: string;
  size?: number;
  shape?: 'ellipse' | 'rectangle' | 'roundrectangle' | 'diamond' | 'hexagon' | 'triangle';
  notes: string;
  tags: string[];
  position: { x: number; y: number };
  parentTrace: string;
  groupId?: string;
  addressType?: 'wallet' | 'contract' | 'unknown';
  explorerUrl?: string;
  /** 'txJunction' when this node stands for a Bitcoin transaction (many inputs/outputs) rather than a wallet. Absent/'wallet' for ordinary address nodes. */
  kind?: 'wallet' | 'txJunction';
  /** Full UTXO ledger record for a txJunction node. Absent on ordinary wallets. */
  utxoTx?: UtxoContext;
  /** Set when the address is a token contract. Distinct from `addressType`,
   *  which records only whether the address has code. */
  tokenStandard?: TokenStandard;
}

/**
 * A single decoded transfer from a transaction's receipt. Aliased from the
 * generated OpenAPI schema the same way as UtxoContext/SolanaContext/TokenStandard.
 */
export type TransferLeg = components['schemas']['TransferLeg'];

export interface TransactionEdge {
  id: string;
  from: string;
  to: string;
  txHash?: string;
  chain: string;
  timestamp: string;
  amount: string;
  token: {
    address: string;
    symbol: string;
    decimals: number;
  };
  usdValue?: number;
  color?: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  width?: number;        // visual line thickness; undefined falls back to the base style
  label?: string;
  notes: string;
  tags: string[];
  links?: string[];
  blockNumber: number;
  crossTrace: boolean;
  // User-set curve offset (signed pixels along the perpendicular). Persisted so
  // arcs survive reloads and appear in exhibit-rendered snapshots.
  hasArc?: boolean;
  arcOffset?: number;
  /** UTXO provenance (Bitcoin only). Present on payment edges and junction leg edges. */
  utxo?: UtxoContext;
  /** Per-transfer provenance (Solana only). */
  solana?: SolanaContext;
  tokenStandard?: TokenStandard;
  tokenId?: string;
  /**
   * Every transfer decoded from this transaction's receipt. The edge itself
   * always mirrors ONE of them (see `selectedTransferIndex`) — switching the
   * selection rewrites `from`/`to`/`amount`/`token` so that every existing
   * consumer keeps reading the same fields it always has.
   *
   * `from`/`to` here are ADDRESSES; the edge's own `from`/`to` are NODE IDS.
   */
  transfers?: TransferLeg[];
  /** Index into `transfers` that this edge currently represents. */
  selectedTransferIndex?: number;
}
