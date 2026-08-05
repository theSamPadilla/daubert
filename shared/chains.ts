// shared/chains.ts — single source of truth for supported chains.
export type ChainFamily = 'evm' | 'tron' | 'utxo';
export interface ChainDef {
  id: string; name: string; family: ChainFamily;
  chainId: number;                    // EIP-155 for EVM; Tron protocol id; 0 for bitcoin (unused)
  nativeCurrency: { symbol: string; decimals: number };
  explorerUrl: string;
  addressPath: string;                // e.g. '/address/' or '/#/address/'
  txPath: string;                     // e.g. '/tx/' or '/#/transaction/'
  caseSensitiveAddresses: boolean;
}
export const CHAINS: Record<string, ChainDef> = {
  ethereum: { id:'ethereum', name:'Ethereum', family:'evm', chainId:1, nativeCurrency:{symbol:'ETH',decimals:18}, explorerUrl:'https://etherscan.io', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:false },
  polygon:  { id:'polygon', name:'Polygon', family:'evm', chainId:137, nativeCurrency:{symbol:'MATIC',decimals:18}, explorerUrl:'https://polygonscan.com', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:false },
  arbitrum: { id:'arbitrum', name:'Arbitrum', family:'evm', chainId:42161, nativeCurrency:{symbol:'ETH',decimals:18}, explorerUrl:'https://arbiscan.io', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:false },
  base:     { id:'base', name:'Base', family:'evm', chainId:8453, nativeCurrency:{symbol:'ETH',decimals:18}, explorerUrl:'https://basescan.org', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:false },
  tron:     { id:'tron', name:'Tron', family:'tron', chainId:728126428, nativeCurrency:{symbol:'TRX',decimals:6}, explorerUrl:'https://tronscan.org', addressPath:'/#/address/', txPath:'/#/transaction/', caseSensitiveAddresses:true },
  bitcoin:  { id:'bitcoin', name:'Bitcoin', family:'utxo', chainId:0, nativeCurrency:{symbol:'BTC',decimals:8}, explorerUrl:'https://mempool.space', addressPath:'/address/', txPath:'/tx/', caseSensitiveAddresses:true },
};
export const CHAIN_IDS = Object.keys(CHAINS) as [string, ...string[]];
export function chainFamily(chain: string): ChainFamily | undefined { return CHAINS[chain]?.family; }
export function explorerAddressUrl(chain: string, addr: string): string { const c = CHAINS[chain]; return c ? `${c.explorerUrl}${c.addressPath}${addr}` : ''; }
export function explorerTxUrl(chain: string, hash: string): string { const c = CHAINS[chain]; return c ? `${c.explorerUrl}${c.txPath}${hash}` : ''; }
