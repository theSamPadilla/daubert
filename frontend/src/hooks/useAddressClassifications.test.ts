/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useAddressClassifications,
  __resetAddressClassificationSession,
  type AddressClassification,
} from './useAddressClassifications';
import { apiClient } from '@/lib/api-client';
import type { Investigation } from '@/types/investigation';
import type { components } from '@/generated/api-types';

type ChainAddressPair = components['schemas']['ChainAddressPair'];

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    lookupAddressClassifications: jest.fn(),
    classifyAddresses: jest.fn(),
  },
}));

const A1 = '0x1111111111111111111111111111111111111111';
const A2 = '0x2222222222222222222222222222222222222222';
const A3 = '0x3333333333333333333333333333333333333333';
const MIXED = '0xAbCdEf0000000000000000000000000000001234';
const MIXED_LOWER = MIXED.toLowerCase();
const TRON = 'TQn9Y2khEsZaXaLcJPCyrPjK7dRWxJPvJp';
const BTC_TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

function evmAddress(n: number): string {
  return `0x${String(n).repeat(40).slice(0, 40)}`;
}

function node(address: string, chain: string, extra: Record<string, unknown> = {}) {
  return {
    id: `${chain}-${address}-${JSON.stringify(extra)}`,
    label: address,
    address,
    chain,
    notes: '',
    tags: [],
    position: { x: 0, y: 0 },
    parentTrace: 't1',
    ...extra,
  };
}

function investigation(traces: Array<{ id: string; nodes: unknown[] }>): Investigation {
  return {
    id: 'i1',
    name: 'I',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
    traces: traces.map((t) => ({
      id: t.id,
      name: t.id,
      criteria: { type: 'custom' },
      visible: true,
      collapsed: false,
      nodes: t.nodes,
      edges: [],
    })),
  } as unknown as Investigation;
}

function row(chain: string, address: string, over: Partial<AddressClassification> = {}): AddressClassification {
  return {
    chain,
    address,
    addressType: 'wallet',
    tokenStandard: null,
    symbol: null,
    decimals: null,
    name: null,
    probedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** The `chain:address` keys a call was made with, sorted for order-insensitive comparison. */
function keysOf(pairs: ChainAddressPair[]): string[] {
  return pairs.map((p) => `${p.chain}:${p.address}`).sort();
}

function lookupMock() {
  return apiClient.lookupAddressClassifications as jest.Mock;
}
function classifyMock() {
  return apiClient.classifyAddresses as jest.Mock;
}

/** Let the hook's async chain (lookup → classify → merge) settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetAddressClassificationSession();
  lookupMock().mockResolvedValue([]);
  classifyMock().mockResolvedValue({ classified: [], remaining: 0 });
});

it('collects pairs across every trace, skipping txJunction and empty addresses', async () => {
  const inv = investigation([
    {
      id: 't1',
      nodes: [
        node(A1, 'ethereum'),
        node(BTC_TXID, 'bitcoin', { kind: 'txJunction' }),
        node('', 'ethereum'),
      ],
    },
    {
      id: 't2',
      nodes: [
        node(MIXED, 'ethereum'),
        node(TRON, 'tron'),
        node('   ', 'polygon'),
        // Duplicate of a t1 node — must be asked for once, not twice.
        node(A1, 'ethereum', { groupId: 'g1' }),
      ],
    },
  ]);

  renderHook(() => useAddressClassifications(inv));

  await waitFor(() => expect(lookupMock()).toHaveBeenCalledTimes(1));
  expect(keysOf(lookupMock().mock.calls[0][0])).toEqual(
    [`ethereum:${A1}`, `ethereum:${MIXED_LOWER}`, `tron:${TRON}`].sort(),
  );
});

it('looks up once and classifies only the misses', async () => {
  const inv = investigation([{ id: 't1', nodes: [node(A1, 'ethereum'), node(A2, 'ethereum')] }]);
  lookupMock().mockResolvedValue([row('ethereum', A1)]);
  classifyMock().mockResolvedValue({ classified: [row('ethereum', A2)], remaining: 0 });

  const { result } = renderHook(() => useAddressClassifications(inv));

  await waitFor(() => expect(classifyMock()).toHaveBeenCalledTimes(1));
  expect(lookupMock()).toHaveBeenCalledTimes(1);
  expect(keysOf(classifyMock().mock.calls[0][0])).toEqual([`ethereum:${A2}`]);

  await waitFor(() => expect(result.current.lookup('ethereum', A2)).toBeDefined());
  expect(result.current.lookup('ethereum', A1)).toBeDefined();
});

it('does not re-POST when the investigation object changes but the address set does not', async () => {
  const nodes = [node(A1, 'ethereum'), node(A2, 'ethereum')];
  const first = investigation([{ id: 't1', nodes }]);

  const { rerender } = renderHook(({ inv }) => useAddressClassifications(inv), {
    initialProps: { inv: first },
  });

  await waitFor(() => expect(lookupMock()).toHaveBeenCalledTimes(1));

  // Simulate a node drag: brand new investigation/trace/node objects, moved
  // positions, identical address set.
  const dragged = investigation([
    {
      id: 't1',
      nodes: [
        { ...node(A1, 'ethereum'), position: { x: 120, y: 40 } },
        { ...node(A2, 'ethereum'), position: { x: 300, y: 90 } },
      ],
    },
  ]);
  rerender({ inv: dragged });
  await flush();

  // A second drag, for good measure.
  rerender({ inv: investigation([{ id: 't1', nodes: [node(A2, 'ethereum'), node(A1, 'ethereum')] }]) });
  await flush();

  expect(lookupMock()).toHaveBeenCalledTimes(1);
});

it('re-POSTs when a genuinely new address appears', async () => {
  const { rerender } = renderHook(({ inv }) => useAddressClassifications(inv), {
    initialProps: { inv: investigation([{ id: 't1', nodes: [node(A1, 'ethereum')] }]) },
  });

  await waitFor(() => expect(lookupMock()).toHaveBeenCalledTimes(1));

  rerender({
    inv: investigation([{ id: 't1', nodes: [node(A1, 'ethereum'), node(A3, 'ethereum')] }]),
  });

  await waitFor(() => expect(lookupMock()).toHaveBeenCalledTimes(2));
  expect(keysOf(lookupMock().mock.calls[1][0])).toEqual([`ethereum:${A1}`, `ethereum:${A3}`].sort());
});

it('drains classify sequentially while remaining > 0', async () => {
  const addresses = [1, 2, 3, 4, 5, 6].map(evmAddress);
  const inv = investigation([
    { id: 't1', nodes: addresses.map((a) => node(a, 'ethereum')) },
  ]);

  const CAP = 2;
  let inFlight = 0;
  let maxInFlight = 0;
  const batchSizes: number[] = [];

  classifyMock().mockImplementation(async (pairs: ChainAddressPair[]) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    batchSizes.push(pairs.length);
    await Promise.resolve();
    const attempted = pairs.slice(0, CAP);
    inFlight -= 1;
    return {
      classified: attempted.map((p) => row(p.chain, p.address)),
      remaining: Math.max(0, pairs.length - CAP),
    };
  });

  const { result } = renderHook(() => useAddressClassifications(inv));

  await waitFor(() => expect(classifyMock()).toHaveBeenCalledTimes(3));
  // 6 pending → 4 pending → 2 pending, and never two calls open at once.
  expect(batchSizes).toEqual([6, 4, 2]);
  expect(maxInFlight).toBe(1);

  await waitFor(() => expect(result.current.lookup('ethereum', addresses[5])).toBeDefined());
});

it('stops classifying when a round makes no progress, and does not re-ask those pairs', async () => {
  const inv = investigation([
    { id: 't1', nodes: [node(A1, 'ethereum'), node(A2, 'ethereum')] },
  ]);
  // The chain has nothing to say about either address.
  classifyMock().mockResolvedValue({ classified: [], remaining: 2 });

  const { rerender } = renderHook(({ i }) => useAddressClassifications(i), {
    initialProps: { i: inv },
  });

  await waitFor(() => expect(classifyMock()).toHaveBeenCalledTimes(1));
  await flush();
  expect(classifyMock()).toHaveBeenCalledTimes(1);

  // Adding one address re-runs the effect; the two hopeless pairs must not be
  // asked about again.
  classifyMock().mockResolvedValue({ classified: [row('ethereum', A3)], remaining: 0 });
  rerender({
    i: investigation([
      { id: 't1', nodes: [node(A1, 'ethereum'), node(A2, 'ethereum'), node(A3, 'ethereum')] },
    ]),
  });

  await waitFor(() => expect(classifyMock()).toHaveBeenCalledTimes(2));
  expect(keysOf(classifyMock().mock.calls[1][0])).toEqual([`ethereum:${A3}`]);
});

it('changes the identity it exposes for invalidation once rows land', async () => {
  const inv = investigation([{ id: 't1', nodes: [node(A1, 'ethereum')] }]);
  let resolveLookup: (rows: AddressClassification[]) => void = () => {};
  lookupMock().mockReturnValue(
    new Promise<AddressClassification[]>((resolve) => {
      resolveLookup = resolve;
    }),
  );

  const { result } = renderHook(() => useAddressClassifications(inv));

  const initialLookup = result.current.lookup;
  const initialMap = result.current.classifications;
  expect(result.current.version).toBe(0);

  await act(async () => {
    resolveLookup([row('ethereum', A1)]);
    await Promise.resolve();
  });

  await waitFor(() => expect(result.current.version).toBeGreaterThan(0));
  // A consumer effect keyed on any of these three re-runs. `useLabeledEntities`
  // deliberately does not do this; this hook must.
  expect(result.current.lookup).not.toBe(initialLookup);
  expect(result.current.classifications).not.toBe(initialMap);
});

it('matches a mixed-case EVM address against the lowercased row on file', async () => {
  const inv = investigation([{ id: 't1', nodes: [node(MIXED, 'ethereum')] }]);
  lookupMock().mockResolvedValue([
    row('ethereum', MIXED_LOWER, { addressType: 'contract', tokenStandard: 'erc20', symbol: 'USDT', decimals: 6 }),
  ]);

  const { result } = renderHook(() => useAddressClassifications(inv));

  await waitFor(() => expect(result.current.lookup('ethereum', MIXED)).toBeDefined());
  expect(result.current.lookup('ethereum', MIXED)!.symbol).toBe('USDT');
  expect(result.current.lookup('ethereum', MIXED_LOWER)!.symbol).toBe('USDT');
  // The server was asked with the canonical form, not the mixed-case one.
  expect(keysOf(lookupMock().mock.calls[0][0])).toEqual([`ethereum:${MIXED_LOWER}`]);
});
