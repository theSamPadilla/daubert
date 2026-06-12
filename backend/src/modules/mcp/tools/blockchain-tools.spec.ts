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
