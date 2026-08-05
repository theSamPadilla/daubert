import { Injectable, Logger } from '@nestjs/common';
import { ProviderRegistry } from './provider-registry';
import { TokenResolver } from './token-resolver';
import { CHAIN_CONFIGS, FetchOptions, UtxoContext, UtxoOutput } from './types';
import { buildUtxoContext, mapBtcHistory } from './btc/map-btc-history';
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
}

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private tokenResolver = new TokenResolver();

  constructor(private providerRegistry: ProviderRegistry) {}

  async fetchHistory(
    address: string,
    chain: string,
    options?: FetchOptions & { startDate?: string; endDate?: string },
  ): Promise<FetchHistoryResult> {
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
    if (chain === 'bitcoin') {
      const raw = await this.providerRegistry.getUtxo('bitcoin').getAddressInfo(address);
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
}
