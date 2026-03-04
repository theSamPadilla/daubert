import { Injectable } from '@nestjs/common';
import { ProviderRegistry } from './provider-registry';
import { PriceService } from './price.service';
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

@Injectable()
export class BlockchainService {
  private tokenResolver = new TokenResolver();
  private priceService: PriceService;

  constructor(private providerRegistry: ProviderRegistry) {
    this.priceService = new PriceService(providerRegistry.getCache());
  }

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
}
