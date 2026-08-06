/**
 * BlockchainToolsService unit tests.
 *
 * Three tools under test:
 *   - blockchain_fetch_history    — delegates to BlockchainService.fetchHistory with
 *                                   optional date/maxTotal opts; pre-truncates the
 *                                   transactions array so the payload stays under 8 KB.
 *   - blockchain_get_transaction  — delegates to BlockchainService.getTransaction.
 *   - blockchain_get_address_info — delegates to BlockchainService.getAddressInfo.
 *
 * No case scope — these tools wrap Daubert's server-side chain-explorer keys.
 * The per-call eligibility gate (McpAuthHelper) and per-session throttle already
 * bound access; these handlers do NOT call caseAccess.assertRole.
 *
 * Same harness pattern as navigate-tools.spec / read-tools.spec:
 *   - Build a real McpServer and register handlers via BlockchainToolsService.registerAll().
 *   - Extract handlers from `_registeredTools` and invoke directly.
 *   - BlockchainService is mocked; no real HTTP calls.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { BlockchainService } from '../../blockchain/blockchain.service';
import { AuthSuccess } from '../mcp-auth.helper';
import { BlockchainToolsService } from './blockchain-tools';
import { RESULT_CAP_BYTES } from './tool-utils';
import { summarizeUtxo } from '../../ai/investigation-data.utils';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const SESSION_ID = 'sess-1';

const USER = { id: USER_ID, email: 'u@example.com' } as any;
const SESSION = { id: SESSION_ID, ownerUserId: USER_ID, organizationId: ORG_ID } as any;

const AUTH: AuthSuccess = {
  kind: 'oauth',
  user: USER,
  session: SESSION,
  principal: {
    kind: 'mcp',
    userId: USER_ID,
    organizationId: ORG_ID,
    sessionId: SESSION_ID,
  },
};

const SAMPLE_TX = {
  id: 'tx-id-1',
  from: '0xabc',
  to: '0xdef',
  txHash: '0xhash1',
  chain: 'ethereum',
  timestamp: '2024-01-01T00:00:00.000Z',
  amount: '1000000000000000000',
  token: { address: '0x', symbol: 'ETH', decimals: 18 },
  blockNumber: 18000000,
  notes: '',
  tags: [],
  crossTrace: false,
};

const SAMPLE_TX_DETAIL = {
  txHash: '0xhash1',
  from: '0xabc',
  to: '0xdef',
  chain: 'ethereum',
  amount: '1000000000000000000',
  timestamp: '2024-01-01T00:00:00.000Z',
  blockNumber: 18000000,
  token: { address: '0x', symbol: 'ETH', decimals: 18 },
  tokenTransfers: [],
  isError: false,
};

const SAMPLE_ADDRESS_INFO = {
  address: '0xabc',
  addressType: 'wallet' as const,
  balance: '1000000000000000000',
  label: undefined,
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function buildService(overrides: {
  blockchain?: Partial<BlockchainService>;
} = {}) {
  const blockchain = {
    fetchHistory: jest.fn().mockResolvedValue({ transactions: [SAMPLE_TX], chain: 'ethereum', address: '0xabc' }),
    getTransaction: jest.fn().mockResolvedValue(SAMPLE_TX_DETAIL),
    getAddressInfo: jest.fn().mockResolvedValue(SAMPLE_ADDRESS_INFO),
    ...overrides.blockchain,
  } as unknown as BlockchainService;

  const service = new BlockchainToolsService(blockchain);
  const server = new McpServer({ name: 'test-mcp', version: '0.0.1' });
  service.registerAll(server, AUTH);

  return { server, blockchain };
}

async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const tools = (server as any)._registeredTools as Record<
    string,
    { handler: (...handlerArgs: unknown[]) => Promise<unknown> }
  >;
  const tool = tools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  const extra = {} as unknown;
  const result =
    Object.keys(args).length > 0
      ? await tool.handler(args, extra)
      : await tool.handler(extra);
  return result as { content: { type: string; text: string }[]; isError?: boolean };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlockchainToolsService', () => {
  // -------------------------------------------------------------------------
  // blockchain_fetch_history
  // -------------------------------------------------------------------------

  describe('blockchain_fetch_history', () => {
    it('delegates to BlockchainService.fetchHistory with address and chain', async () => {
      const { server, blockchain } = buildService();

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: '0xabc',
        chain: 'ethereum',
      });

      expect(blockchain.fetchHistory).toHaveBeenCalledWith(
        '0xabc',
        'ethereum',
        expect.objectContaining({}),
      );
      expect(result.isError).toBeUndefined();
    });

    it('passes startDate, endDate, and maxTotal opts through to fetchHistory', async () => {
      const { server, blockchain } = buildService();

      await callTool(server, 'blockchain_fetch_history', {
        address: '0xabc',
        chain: 'polygon',
        startDate: '2024-01-01',
        endDate: '2024-06-30',
        maxTotal: 50,
      });

      const call = (blockchain.fetchHistory as jest.Mock).mock.calls[0];
      expect(call[0]).toBe('0xabc');
      expect(call[1]).toBe('polygon');
      expect(call[2]).toMatchObject({
        startDate: '2024-01-01',
        endDate: '2024-06-30',
        maxTotal: 50,
      });
    });

    it('returns transactions in the result', async () => {
      const { server } = buildService();

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: '0xabc',
        chain: 'ethereum',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('transactions');
      expect(parsed.transactions).toHaveLength(1);
      expect(parsed.transactions[0].txHash).toBe('0xhash1');
    });

    it('rejects an unknown chain as an MCP tool error (not a crash)', async () => {
      const { server } = buildService({
        blockchain: {
          fetchHistory: jest.fn().mockRejectedValue(new Error('Unknown chain: notachain')),
        },
      });

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: '0xabc',
        chain: 'notachain',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('notachain');
    });

    it('pre-truncates transactions array so payload stays under 8 KB cap', async () => {
      // Build a mock result with many fat transactions that would exceed 8 KB.
      const bigTx = {
        ...SAMPLE_TX,
        notes: 'x'.repeat(500),
      };
      const manyTxs = Array.from({ length: 50 }, (_, i) => ({ ...bigTx, id: `tx-${i}`, txHash: `0xhash${i}` }));

      const { server } = buildService({
        blockchain: {
          fetchHistory: jest.fn().mockResolvedValue({
            transactions: manyTxs,
            chain: 'ethereum',
            address: '0xabc',
          }),
        },
      });

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: '0xabc',
        chain: 'ethereum',
      });

      // No crash
      expect(result.isError).toBeUndefined();

      // The final text payload must fit within the cap (plus truncation suffix overhead)
      // We allow some slack for the suffix itself.
      expect(result.content[0].text.length).toBeLessThanOrEqual(RESULT_CAP_BYTES + 200);

      // The result must include truncated:true and totalCount so the agent knows more exist
      const parsed = JSON.parse(
        result.content[0].text.replace(/\n…\[truncated:.*$/, ''),
      );
      expect(parsed.truncated).toBe(true);
      expect(parsed.totalCount).toBe(manyTxs.length);
    });

    it('does NOT set truncated when all transactions fit', async () => {
      const { server } = buildService();

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: '0xabc',
        chain: 'ethereum',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.truncated).toBeFalsy();
    });

    it('does NOT require case scope (no caseAccess interaction)', async () => {
      // BlockchainToolsService has no CaseAccessService dep. Registering and
      // calling a tool with no caseId must succeed normally.
      const { server, blockchain } = buildService();

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: '0xabc',
        chain: 'tron',
      });

      expect(result.isError).toBeUndefined();
      expect(blockchain.fetchHistory).toHaveBeenCalledWith('0xabc', 'tron', expect.anything());
    });

    it('summarizes a row utxo (50-in/50-out) to counts, fits the cap, and is not truncated', async () => {
      // A 50-in/50-out CoinJoin-style row: raw utxo arrays alone serialize to
      // well over the 8 KB cap, but the summarized {inputs, outputs, fee, ...}
      // shape is tiny — the whole payload should fit without truncation.
      const bigUtxo = {
        inputs: Array.from({ length: 50 }, (_, i) => ({
          address: `bc1qinput${i}`,
          value: '100000',
          prevTxid: 'a'.repeat(64),
          prevVout: i,
          scriptType: 'witness_v0_keyhash',
        })),
        outputs: Array.from({ length: 50 }, (_, i) => ({
          address: `bc1qoutput${i}`,
          value: '99000',
          index: i,
          scriptType: 'witness_v0_keyhash',
          change: i === 3,
        })),
        fee: '5000',
        vout: 3,
        warnings: ['coinjoin_suspected'],
      };
      const rowWithUtxo = {
        ...SAMPLE_TX,
        id: 'tx-coinjoin',
        txHash: '0xcoinjoin',
        chain: 'bitcoin',
        utxo: bigUtxo,
      };

      // Sanity check on the fixture: the raw row must actually exceed the cap
      // so this test proves summarization (not luck) keeps it under.
      expect(JSON.stringify(rowWithUtxo).length).toBeGreaterThan(RESULT_CAP_BYTES);

      const { server } = buildService({
        blockchain: {
          fetchHistory: jest.fn().mockResolvedValue({
            transactions: [rowWithUtxo],
            chain: 'bitcoin',
            address: 'bc1qxyz',
          }),
        },
      });

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: 'bc1qxyz',
        chain: 'bitcoin',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);

      // Fits fully — no truncation needed once utxo is summarized.
      expect(parsed.truncated).toBeFalsy();
      expect(parsed.transactions).toHaveLength(1);

      const utxo = parsed.transactions[0].utxo;
      expect(utxo).toEqual({
        inputs: 50,
        outputs: 50,
        fee: '5000',
        vout: 3,
        change: true,
        warnings: ['coinjoin_suspected'],
      });
      // Counts, not arrays.
      expect(Array.isArray(utxo.inputs)).toBe(false);
      expect(Array.isArray(utxo.outputs)).toBe(false);
    });

    it('never returns zero rows when data exists, even if binary search would land on 0', async () => {
      // Each row carries a 50-in/50-out utxo PLUS a padded non-utxo field
      // (notes), sized so that even a single SUMMARIZED row alone exceeds
      // the per-transactions budget under the envelope. This forces the
      // binary search to legitimately land on best === 0 — the guard must
      // then still return the first row rather than an empty array.
      //
      // The padding length is calibrated dynamically (via the same
      // envelope/budget math buildFetchHistoryPayload uses, and the real
      // summarizeUtxo) rather than hardcoded, so the test doesn't silently
      // stop exercising the guard if unrelated field sizes shift.
      const chain = 'bitcoin';
      const address = 'bc1qxyz';
      const totalCount = 5;

      const makeUtxo = (n: number) => ({
        inputs: Array.from({ length: n }, (_, i) => ({
          address: `bc1qinput${i}`,
          value: '100000',
          prevTxid: 'a'.repeat(64),
          prevVout: i,
        })),
        outputs: Array.from({ length: n }, (_, i) => ({
          address: `bc1qoutput${i}`,
          value: '99000',
          index: i,
        })),
        fee: '5000',
      });
      const makeRow = (padLen: number) => ({
        ...SAMPLE_TX,
        id: 'tx-huge',
        txHash: '0xhugetx',
        chain,
        notes: 'x'.repeat(padLen),
        utxo: makeUtxo(50),
      });

      const envelopeSize = JSON.stringify({
        chain,
        address,
        truncated: true,
        totalCount,
        transactions: [],
      }).length;
      const budgetForTxs = RESULT_CAP_BYTES - envelopeSize - 2;

      const summarizedSoloSize = (padLen: number) => {
        const row = makeRow(padLen);
        const summarizedRow = { ...row, utxo: summarizeUtxo(row.utxo) };
        return JSON.stringify([summarizedRow]).length;
      };

      // Smallest padding where a single summarized row alone overflows the
      // per-transactions budget.
      let lo = 0;
      let hi = 8000;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (summarizedSoloSize(mid) > budgetForTxs) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      const padLen = lo;
      expect(summarizedSoloSize(padLen)).toBeGreaterThan(budgetForTxs);

      const manyHugeRows = Array.from({ length: totalCount }, (_, i) => ({
        ...makeRow(padLen),
        id: `tx-huge-${i}`,
        txHash: `0xhuge${i}`,
      }));

      const { server } = buildService({
        blockchain: {
          fetchHistory: jest.fn().mockResolvedValue({
            transactions: manyHugeRows,
            chain,
            address,
          }),
        },
      });

      const result = await callTool(server, 'blockchain_fetch_history', {
        address,
        chain,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(
        result.content[0].text.replace(/\n…\[truncated:.*$/, ''),
      );

      // Never zero rows when data exists.
      expect(parsed.transactions.length).toBeGreaterThanOrEqual(1);
      expect(parsed.truncated).toBe(true);
      expect(parsed.totalCount).toBe(totalCount);
      // The returned row's utxo is still summarized (counts, not arrays).
      expect(parsed.transactions[0].utxo.inputs).toBe(50);
      expect(parsed.transactions[0].utxo.outputs).toBe(50);
    });

    it('accepts chain "bitcoin" at the schema level (derived from CHAIN_IDS)', async () => {
      // The zod enum now derives from the shared registry, which includes
      // bitcoin. Schema parsing must accept it and let the call reach the
      // (mocked) service — the real ProviderRegistry guard for the transient
      // UTXO-less window is exercised elsewhere, not here.
      const { server, blockchain } = buildService();

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: 'bc1qxyz',
        chain: 'bitcoin',
      });

      expect(result.isError).toBeUndefined();
      expect(blockchain.fetchHistory).toHaveBeenCalledWith('bc1qxyz', 'bitcoin', expect.anything());
    });

    it('accepts chain "solana" at the schema level (derived from CHAIN_IDS)', async () => {
      // Same derivation as the bitcoin case above — CHAIN_IDS now includes
      // solana, so schema parsing must accept it and let the call reach the
      // (mocked) service.
      const { server, blockchain } = buildService();

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: 'SoLxyz111111111111111111111111111111111111',
        chain: 'solana',
      });

      expect(result.isError).toBeUndefined();
      expect(blockchain.fetchHistory).toHaveBeenCalledWith(
        'SoLxyz111111111111111111111111111111111111',
        'solana',
        expect.anything(),
      );
    });

    it('passes solana context through untouched (bounded, no utxo-style summarization)', async () => {
      // SolanaContext is ~12 scalar fields, no arrays of objects — unlike
      // utxo, it never needs count-collapsing to fit the 8 KB cap. A 20-row
      // payload with a full solana block on every row (purpose-built minimal
      // row, short fixture addresses — same convention as SAMPLE_TX's
      // '0xabc'/'0xdef') fits comfortably under the cap, with the context
      // forwarded whole and unsummarized.
      const solanaContext = {
        transferIndex: 0,
        feePayer: 'FeePayer1',
        kind: 'spl',
        mint: 'Mint1',
        decimals: 6,
        fromTokenAccount: 'FromATA1',
        toTokenAccount: 'ToATA1',
        type: 'TRANSFER',
        source: 'JUPITER',
        slot: 250000000,
      };
      const rows = Array.from({ length: 20 }, (_, i) => ({
        id: `tx-sol-${i}`,
        from: 'SoLFrom1',
        to: 'SoLTo1',
        txHash: `sig${i}`,
        chain: 'solana',
        timestamp: '2024-01-01T00:00:00.000Z',
        amount: '1500000',
        token: 'USDC',
        blockNumber: 250000000,
        solana: { ...solanaContext, transferIndex: i },
      }));

      const { server } = buildService({
        blockchain: {
          fetchHistory: jest.fn().mockResolvedValue({
            transactions: rows,
            chain: 'solana',
            address: 'SoLxyz1',
          }),
        },
      });

      const result = await callTool(server, 'blockchain_fetch_history', {
        address: 'SoLxyz1',
        chain: 'solana',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text.length).toBeLessThanOrEqual(RESULT_CAP_BYTES);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.truncated).toBeFalsy();
      expect(parsed.transactions).toHaveLength(20);
      expect(parsed.transactions[0].solana).toEqual({ ...solanaContext, transferIndex: 0 });
      expect(parsed.transactions[19].solana).toEqual({ ...solanaContext, transferIndex: 19 });
    });
  });

  // -------------------------------------------------------------------------
  // blockchain_get_transaction
  // -------------------------------------------------------------------------

  describe('blockchain_get_transaction', () => {
    it('delegates to BlockchainService.getTransaction with txHash and chain', async () => {
      const { server, blockchain } = buildService();

      const result = await callTool(server, 'blockchain_get_transaction', {
        txHash: '0xhash1',
        chain: 'ethereum',
      });

      expect(blockchain.getTransaction).toHaveBeenCalledWith('0xhash1', 'ethereum');
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.txHash).toBe('0xhash1');
    });

    it('surfaces service errors as isError tool results (not a crash)', async () => {
      const { server } = buildService({
        blockchain: {
          getTransaction: jest.fn().mockRejectedValue(new Error('tx not found')),
        },
      });

      const result = await callTool(server, 'blockchain_get_transaction', {
        txHash: '0xmissing',
        chain: 'ethereum',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('tx not found');
    });

    it('surfaces unknown chain error from getTransaction as isError (not a crash)', async () => {
      const { server } = buildService({
        blockchain: {
          getTransaction: jest.fn().mockRejectedValue(new Error('Unknown chain: badchain')),
        },
      });

      const result = await callTool(server, 'blockchain_get_transaction', {
        txHash: '0xhash1',
        chain: 'badchain',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('badchain');
    });

    it('returns the full utxo (inputs/outputs arrays) untouched — no summarization', async () => {
      // blockchain_get_transaction returns a single bounded object; unlike
      // fetch_history it must NOT collapse utxo down to counts UNLESS the
      // combined inputs+outputs count crosses the 100-row clamp threshold
      // (see the next test). Sized well under both that threshold and the
      // generic 8 KB textResult cap so this test isolates the summarization
      // behavior from those unrelated, pre-existing caps.
      const utxo = {
        inputs: Array.from({ length: 10 }, (_, i) => ({
          address: `bc1qinput${i}`,
          value: '100000',
          prevTxid: 'a'.repeat(64),
          prevVout: i,
        })),
        outputs: Array.from({ length: 10 }, (_, i) => ({
          address: `bc1qoutput${i}`,
          value: '99000',
          index: i,
        })),
        fee: '5000',
        warnings: ['coinjoin_suspected'],
      };
      const detailWithUtxo = { ...SAMPLE_TX_DETAIL, chain: 'bitcoin', utxo };

      const { server } = buildService({
        blockchain: {
          getTransaction: jest.fn().mockResolvedValue(detailWithUtxo),
        },
      });

      const result = await callTool(server, 'blockchain_get_transaction', {
        txHash: '0xhash1',
        chain: 'bitcoin',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.utxo.inputs).toHaveLength(10);
      expect(parsed.utxo.outputs).toHaveLength(10);
      expect(parsed.utxo.inputs[0]).toMatchObject({ address: 'bc1qinput0' });
      expect(parsed.utxo.warnings).toEqual(['coinjoin_suspected']);
    });

    it('clamps a large utxo (>100 combined inputs+outputs) to a count-only summary', async () => {
      // A big CoinJoin/consolidation row can blow the 8 KB cap on its own even
      // as a single transaction — once combined inputs+outputs cross 100, the
      // handler must fall back to the same count-only summarizeUtxo shape
      // fetch_history uses, rather than serializing the raw arrays.
      const utxo = {
        inputs: Array.from({ length: 60 }, (_, i) => ({
          address: `bc1qinput${i}`,
          value: '100000',
          prevTxid: 'a'.repeat(64),
          prevVout: i,
        })),
        outputs: Array.from({ length: 60 }, (_, i) => ({
          address: `bc1qoutput${i}`,
          value: '99000',
          index: i,
        })),
        fee: '5000',
        warnings: ['coinjoin_suspected'],
      };
      const detailWithUtxo = { ...SAMPLE_TX_DETAIL, chain: 'bitcoin', utxo };

      const { server } = buildService({
        blockchain: {
          getTransaction: jest.fn().mockResolvedValue(detailWithUtxo),
        },
      });

      const result = await callTool(server, 'blockchain_get_transaction', {
        txHash: '0xhash1',
        chain: 'bitcoin',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.utxo.inputs).toBe(60);
      expect(parsed.utxo.outputs).toBe(60);
      expect(parsed.utxo.fee).toBe('5000');
      expect(parsed.utxo.warnings).toEqual(['coinjoin_suspected']);
      // The raw arrays must not be present on the summarized shape.
      expect(Array.isArray(parsed.utxo.inputs)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // blockchain_get_address_info
  // -------------------------------------------------------------------------

  describe('blockchain_get_address_info', () => {
    it('delegates to BlockchainService.getAddressInfo with address and chain', async () => {
      const { server, blockchain } = buildService();

      const result = await callTool(server, 'blockchain_get_address_info', {
        address: '0xabc',
        chain: 'base',
      });

      expect(blockchain.getAddressInfo).toHaveBeenCalledWith('0xabc', 'base');
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.address).toBe('0xabc');
      expect(parsed.addressType).toBe('wallet');
    });

    it('surfaces service errors as isError tool results (not a crash)', async () => {
      const { server } = buildService({
        blockchain: {
          getAddressInfo: jest.fn().mockRejectedValue(new Error('rate limited')),
        },
      });

      const result = await callTool(server, 'blockchain_get_address_info', {
        address: '0xabc',
        chain: 'ethereum',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('rate limited');
    });

    it('surfaces unknown chain error from getAddressInfo as isError (not a crash)', async () => {
      const { server } = buildService({
        blockchain: {
          getAddressInfo: jest.fn().mockRejectedValue(new Error('Unknown chain: weirdchain')),
        },
      });

      const result = await callTool(server, 'blockchain_get_address_info', {
        address: '0xabc',
        chain: 'weirdchain',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('weirdchain');
    });

    it('does NOT require case scope', async () => {
      const { server, blockchain } = buildService();

      const result = await callTool(server, 'blockchain_get_address_info', {
        address: '0xabc',
        chain: 'arbitrum',
      });

      expect(result.isError).toBeUndefined();
      expect(blockchain.getAddressInfo).toHaveBeenCalledWith('0xabc', 'arbitrum');
    });
  });
});
