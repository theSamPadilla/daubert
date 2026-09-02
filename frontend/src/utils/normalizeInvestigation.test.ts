import { normalizeInvestigation } from './normalizeInvestigation';
import type { Investigation as ApiInvestigation, Trace as ApiTrace } from '@/lib/api-client';

// ── Fixture builders ─────────────────────────────────────────────────────────

function apiInvestigation(traces: ApiTrace[]): ApiInvestigation {
  return {
    id: 'inv-1',
    name: 'Investigation',
    notes: null,
    caseId: 'case-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    traces,
  };
}

function apiTrace(data: Record<string, unknown>, overrides: Partial<ApiTrace> = {}): ApiTrace {
  return {
    id: 'trace-1',
    name: 'Trace 1',
    color: null,
    visible: true,
    collapsed: false,
    data,
    investigationId: 'inv-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TOKEN = { address: '0xtok', symbol: 'USDC', decimals: 6 };

function rawEdge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    from: 'n1',
    to: 'n2',
    chain: 'ethereum',
    timestamp: '1700000000',
    amount: '1000000',
    token: TOKEN,
    notes: '',
    tags: [],
    blockNumber: 1,
    crossTrace: false,
    ...overrides,
  };
}

describe('normalizeInvestigation', () => {
  it('carries tokenStandard through on a node', () => {
    const inv = apiInvestigation([
      apiTrace({
        nodes: [
          {
            id: 'n1',
            label: 'n1',
            address: '0xabc',
            chain: 'ethereum',
            notes: '',
            tags: [],
            position: { x: 0, y: 0 },
            parentTrace: 'trace-1',
            tokenStandard: 'erc20',
          },
        ],
        edges: [],
      }),
    ]);

    const result = normalizeInvestigation(inv);

    expect(result.traces[0].nodes[0].tokenStandard).toBe('erc20');
  });

  it('carries transfers and selectedTransferIndex through on an edge', () => {
    const transfers = [
      { standard: 'erc20', from: '0xa', to: '0xb', amount: '1', token: TOKEN, logIndex: 0 },
      { standard: 'erc20', from: '0xa', to: '0xc', amount: '2', token: TOKEN, logIndex: 1 },
    ];
    const inv = apiInvestigation([
      apiTrace({
        nodes: [],
        edges: [rawEdge({ transfers, selectedTransferIndex: 1 })],
      }),
    ]);

    const result = normalizeInvestigation(inv);

    expect(result.traces[0].edges[0].transfers).toEqual(transfers);
    expect(result.traces[0].edges[0].selectedTransferIndex).toBe(1);
  });

  it('normalizes an edge without transfers/selectedTransferIndex to undefined, without throwing', () => {
    const inv = apiInvestigation([
      apiTrace({
        nodes: [],
        edges: [rawEdge()],
      }),
    ]);

    expect(() => normalizeInvestigation(inv)).not.toThrow();

    const result = normalizeInvestigation(inv);

    expect(result.traces[0].edges[0].transfers).toBeUndefined();
    expect(result.traces[0].edges[0].selectedTransferIndex).toBeUndefined();
  });

  it('carries tokenStandard and tokenId through on an edge', () => {
    const inv = apiInvestigation([
      apiTrace({
        nodes: [],
        edges: [rawEdge({ tokenStandard: 'erc721', tokenId: '42' })],
      }),
    ]);

    const result = normalizeInvestigation(inv);

    expect(result.traces[0].edges[0].tokenStandard).toBe('erc721');
    expect(result.traces[0].edges[0].tokenId).toBe('42');
  });
});
