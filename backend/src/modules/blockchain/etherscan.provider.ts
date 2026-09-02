import { BlockchainProvider } from './blockchain-provider';
import {
  ChainConfig,
  RawTransaction,
  RawTokenTransfer,
  RawTransactionDetail,
  RawAddressInfo,
  DecodedTransfer,
  FetchOptions,
  ETHERSCAN_V2_BASE,
} from './types';
import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';
import { decodeTransferLogs } from './log-decoder';
import { ContractClassifier, ContractClassification } from './contract-classifier';

const TX_CACHE_TTL = 60 * 60 * 1000; // 1hr
const TOKEN_META_TTL = 24 * 60 * 60 * 1000; // 24hr

/**
 * Classification costs up to 6 rate-limited calls per contract on a shared
 * 5 req/s limiter, so a receipt touching many tokens could hold a request open
 * for a minute. Legs past this cap keep their decoded values and simply carry no
 * metadata — the same graceful degradation as a failed probe.
 */
const MAX_CLASSIFIED_CONTRACTS = 25;

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

export class EtherscanProvider implements BlockchainProvider {
  // The closures are lazy — they capture `this` but invoke nothing at
  // construction — so field-initialization order versus the constructor's
  // parameter properties does not matter. `fetchApi` already caches and
  // rate-limits, so the probes inherit both, and it throws on JSON-RPC `error`
  // objects, which is what ContractClassifier's per-probe try/catch reads as a
  // revert.
  private readonly classifier = new ContractClassifier(
    (address) => this.fetchApi<string>('proxy', 'eth_getCode', { address, tag: 'latest' }),
    (address, data) => this.fetchApi<string>('proxy', 'eth_call', { to: address, data, tag: 'latest' }),
  );

  constructor(
    private chain: ChainConfig,
    private apiKey: string,
    private rateLimiter: RateLimiter,
    private cache: ResponseCache,
  ) {}

  private async fetchApi<T>(
    module: string,
    action: string,
    params: Record<string, string>,
  ): Promise<T> {
    const allParams = {
      chainid: String(this.chain.chainId),
      ...params,
      module,
      action,
      apikey: this.apiKey,
    };
    const cacheKey = this.cache.buildKey(
      this.chain.id,
      `${module}/${action}`,
      params,
    );

    const cached = this.cache.get<T>(cacheKey);
    if (cached !== null) return cached;

    await this.rateLimiter.acquire();

    const qs = new URLSearchParams(allParams).toString();
    const res = await fetch(`${ETHERSCAN_V2_BASE}?${qs}`);
    if (!res.ok) throw new Error(`Etherscan API error: ${res.status}`);

    const json = await res.json();

    // Proxy module returns JSON-RPC format (no status/message)
    if (module === 'proxy') {
      if (json.error) {
        throw new Error(`Etherscan proxy error: ${json.error.message ?? JSON.stringify(json.error)}`);
      }
      const result = json.result as T;
      this.cache.set(cacheKey, result, TX_CACHE_TTL);
      return result;
    }

    const ethRes = json as EtherscanResponse<T>;
    if (ethRes.status !== '1' && ethRes.message !== 'No transactions found') {
      throw new Error(`Etherscan: ${ethRes.message} (${JSON.stringify(ethRes.result)})`);
    }

    const result =
      ethRes.status === '1' ? ethRes.result : ([] as unknown as T);

    const ttl = action.includes('token') ? TOKEN_META_TTL : TX_CACHE_TTL;
    this.cache.set(cacheKey, result, ttl);

    return result;
  }

  // Etherscan v2 has no native timestamp filter on txlist/tokentx — translate
  // dates to blocks via getblocknobytime. `closest=after` for the lower bound,
  // `closest=before` for the upper bound so the resulting block range is
  // inclusive of the requested time window.
  private async blockByTime(
    timestamp: number,
    closest: 'before' | 'after',
  ): Promise<number> {
    const result = await this.fetchApi<string>('block', 'getblocknobytime', {
      timestamp: String(timestamp),
      closest,
    });
    return Number(result);
  }

  private async resolveBlockRange(options?: FetchOptions): Promise<{
    startBlock: number;
    endBlock: number;
  }> {
    const [startBlock, endBlock] = await Promise.all([
      options?.startTimestamp
        ? this.blockByTime(options.startTimestamp, 'after')
        : Promise.resolve(options?.startBlock ?? 0),
      options?.endTimestamp
        ? this.blockByTime(options.endTimestamp, 'before')
        : Promise.resolve(options?.endBlock ?? 99999999),
    ]);
    return { startBlock, endBlock };
  }

  async getTransactions(
    address: string,
    options?: FetchOptions,
  ): Promise<RawTransaction[]> {
    const { startBlock, endBlock } = await this.resolveBlockRange(options);
    return this.fetchApi<RawTransaction[]>('account', 'txlist', {
      address,
      startblock: String(startBlock),
      endblock: String(endBlock),
      page: String(options?.page ?? 1),
      offset: String(options?.offset ?? 100),
      sort: options?.sort ?? 'desc',
    });
  }

  async getTokenTransfers(
    address: string,
    options?: FetchOptions,
  ): Promise<RawTokenTransfer[]> {
    const { startBlock, endBlock } = await this.resolveBlockRange(options);
    return this.fetchApi<RawTokenTransfer[]>('account', 'tokentx', {
      address,
      startblock: String(startBlock),
      endblock: String(endBlock),
      page: String(options?.page ?? 1),
      offset: String(options?.offset ?? 100),
      sort: options?.sort ?? 'desc',
    });
  }

  async getTransaction(txHash: string): Promise<RawTransactionDetail> {
    // Fetch tx details and receipt in parallel
    const [txResult, receiptResult] = await Promise.all([
      this.fetchApi<any>('proxy', 'eth_getTransactionByHash', { txhash: txHash }),
      this.fetchApi<any>('proxy', 'eth_getTransactionReceipt', { txhash: txHash }),
    ]);

    if (!txResult) throw new Error(`Transaction not found: ${txHash}`);

    const blockNumber = txResult.blockNumber
      ? parseInt(txResult.blockNumber, 16)
      : 0;

    // Get block for timestamp
    let timestamp = '0';
    try {
      const block = await this.fetchApi<any>('proxy', 'eth_getBlockByNumber', {
        tag: txResult.blockNumber,
        boolean: 'false',
      });
      if (block?.timestamp) {
        timestamp = String(parseInt(block.timestamp, 16));
      }
    } catch {
      // Timestamp unavailable
    }

    // Decode transfers from the receipt we already have. The previous
    // implementation asked `account/tokentx` for `txResult.from`, which is
    // ERC-20-only AND keyed by a party to the transfer — for a relayed call the
    // sender is party to nothing and the query returns zero rows.
    const transfers = decodeTransferLogs(receiptResult?.logs ?? []);

    // Classify each distinct token contract once, for symbol/decimals. Failures
    // degrade to an undecorated transfer rather than losing the transfer.
    const contracts = [...new Set(transfers.map((t) => t.contractAddress))].slice(
      0,
      MAX_CLASSIFIED_CONTRACTS,
    );
    const metadata = new Map<string, ContractClassification>();
    await Promise.all(
      contracts.map(async (addr) => {
        try {
          metadata.set(addr, await this.classifier.classify(this.chain.id, addr));
        } catch {
          // Leave unclassified.
        }
      }),
    );

    // `tokenTransfers` remains the cross-chain field Tron and Solana populate,
    // so it keeps carrying the ERC-20 subset in its original shape.
    const tokenTransfers: RawTokenTransfer[] = transfers
      .filter((t) => t.standard === 'erc20')
      .map((t) => {
        const meta = metadata.get(t.contractAddress);
        return {
          hash: txResult.hash,
          from: t.from,
          to: t.to,
          value: t.value,
          tokenName: meta?.name ?? '',
          tokenSymbol: meta?.symbol ?? '',
          tokenDecimal: meta?.decimals !== undefined ? String(meta.decimals) : '',
          contractAddress: t.contractAddress,
          timeStamp: timestamp,
          blockNumber: String(blockNumber),
          gas: txResult.gas ? BigInt(txResult.gas).toString() : '0',
          gasPrice: txResult.gasPrice ? BigInt(txResult.gasPrice).toString() : '0',
          gasUsed: receiptResult?.gasUsed ? BigInt(receiptResult.gasUsed).toString() : '0',
          nonce: txResult.nonce ? BigInt(txResult.nonce).toString() : '0',
        };
      });

    // `decodeTransferLogs` cannot know symbol/decimals — logs carry neither — so
    // the metadata is grafted on here, after classification. A leg whose contract
    // failed to classify keeps its raw value and simply has no metadata.
    const enrichedTransfers: DecodedTransfer[] = transfers.map((t) => {
      const meta = metadata.get(t.contractAddress);
      return {
        ...t,
        ...(meta?.symbol ? { symbol: meta.symbol } : {}),
        ...(meta?.decimals !== undefined ? { decimals: meta.decimals } : {}),
        ...(meta?.name ? { name: meta.name } : {}),
      };
    });

    return {
      hash: txResult.hash,
      from: txResult.from,
      to: txResult.to || '',
      value: txResult.value
        ? BigInt(txResult.value).toString()
        : '0',
      timeStamp: timestamp,
      blockNumber: String(blockNumber),
      gas: txResult.gas ? BigInt(txResult.gas).toString() : '0',
      gasUsed: receiptResult?.gasUsed
        ? BigInt(receiptResult.gasUsed).toString()
        : '0',
      gasPrice: txResult.gasPrice
        ? BigInt(txResult.gasPrice).toString()
        : '0',
      isError: receiptResult?.status === '0x0' ? '1' : '0',
      contractAddress: receiptResult?.contractAddress || '',
      tokenTransfers,
      transfers: enrichedTransfers,
    };
  }

  async getAddressInfo(address: string): Promise<RawAddressInfo> {
    const [{ classification, determined }, balanceHex] = await Promise.all([
      this.classifier.classifyDetailed(this.chain.id, address),
      this.fetchApi<string>('proxy', 'eth_getBalance', { address, tag: 'latest' }),
    ]);
    // Unlike getTransaction, this result IS the finding — reporting a
    // wallet-vs-contract classification the chain never actually answered
    // would be testimony we cannot back up.
    if (!determined) {
      throw new Error(`Could not determine address type for ${address}: chain unreachable`);
    }
    return {
      address,
      addressType: classification.addressType,
      balance: balanceHex ? BigInt(balanceHex).toString() : '0',
      ...(classification.tokenStandard ? { tokenStandard: classification.tokenStandard } : {}),
      ...(classification.symbol ? { symbol: classification.symbol } : {}),
      ...(classification.decimals !== undefined ? { decimals: classification.decimals } : {}),
      ...(classification.name ? { name: classification.name } : {}),
    };
  }
}
