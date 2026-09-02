import { CHAINS } from '../../generated/shared/chains';

export const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api';

export interface ChainConfig {
  id: string;
  name: string;
  chainId: number;
  nativeCurrency: { symbol: string; decimals: number };
  explorerUrl: string;
}

export interface RawTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  blockNumber: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  isError: string;
  input: string;
  contractAddress: string;
  nonce: string;
}

export interface RawTokenTransfer {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  contractAddress: string;
  timeStamp: string;
  blockNumber: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  nonce: string;
}

export type TokenStandard = 'erc20' | 'erc721' | 'erc1155';

/** One token transfer decoded from a receipt log. Addresses are lowercased. */
export interface DecodedTransfer {
  standard: TokenStandard;
  contractAddress: string;
  from: string;
  to: string;
  /** Raw base units. Always '1' for ERC-721. */
  value: string;
  /** Present for ERC-721 and ERC-1155 only. */
  tokenId?: string;
  logIndex: number;
  /**
   * Token metadata, grafted on by the provider after it classifies the leg's
   * contract. `decodeTransferLogs` never sets these, because a receipt log
   * carries no symbol or decimals — so they are absent on a freshly decoded leg
   * and populated before it leaves the provider. A leg whose contract failed to
   * classify keeps its raw value and simply has none of them.
   */
  symbol?: string;
  decimals?: number;
  name?: string;
}

export interface RawTransactionDetail {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  blockNumber: string;
  gas: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  contractAddress: string;
  tokenTransfers: RawTokenTransfer[];
  /**
   * Every token transfer decoded from the receipt logs, in log order.
   * EVM only — Tron and Solana providers leave this undefined and continue to
   * populate `tokenTransfers`.
   */
  transfers?: DecodedTransfer[];
}

export interface RawAddressInfo {
  address: string;
  addressType: 'wallet' | 'contract';
  balance: string;
  label?: string;
  /** Set when the address is a token contract. */
  tokenStandard?: TokenStandard;
  symbol?: string;
  decimals?: number;
  name?: string;
}

export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

/**
 * One spent input of a Bitcoin transaction, as recorded on-chain.
 * `address` is null when the previous output's script carries no decodable
 * address (bare scripts, unknown types) or when the input is a coinbase.
 */
export interface UtxoInput {
  address: string | null;
  /** Satoshis, as a decimal string. */
  value: string;
  prevTxid: string;
  prevVout: number;
  scriptType?: string;
  coinbase?: boolean;
}

/**
 * One output of a Bitcoin transaction. `change` / `changeEvidence` are the
 * verdict of detectChange() -- an INFERENCE, never a ledger fact -- and are
 * surfaced to investigators alongside their evidence strings.
 */
export interface UtxoOutput {
  address: string | null;
  /** Satoshis, as a decimal string. */
  value: string;
  index: number;
  scriptType?: string;
  change?: boolean;
  changeEvidence?: string[];
  opReturn?: boolean;
}

/**
 * Full UTXO provenance carried by every Bitcoin transaction row. The
 * inputs/outputs/fee/warnings block is the shared, per-transaction ledger
 * record (identical on every row derived from the same tx); the trailing
 * fields identify which slice of that transaction this particular row
 * represents.
 */
export interface UtxoContext {
  inputs: UtxoInput[];
  outputs: UtxoOutput[];
  /** Satoshis, as a decimal string. */
  fee: string;
  warnings?: string[];
  confirmed?: boolean;
  blockHeight?: number | null;
  /** Which output this edge represents (payment edges). */
  vout?: number;
  /** Junction leg edges (used by later tasks). */
  legType?: 'input' | 'output';
  legIndex?: number;
  /** Row should materialize as a tx-junction node. */
  junction?: boolean;
}

/**
 * Structured token metadata for rows whose `token` field is a bare symbol
 * (import payloads: `ImportTransactionItem.token`). Carries what the symbol
 * alone cannot: the contract address that distinguishes two tokens sharing a
 * symbol, and the decimals needed to render `amount`, which is in raw base
 * units on these rows.
 */
export interface TokenMeta {
  address: string;
  decimals: number;
}

/**
 * Per-row context carried by every Solana transfer edge. One signature can
 * contain several transfers (native SOL + SPL token legs); `transferIndex`
 * is the position in [...nativeTransfers, ...tokenTransfers] and is what
 * edgeIdentityKey() uses to distinguish them.
 */
export interface SolanaContext {
  transferIndex: number;
  feePayer: string;
  kind: 'native' | 'spl';
  mint?: string; // spl only
  decimals?: number; // spl only (native SOL is 9, implied by token object)
  fromTokenAccount?: string; // spl only — raw token accounts, evidentiary
  toTokenAccount?: string;
  type?: string; // Helius tx type (TRANSFER, SWAP, ...)
  source?: string; // Helius source program (JUPITER, ...)
  slot?: number;
  spam?: boolean;
  spamEvidence?: string[]; // e.g. ['unsolicited','unknown-mint']
}

export interface FetchOptions {
  startBlock?: number;
  endBlock?: number;
  // Unix timestamps in seconds. When set, providers translate these to
  // their native filter (block range for Etherscan, ms timestamps for Tron)
  // and they take precedence over startBlock/endBlock.
  startTimestamp?: number;
  endTimestamp?: number;
  page?: number;
  offset?: number;
  sort?: 'asc' | 'desc';
  /**
   * When set, fetchHistory iterates pages internally until each underlying
   * source (native + token transfers) returns a partial page OR accumulates
   * this many rows. Without it, behavior is unchanged (single page only).
   */
  maxTotal?: number;
}

// Derived from the shared chain registry so backend and frontend never drift.
// Adds 'bitcoin' automatically. Bitcoin is a UTXO chain with no
// account-scoped transaction list, so it is served through the registry's
// separate two-path split: ProviderRegistry.get() for the account-model
// chains (EVM via EtherscanProvider, Tron via TronscanProvider) and
// ProviderRegistry.getUtxo() for bitcoin (BitcoinProvider). get('bitcoin')
// still throws — it exists only to fail loudly if a caller uses the wrong
// path instead of routing through getUtxo().
export const CHAIN_CONFIGS: Record<string, ChainConfig> = Object.fromEntries(
  Object.entries(CHAINS).map(([id, def]) => [
    id,
    {
      id: def.id,
      name: def.name,
      chainId: def.chainId,
      nativeCurrency: def.nativeCurrency,
      explorerUrl: def.explorerUrl,
    },
  ]),
);
