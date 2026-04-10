export interface Group {
  id: string;
  name: string;
  color?: string;
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
  position?: { x: number; y: number };
  collapsed: boolean;
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
  label?: string;
  notes: string;
  tags: string[];
  links?: string[];
  blockNumber: number;
  crossTrace: boolean;
}
