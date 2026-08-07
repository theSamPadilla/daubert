import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ProviderRegistry } from './provider-registry';
import { validateAddressForChain } from '../../generated/shared/address';
import { TokenResolver } from './token-resolver';
import {
  CHAIN_CONFIGS,
  FetchOptions,
  SolanaContext,
  UtxoContext,
  UtxoOutput,
} from './types';
import { buildUtxoContext, mapBtcHistory } from './btc/map-btc-history';
import { decimalToRaw, mapSolanaHistory } from './sol/map-solana-history';
import { HeliusParsedTx, MintMetadata } from './helius-client';
import { randomUUID } from 'crypto';

const BTC_TOKEN = { address: '', symbol: 'BTC', decimals: 8 };

export interface TransactionResult {
  id: string;
  from: string;
  to: string;
  txHash: string;
  chain: string;
  timestamp: string;
  amount: string;
  token: {
    address: string;
    symbol: string;
    decimals: number;
  };
  blockNumber: number;
  notes: string;
  tags: string[];
  crossTrace: boolean;
  /** UTXO provenance. Present only on rows from UTXO chains (Bitcoin). */
  utxo?: UtxoContext;
  /** Per-transfer provenance. Present only on rows from Solana. */
  solana?: SolanaContext;
}

export interface FetchHistoryResult {
  transactions: TransactionResult[];
  chain: string;
  address: string;
}

export interface AddressInfoResult {
  address: string;
  addressType: 'wallet' | 'contract';
  balance: string;
  label?: string;
}

export interface TransactionDetailResult {
  txHash: string;
  from: string;
  to: string;
  chain: string;
  amount: string;
  timestamp: string;
  blockNumber: number;
  token: { address: string; symbol: string; decimals: number };
  tokenTransfers: Array<{
    from: string;
    to: string;
    amount: string;
    token: { address: string; symbol: string; decimals: number };
  }>;
  isError: boolean;
  /** UTXO provenance. Present only for detail results from UTXO chains (Bitcoin). */
  utxo?: UtxoContext;
  /** Provenance of the representative transfer. Present only for detail results from Solana. */
  solana?: SolanaContext;
}

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private tokenResolver = new TokenResolver();

  constructor(private providerRegistry: ProviderRegistry) {}

  /**
   * Reject an address whose shape doesn't match the requested chain BEFORE
   * any provider call. Guards against chain misclassification by callers —
   * notably an LLM agent passing a legacy Bitcoin address (1…/3… base58,
   * shape-identical to a Solana pubkey) with chain 'solana', which would
   * otherwise silently query Helius and return nothing. The corrective
   * error message names the likely intended chain so the caller can
   * self-correct in one round trip.
   */
  private assertAddressMatchesChain(address: string, chain: string): void {
    const err = validateAddressForChain(address, chain);
    if (err) throw new BadRequestException(err);
  }

  async fetchHistory(
    address: string,
    chain: string,
    options?: FetchOptions & { startDate?: string; endDate?: string },
  ): Promise<FetchHistoryResult> {
    this.assertAddressMatchesChain(address, chain);
    const normalized = this.normalizeOptions(options);

    if (chain === 'bitcoin') {
      const txs = await this.providerRegistry.getUtxo('bitcoin').getAddressHistory(address, {
        maxTotal: normalized?.maxTotal,
        startTimestamp: normalized?.startTimestamp,
        endTimestamp: normalized?.endTimestamp,
      });
      const transactions = mapBtcHistory(address, txs).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      return { transactions, chain, address };
    }

    if (chain === 'solana') {
      const { txs, mintMeta } = await this.providerRegistry.getSolana('solana').getAddressHistory(address, {
        maxTotal: normalized?.maxTotal,
        startTimestamp: normalized?.startTimestamp,
        endTimestamp: normalized?.endTimestamp,
      });
      const transactions = mapSolanaHistory(address, txs, mintMeta).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      return { transactions, chain, address };
    }

    const provider = this.providerRegistry.get(chain);
    const chainConfig = CHAIN_CONFIGS[chain];

    let rawTxs: import('./types').RawTransaction[];
    let rawTokenTxs: import('./types').RawTokenTransfer[];

    if (normalized?.maxTotal != null) {
      // Paginate each source independently until a partial page, the cap,
      // or a transient provider error. A failure mid-loop returns the
      // pages we've already gathered instead of rejecting the whole
      // address — historical data is more useful partial than missing.
      const pageSize = normalized.offset ?? (chain === 'tron' ? 50 : 100);
      const maxTotal = normalized.maxTotal;
      const MAX_PAGES = Math.ceil(maxTotal / pageSize) + 5; // hard iteration cap (safety)

      // Native transactions
      const accTxs: import('./types').RawTransaction[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        let batch: import('./types').RawTransaction[];
        try {
          batch = await provider.getTransactions(address, { ...normalized, page, offset: pageSize });
        } catch (err) {
          this.logger.warn(
            `Paginated getTransactions failed at page=${page} for ${address} on ${chain}: ${(err as Error).message}. Returning ${accTxs.length} rows accumulated so far.`,
          );
          break;
        }
        accTxs.push(...batch);
        if (batch.length < pageSize || accTxs.length >= maxTotal) break;
      }
      rawTxs = accTxs;

      // Token transfers
      const accTokenTxs: import('./types').RawTokenTransfer[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        let batch: import('./types').RawTokenTransfer[];
        try {
          batch = await provider.getTokenTransfers(address, { ...normalized, page, offset: pageSize });
        } catch (err) {
          this.logger.warn(
            `Paginated getTokenTransfers failed at page=${page} for ${address} on ${chain}: ${(err as Error).message}. Returning ${accTokenTxs.length} rows accumulated so far.`,
          );
          break;
        }
        accTokenTxs.push(...batch);
        if (batch.length < pageSize || accTokenTxs.length >= maxTotal) break;
      }
      rawTokenTxs = accTokenTxs;
    } else {
      // Single-page path — unchanged behavior for all existing callers.
      [rawTxs, rawTokenTxs] = await Promise.all([
        provider.getTransactions(address, normalized),
        provider.getTokenTransfers(address, normalized),
      ]);
    }

    const transactions: TransactionResult[] = [];
    const seenHashes = new Set<string>();

    // Tron uses base58 addresses (case-sensitive); EVM uses hex (normalize to lowercase)
    const normalizeAddr = (addr: string) =>
      chain === 'tron' ? addr : addr.toLowerCase();

    for (const tx of rawTxs) {
      if (tx.isError === '1') continue;
      if (chain !== 'tron' && tx.value === '0' && !tx.input?.startsWith('0x'))
        continue;

      const key = `${tx.hash}-${tx.from}-${tx.to}-native`;
      if (seenHashes.has(key)) continue;
      seenHashes.add(key);

      transactions.push({
        id: randomUUID(),
        from: normalizeAddr(tx.from),
        to: normalizeAddr(tx.to || tx.contractAddress),
        txHash: tx.hash,
        chain,
        timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
        amount: tx.value,
        token: {
          address: chain === 'tron' ? '' : '0x',
          symbol: chainConfig.nativeCurrency.symbol,
          decimals: chainConfig.nativeCurrency.decimals,
        },
        blockNumber: Number(tx.blockNumber),
        notes: '',
        tags: [],
        crossTrace: false,
      });
    }

    for (const tx of rawTokenTxs) {
      const key = `${tx.hash}-${tx.from}-${tx.to}-${tx.contractAddress}`;
      if (seenHashes.has(key)) continue;
      seenHashes.add(key);

      const meta = this.tokenResolver.resolveFromTransfer(
        chain,
        tx.contractAddress,
        tx.tokenSymbol,
        Number(tx.tokenDecimal),
      );

      transactions.push({
        id: randomUUID(),
        from: normalizeAddr(tx.from),
        to: normalizeAddr(tx.to),
        txHash: tx.hash,
        chain,
        timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
        amount: tx.value,
        token: {
          address: meta.address,
          symbol: meta.symbol,
          decimals: meta.decimals,
        },
        blockNumber: Number(tx.blockNumber),
        notes: '',
        tags: [],
        crossTrace: false,
      });
    }

    transactions.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    // Cap to maxTotal after merge+dedup+sort (when pagination was used).
    const capped =
      normalized?.maxTotal != null
        ? transactions.slice(0, normalized.maxTotal)
        : transactions;

    return { transactions: capped, chain, address };
  }

  async getTransaction(
    txHash: string,
    chain: string,
  ): Promise<TransactionDetailResult> {
    if (chain === 'bitcoin') {
      const tx = await this.providerRegistry.getUtxo('bitcoin').getTx(txHash);
      const utxo = buildUtxoContext(tx);

      // Representative from/to for a UTXO tx with N inputs and M outputs:
      // the ledger names no single "sender"/"recipient", so these are a
      // best-effort summary for list views, not evidentiary facts (the
      // full utxo payload below carries every input/output verbatim).
      const from = utxo.inputs[0]?.address ?? 'coinbase';
      const largestPayment = utxo.outputs
        .filter((o) => !o.change && !o.opReturn)
        .reduce<UtxoOutput | undefined>(
          (max, o) => (max == null || Number(o.value) > Number(max.value) ? o : max),
          undefined,
        );

      const timestamp =
        tx.status.confirmed && tx.status.block_time != null
          ? new Date(tx.status.block_time * 1000).toISOString()
          : new Date().toISOString();

      return {
        txHash: tx.txid,
        from,
        to: largestPayment?.address ?? '',
        chain,
        amount: largestPayment?.value ?? '0',
        timestamp,
        blockNumber: tx.status.block_height ?? 0,
        token: { ...BTC_TOKEN },
        tokenTransfers: [],
        isError: false,
        utxo,
      };
    }

    if (chain === 'solana') {
      const { tx, mintMeta } = await this.providerRegistry.getSolana('solana').getTx(txHash);
      return this.buildSolanaTransactionDetail(tx, mintMeta);
    }

    const provider = this.providerRegistry.get(chain);
    const chainConfig = CHAIN_CONFIGS[chain];
    const detail = await provider.getTransaction(txHash);

    const tokenTransfers = detail.tokenTransfers.map((t) => {
      const meta = this.tokenResolver.resolveFromTransfer(
        chain,
        t.contractAddress,
        t.tokenSymbol,
        Number(t.tokenDecimal),
      );
      return {
        from: t.from,
        to: t.to,
        amount: t.value,
        token: { address: meta.address, symbol: meta.symbol, decimals: meta.decimals },
      };
    });

    return {
      txHash: detail.hash,
      from: detail.from,
      to: detail.to,
      chain,
      amount: detail.value,
      timestamp: detail.timeStamp !== '0'
        ? new Date(Number(detail.timeStamp) * 1000).toISOString()
        : new Date().toISOString(),
      blockNumber: Number(detail.blockNumber),
      token: {
        address: chain === 'tron' ? '' : '0x',
        symbol: chainConfig.nativeCurrency.symbol,
        decimals: chainConfig.nativeCurrency.decimals,
      },
      tokenTransfers,
      isError: detail.isError === '1',
    };
  }

  private normalizeOptions(
    options?: FetchOptions & { startDate?: string; endDate?: string },
  ): FetchOptions | undefined {
    if (!options) return undefined;
    const { startDate, endDate, ...rest } = options;
    const out: FetchOptions = { ...rest };
    if (startDate) {
      // Start of day UTC
      out.startTimestamp = Math.floor(Date.UTC(
        Number(startDate.slice(0, 4)),
        Number(startDate.slice(5, 7)) - 1,
        Number(startDate.slice(8, 10)),
        0, 0, 0,
      ) / 1000);
    }
    if (endDate) {
      // End of day UTC
      out.endTimestamp = Math.floor(Date.UTC(
        Number(endDate.slice(0, 4)),
        Number(endDate.slice(5, 7)) - 1,
        Number(endDate.slice(8, 10)),
        23, 59, 59,
      ) / 1000);
    }
    return out;
  }

  async getAddressInfo(
    address: string,
    chain: string,
  ): Promise<AddressInfoResult> {
    this.assertAddressMatchesChain(address, chain);
    if (chain === 'bitcoin') {
      const raw = await this.providerRegistry.getUtxo('bitcoin').getAddressInfo(address);
      return {
        address: raw.address,
        addressType: raw.addressType,
        balance: raw.balance,
        label: raw.label,
      };
    }

    if (chain === 'solana') {
      const raw = await this.providerRegistry.getSolana('solana').getAddressInfo(address);
      return {
        address: raw.address,
        addressType: raw.addressType,
        balance: raw.balance,
        label: raw.label,
      };
    }

    const provider = this.providerRegistry.get(chain);
    const raw = await provider.getAddressInfo(address);
    return {
      address: raw.address,
      addressType: raw.addressType,
      balance: raw.balance,
      label: raw.label,
    };
  }

  /**
   * Builds a single detail result for a Solana transaction, which — unlike
   * Bitcoin/EVM — has no single ledger-named sender. `from` is the fee
   * payer (the account that actually authorized/paid for the transaction);
   * `to`/`amount`/`token`/`solana` describe the "representative" transfer:
   * the one with the largest decimal-adjusted quantity among the tx's
   * native + SPL legs (comparing raw base units directly would be
   * dominated by whichever asset happens to have the fewest decimals, so
   * quantities are compared in each asset's own human-readable units — an
   * imperfect proxy for economic size absent a price oracle, but the best
   * available without one). `tokenTransfers` carries every SPL leg
   * verbatim, same as the EVM path.
   */
  private buildSolanaTransactionDetail(
    tx: HeliusParsedTx,
    mintMeta: Map<string, MintMetadata>,
  ): TransactionDetailResult {
    const resolveMint = (mint: string) => {
      const meta = mintMeta.get(mint);
      return {
        decimals: meta?.decimals ?? 0,
        symbol: meta?.symbol ?? `${mint.slice(0, 4)}…`,
      };
    };

    interface Candidate {
      to: string;
      decimalAmount: number;
      rawAmount: string;
      token: { address: string; symbol: string; decimals: number };
      solana: SolanaContext;
    }

    const candidates: Candidate[] = [];

    tx.nativeTransfers.forEach((transfer, i) => {
      if (!transfer.fromUserAccount || !transfer.toUserAccount) return;
      if (transfer.amount === 0) return;
      candidates.push({
        to: transfer.toUserAccount,
        decimalAmount: transfer.amount / 1e9,
        rawAmount: decimalToRaw(transfer.amount, 0),
        token: { address: '', symbol: 'SOL', decimals: 9 },
        solana: {
          transferIndex: i,
          feePayer: tx.feePayer,
          kind: 'native',
          type: tx.type,
          source: tx.source,
          slot: tx.slot,
        },
      });
    });

    const offset = tx.nativeTransfers.length;
    tx.tokenTransfers.forEach((transfer, i) => {
      if (!transfer.fromUserAccount || !transfer.toUserAccount) return;
      if (transfer.tokenAmount === 0) return;
      const { symbol, decimals } = resolveMint(transfer.mint);
      candidates.push({
        to: transfer.toUserAccount,
        decimalAmount: transfer.tokenAmount,
        rawAmount: decimalToRaw(transfer.tokenAmount, decimals),
        token: { address: transfer.mint, symbol, decimals },
        solana: {
          transferIndex: offset + i,
          feePayer: tx.feePayer,
          kind: 'spl',
          mint: transfer.mint,
          decimals,
          fromTokenAccount: transfer.fromTokenAccount ?? undefined,
          toTokenAccount: transfer.toTokenAccount ?? undefined,
          type: tx.type,
          source: tx.source,
          slot: tx.slot,
        },
      });
    });

    const representative = candidates.reduce<Candidate | undefined>(
      (max, c) => (max == null || c.decimalAmount > max.decimalAmount ? c : max),
      undefined,
    );

    // A transfer with a null owner never earns a row elsewhere in the Solana
    // path (see resolveEndpoints in map-solana-history.ts) — the ledger did
    // not resolve who it belongs to. Coalescing that null to '' here would
    // emit a phantom endpoint that downstream consumers (e.g. QuickAdd) can
    // mistake for a real, empty-but-present sender. Drop the transfer
    // entirely instead of naming a party that was never named.
    const tokenTransfers = tx.tokenTransfers
      .filter((t) => t.fromUserAccount != null && t.toUserAccount != null)
      .map((t) => {
        const { symbol, decimals } = resolveMint(t.mint);
        return {
          from: t.fromUserAccount as string,
          to: t.toUserAccount as string,
          amount: decimalToRaw(t.tokenAmount, decimals),
          token: { address: t.mint, symbol, decimals },
        };
      });

    return {
      txHash: tx.signature,
      from: tx.feePayer,
      to: representative?.to ?? '',
      chain: 'solana',
      amount: representative?.rawAmount ?? '0',
      timestamp: new Date(tx.timestamp * 1000).toISOString(),
      blockNumber: tx.slot,
      token: representative?.token ?? { address: '', symbol: 'SOL', decimals: 9 },
      tokenTransfers,
      isError: tx.transactionError != null,
      solana: representative?.solana,
    };
  }
}
