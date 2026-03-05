import { Injectable } from '@nestjs/common';
import { ProviderRegistry } from './provider-registry';
import { TokenResolver } from './token-resolver';
import { CHAIN_CONFIGS, FetchOptions } from './types';
import { randomUUID } from 'crypto';

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
}

@Injectable()
export class BlockchainService {
  private tokenResolver = new TokenResolver();

  constructor(private providerRegistry: ProviderRegistry) {}

  async fetchHistory(
    address: string,
    chain: string,
    options?: FetchOptions,
  ): Promise<FetchHistoryResult> {
    const provider = this.providerRegistry.get(chain);
    const chainConfig = CHAIN_CONFIGS[chain];

    const [rawTxs, rawTokenTxs] = await Promise.all([
      provider.getTransactions(address, options),
      provider.getTokenTransfers(address, options),
    ]);

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

    return { transactions, chain, address };
  }

  async getTransaction(
    txHash: string,
    chain: string,
  ): Promise<TransactionDetailResult> {
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

  async getAddressInfo(
    address: string,
    chain: string,
  ): Promise<AddressInfoResult> {
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
