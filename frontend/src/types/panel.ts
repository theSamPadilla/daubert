import type { WalletNode, TransactionEdge } from './investigation';

export type PanelMode =
  | { type: 'none' }
  | { type: 'createWallet'; position?: { x: number; y: number }; prefill?: Partial<WalletNode> }
  | { type: 'createTransaction'; prefill?: Partial<TransactionEdge> };
