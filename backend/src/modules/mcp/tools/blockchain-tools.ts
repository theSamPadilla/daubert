/**
 * BlockchainToolsService — three MCP tools that let an BYOA MCP session query
 * on-chain data via Daubert's server-side chain-explorer API keys:
 *
 *   - blockchain_fetch_history    → address transaction history (with smart
 *                                   pre-truncation to stay under the 8 KB cap).
 *   - blockchain_get_transaction  → single transaction detail by hash.
 *   - blockchain_get_address_info → balance, type (wallet/contract), and label.
 *
 * No case scope — the chain explorer calls use Daubert's server-side API keys.
 * The per-call eligibility gate (McpAuthHelper) and per-session throttle already
 * bound access. These handlers do NOT call caseAccess.assertRole.
 *
 * Supported chains: derived from CHAIN_IDS (generated/shared/chains.ts), the
 * single source of truth also used by CHAIN_CONFIGS (blockchain/types.ts). An
 * unrecognised chain passed by the model is rejected at schema parse time
 * before reaching the service. Note: this includes 'bitcoin' — BlockchainService
 * routes bitcoin calls through ProviderRegistry.getUtxo() (BitcoinProvider),
 * the UTXO-chain path, rather than the account-model get() path used by
 * EVM/Tron, so these tools work for bitcoin the same as any other chain.
 *
 * Pre-truncation strategy for blockchain_fetch_history:
 *   textResult caps the total JSON at 8 KB but does so by slicing raw bytes,
 *   which can cut the JSON mid-object. For fetch_history, whose dominant cost
 *   is the transactions array, we slice that array down to however many entries
 *   fit under the cap BEFORE handing the object to textResult. The model then
 *   receives a well-formed JSON object with:
 *     { transactions: [...], chain, address, truncated: true, totalCount: N }
 *   so it knows more transactions exist and how many.
 */

import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { BlockchainService } from '../../blockchain/blockchain.service';
import { AuthSuccess } from '../mcp-auth.helper';
import { errorResult, RESULT_CAP_BYTES, textResult } from './tool-utils';
import { CHAIN_IDS } from '../../../generated/shared/chains';
// Reused rather than duplicated — read-tools.ts already imports pure utils
// from the ai module the same way (stripTraceForAgent/filterTraceData), so
// this is not a new cross-module precedent. investigation-data.utils.ts has
// no Nest decorators/DI of its own; it's a plain TS util file.
import { summarizeUtxo } from '../../ai/investigation-data.utils';

const SUPPORTED_CHAINS = CHAIN_IDS;
type Chain = (typeof SUPPORTED_CHAINS)[number];

const chainSchema = z.enum(SUPPORTED_CHAINS);

/**
 * Collapse each row's `utxo` block (UtxoContext — inputs/outputs arrays that
 * can be huge, e.g. a 50-in/50-out CoinJoin row serializes to ~8 KB alone)
 * down to the count-only AgentUtxoSummary shape. Applied BEFORE size-capping
 * so the raw arrays never reach a fetch_history response — unlike
 * blockchain_get_transaction, which is a single bounded object and keeps the
 * full utxo untouched.
 */
function summarizeRowsForFetchHistory(transactions: unknown[]): unknown[] {
  return transactions.map((tx) => {
    if (!tx || typeof tx !== 'object') return tx;
    const row = tx as Record<string, unknown>;
    if (row.utxo === undefined) return tx;
    return { ...row, utxo: summarizeUtxo(row.utxo) };
  });
}

/**
 * Pre-truncate a fetch_history result so the final JSON payload fits under
 * RESULT_CAP_BYTES. Slices the transactions array down to the maximum number
 * of entries that leave room for the surrounding envelope fields. Returns
 * a plain object ready to pass to textResult.
 */
function buildFetchHistoryPayload(
  transactions: unknown[],
  chain: string,
  address: string,
): {
  transactions: unknown[];
  chain: string;
  address: string;
  truncated?: true;
  totalCount?: number;
} {
  const summarized = summarizeRowsForFetchHistory(transactions);
  const totalCount = summarized.length;

  // Build a candidate payload and measure its serialized size.
  const full = { transactions: summarized, chain, address };
  const fullJson = JSON.stringify(full);

  if (fullJson.length <= RESULT_CAP_BYTES) {
    // Everything fits — no truncation metadata needed.
    return full;
  }

  // Binary-search the largest slice of transactions that fits under the cap
  // when combined with the truncation envelope fields.
  const envelope = { chain, address, truncated: true as const, totalCount };
  const envelopeSize = JSON.stringify({ ...envelope, transactions: [] }).length;
  const budgetForTxs = RESULT_CAP_BYTES - envelopeSize - 2; // -2 for "[]" → "[...]"

  let lo = 0;
  let hi = summarized.length;
  let best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const slice = JSON.stringify(summarized.slice(0, mid));
    if (slice.length <= budgetForTxs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Binary search can legitimately land on 0 (e.g. a single summarized row
  // still carrying an oversized unrelated field). The agent must never see
  // zero rows when the address actually has history — return the first row
  // anyway; textResult's outer raw-byte cap is the last-resort backstop for
  // any residual overflow.
  if (best === 0 && totalCount > 0) {
    best = 1;
  }

  return {
    ...envelope,
    transactions: summarized.slice(0, best),
  };
}

@Injectable()
export class BlockchainToolsService {
  constructor(private readonly blockchainService: BlockchainService) {}

  /**
   * Register every blockchain-scope tool on `server`. `auth` is captured by
   * closure for consistency with the tool pattern, but these tools do not use
   * the principal — access is bounded by the McpAuthHelper eligibility gate
   * and the per-session throttle established before registerAll is called.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  registerAll(server: McpServer, _auth: AuthSuccess): void {
    // -----------------------------------------------------------------------
    // blockchain_fetch_history — address transaction history.
    //
    // startDate / endDate are ISO date strings (YYYY-MM-DD). BlockchainService
    // normalizeOptions converts them to Unix timestamps internally.
    // maxTotal controls how many rows the service fetches (paginating internally
    // when set). Pre-truncation then slices the result array to fit 8 KB.
    // -----------------------------------------------------------------------
    server.registerTool(
      'blockchain_fetch_history',
      {
        description:
          'Fetch the transaction history for a wallet or contract address on a supported chain. Returns native transactions and token transfers merged and sorted by timestamp (newest first). Use startDate/endDate (YYYY-MM-DD) to narrow the range; use maxTotal to cap the fetch.',
        inputSchema: {
          address: z.string(),
          chain: chainSchema,
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          maxTotal: z.number().int().positive().optional(),
        },
      },
      async ({ address, chain, startDate, endDate, maxTotal }) => {
        try {
          const opts: { startDate?: string; endDate?: string; maxTotal?: number } = {};
          if (startDate) opts.startDate = startDate;
          if (endDate) opts.endDate = endDate;
          if (maxTotal !== undefined) opts.maxTotal = maxTotal;

          const result = await this.blockchainService.fetchHistory(
            address,
            chain as Chain,
            opts,
          );

          const payload = buildFetchHistoryPayload(
            result.transactions,
            result.chain,
            result.address,
          );

          return textResult(payload);
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // blockchain_get_transaction — single transaction detail by hash.
    //
    // Returns the full TransactionDetailResult including token transfers.
    // -----------------------------------------------------------------------
    server.registerTool(
      'blockchain_get_transaction',
      {
        description:
          'Get the full detail of a single transaction by its hash on a supported chain. Returns from/to, amount, token transfers, and error status.',
        inputSchema: {
          txHash: z.string(),
          chain: chainSchema,
        },
      },
      async ({ txHash, chain }) => {
        try {
          const result = await this.blockchainService.getTransaction(
            txHash,
            chain as Chain,
          );
          // A single transaction is normally a bounded, cheap payload, so
          // (unlike fetch_history) the full utxo is kept intact by default.
          // But a large CoinJoin/consolidation row (100+ combined
          // inputs+outputs) can still blow the 8 KB result cap on its own —
          // clamp to the same count-only summary fetch_history uses once
          // that threshold is crossed.
          const utxoSize = result.utxo
            ? result.utxo.inputs.length + result.utxo.outputs.length
            : 0;
          const payload =
            result.utxo && utxoSize > 100
              ? { ...result, utxo: summarizeUtxo(result.utxo) }
              : result;
          return textResult(payload);
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // blockchain_get_address_info — balance, type, and label for an address.
    //
    // Returns AddressInfoResult: { address, addressType, balance, label? }.
    // -----------------------------------------------------------------------
    server.registerTool(
      'blockchain_get_address_info',
      {
        description:
          'Get basic information about a wallet or contract address: native balance, address type (wallet or contract), and an optional human-readable label.',
        inputSchema: {
          address: z.string(),
          chain: chainSchema,
        },
      },
      async ({ address, chain }) => {
        try {
          const result = await this.blockchainService.getAddressInfo(
            address,
            chain as Chain,
          );
          return textResult(result);
        } catch (e) {
          return errorResult(e);
        }
      },
    );
  }
}
