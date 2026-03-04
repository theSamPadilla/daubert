import { TransactionEdge } from '../types/investigation';
import { providerRegistry } from './ProviderRegistry';
import { TokenResolver } from './TokenResolver';
import { CHAIN_CONFIGS, FetchOptions } from './types';

const tokenResolver = new TokenResolver();

export interface FetchResult {
  transactions: TransactionEdge[];
  chain: string;
  address: string;
}

export async function fetchWalletHistory(
  address: string,
  chain: string,
  options?: FetchOptions
): Promise<FetchResult> {
  const provider = providerRegistry.get(chain);
  const chainConfig = CHAIN_CONFIGS[chain];

  // Fetch normal txs and token transfers in parallel
  const [rawTxs, rawTokenTxs] = await Promise.all([
    provider.getTransactions(address, options),
    provider.getTokenTransfers(address, options),
  ]);

  const transactions: TransactionEdge[] = [];
  const seenHashes = new Set<string>();

  // Convert normal transactions (native currency transfers)
  for (const tx of rawTxs) {
    if (tx.isError === '1') continue;
    if (tx.value === '0' && !tx.input?.startsWith('0x')) continue;

    const key = `${tx.hash}-${tx.from}-${tx.to}-native`;
    if (seenHashes.has(key)) continue;
    seenHashes.add(key);

    const decimals = chainConfig.nativeCurrency.decimals;
    const amount = tx.value;

    transactions.push({
      id: crypto.randomUUID(),
      from: tx.from.toLowerCase(),
      to: (tx.to || tx.contractAddress).toLowerCase(),
      txHash: tx.hash,
      chain,
      timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
      amount,
      token: {
        address: '0x',
        symbol: chainConfig.nativeCurrency.symbol,
        decimals,
      },
      blockNumber: Number(tx.blockNumber),
      notes: '',
      tags: [],
      crossTrace: false,
    });
  }

  // Convert ERC-20 token transfers
  for (const tx of rawTokenTxs) {
    const key = `${tx.hash}-${tx.from}-${tx.to}-${tx.contractAddress}`;
    if (seenHashes.has(key)) continue;
    seenHashes.add(key);

    const meta = tokenResolver.resolveFromTransfer(
      chain,
      tx.contractAddress,
      tx.tokenSymbol,
      Number(tx.tokenDecimal)
    );

    transactions.push({
      id: crypto.randomUUID(),
      from: tx.from.toLowerCase(),
      to: tx.to.toLowerCase(),
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

  // Sort by timestamp descending
  transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return { transactions, chain, address };
}
