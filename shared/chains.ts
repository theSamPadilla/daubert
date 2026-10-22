// shared/chains.ts — single source of truth for supported chains.
export type ChainFamily = 'evm' | 'tron' | 'utxo' | 'solana' | 'fiat';
export interface ChainDef {
  id: string; name: string; family: ChainFamily;
  chainId: number;                    // EIP-155 for EVM; Tron protocol id; 0 for bitcoin (unused)
  nativeCurrency: { symbol: string; decimals: number };
  explorerUrl: string;
  addressPath: string;                // e.g. '/address/' or '/#/address/'
  txPath: string;                     // e.g. '/tx/' or '/#/transaction/'
  caseSensitiveAddresses: boolean;
  onChain: boolean;                   // false for off-chain ledgers (fiat): never fetched from a provider, no explorer
}
export const CHAINS: Record<string, ChainDef> = {
  ethereum: { id:'ethereum', name:'Ethereum', family:'evm', chainId:1, nativeCurrency:{symbol:'ETH',decimals:18}, explorerUrl:'https://etherscan.io', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:false, onChain:true },
  polygon:  { id:'polygon', name:'Polygon', family:'evm', chainId:137, nativeCurrency:{symbol:'MATIC',decimals:18}, explorerUrl:'https://polygonscan.com', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:false, onChain:true },
  arbitrum: { id:'arbitrum', name:'Arbitrum', family:'evm', chainId:42161, nativeCurrency:{symbol:'ETH',decimals:18}, explorerUrl:'https://arbiscan.io', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:false, onChain:true },
  base:     { id:'base', name:'Base', family:'evm', chainId:8453, nativeCurrency:{symbol:'ETH',decimals:18}, explorerUrl:'https://basescan.org', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:false, onChain:true },
  tron:     { id:'tron', name:'Tron', family:'tron', chainId:728126428, nativeCurrency:{symbol:'TRX',decimals:6}, explorerUrl:'https://tronscan.org', addressPath:'/#/address/', txPath:'/#/transaction/', caseSensitiveAddresses:true, onChain:true },
  bitcoin:  { id:'bitcoin', name:'Bitcoin', family:'utxo', chainId:0, nativeCurrency:{symbol:'BTC',decimals:8}, explorerUrl:'https://mempool.space', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:true, onChain:true },
  solana:   { id:'solana', name:'Solana', family:'solana', chainId:0, nativeCurrency:{symbol:'SOL',decimals:9}, explorerUrl:'https://solscan.io', addressPath:'/account/', txPath:'/tx/', caseSensitiveAddresses:true, onChain:true },
  fiat:     { id:'fiat', name:'Bank / Fiat', family:'fiat', chainId:0, nativeCurrency:{symbol:'USD',decimals:2}, explorerUrl:'', addressPath:'', txPath:'', caseSensitiveAddresses:true, onChain:false },
};
export const CHAIN_IDS = Object.keys(CHAINS) as [string, ...string[]];
/** Chains backed by a fetchable blockchain provider. Excludes off-chain ledgers such as fiat. */
export const ON_CHAIN_CHAIN_IDS = CHAIN_IDS.filter((id) => CHAINS[id].onChain) as [string, ...string[]];
export function isOnChain(chain: string): boolean { return CHAINS[chain]?.onChain === true; }
export function chainFamily(chain: string): ChainFamily | undefined { return CHAINS[chain]?.family; }
export function explorerAddressUrl(chain: string, addr: string): string { const c = CHAINS[chain]; return !c || !c.onChain || !c.explorerUrl ? '' : `${c.explorerUrl}${c.addressPath}${addr}`; }
export function explorerTxUrl(chain: string, hash: string): string { const c = CHAINS[chain]; return !c || !c.onChain || !c.explorerUrl ? '' : `${c.explorerUrl}${c.txPath}${hash}`; }

/** Chains whose providers paginate by cursor — no block-range or page/offset params. */
export function usesCursorPagination(chain: string): boolean {
  const f = CHAINS[chain]?.family;
  return f === 'utxo' || f === 'solana';
}
