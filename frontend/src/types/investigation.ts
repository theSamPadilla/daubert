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

export interface TraceLabel {
  id: string;
  text: string;
  anchor: LabelAnchor;
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
}

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
}
