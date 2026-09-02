/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockGetTransaction = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getTransaction: (...args: unknown[]) => mockGetTransaction(...args),
  },
}));

// @web3icons/react ships ESM-only (no "require" export condition), which Jest's
// CJS resolver can't load. ChainSelect only uses these as decorative icons, so
// stub them out rather than pulling the real package into the test environment.
jest.mock(
  '@web3icons/react',
  () => {
    const Stub = () => null;
    return {
      NetworkEthereum: Stub,
      NetworkPolygon: Stub,
      NetworkArbitrumOne: Stub,
      NetworkBase: Stub,
      NetworkTron: Stub,
      NetworkBitcoin: Stub,
      NetworkSolana: Stub,
    };
  },
  { virtual: true },
);

import { QuickAddInput } from './QuickAddInput';

// Real reported tx hash: a relayed call whose native envelope moves nothing —
// the decoded receipt legs are the only place the actual transfer shows up.
const TX_HASH = '0xb7a0ee5870a518ecf9784e447d536c3c4f17a4e7cc853d3d5c38f46e7cbcc1ef';

const RELAYER = '0x1111111111111111111111111111111111111e';
const CONTRACT = '0x6666666666666666666666666666666666666e';
const SENDER = '0x2222222222222222222222222222222222222e';
const RECEIVER = '0x3333333333333333333333333333333333333e';
const FEE_RECEIVER = '0x4444444444444444444444444444444444444e';
const NFT_CONTRACT = '0x5555555555555555555555555555555555555e';

const USDC = { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 };
const BAYC = { address: NFT_CONTRACT, symbol: 'BAYC', decimals: 0 };

const DETAIL_WITH_TRANSFERS = {
  txHash: TX_HASH,
  from: RELAYER,
  to: CONTRACT,
  chain: 'ethereum',
  amount: '0',
  timestamp: '2026-08-01T00:00:00.000Z',
  blockNumber: 12345,
  token: {},
  tokenTransfers: [],
  transfers: [
    { standard: 'erc20', from: SENDER, to: RECEIVER, amount: '0', token: USDC, logIndex: 0 },
    { standard: 'erc20', from: SENDER, to: RECEIVER, amount: '25000000', token: USDC, logIndex: 1 },
    { standard: 'erc20', from: RECEIVER, to: FEE_RECEIVER, amount: '500000', token: USDC, logIndex: 2 },
    { standard: 'erc721', from: SENDER, to: RECEIVER, amount: '1', tokenId: '42', token: BAYC, logIndex: 3 },
  ],
  isError: false,
};

// Every leg moved zero, but the native envelope carries a nonzero amount —
// regression for the `||` vs `??` defect: `selectPrimaryTransfer` still picks
// leg 0 (see its "every leg moved zero" branch), and that leg's own (zero)
// amount must be what's shown, not the native amount it would fall through to
// under `||`.
const DETAIL_ALL_ZERO_LEGS = {
  txHash: TX_HASH,
  from: SENDER,
  to: CONTRACT,
  chain: 'ethereum',
  amount: '1000000000000000000',
  timestamp: '2026-08-01T00:00:00.000Z',
  blockNumber: 12345,
  token: { address: '', symbol: 'ETH', decimals: 18 },
  tokenTransfers: [],
  transfers: [
    { standard: 'erc20', from: SENDER, to: RECEIVER, amount: '0', token: USDC, logIndex: 0 },
  ],
  isError: false,
};

const LEGACY_FROM = '0x7777777777777777777777777777777777777e';
const LEGACY_TO = '0x8888888888888888888888888888888888888e';

const DETAIL_LEGACY_FALLBACK = {
  txHash: TX_HASH,
  from: '0x9999999999999999999999999999999999999e',
  to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaae',
  chain: 'ethereum',
  amount: '0',
  timestamp: '2026-08-01T00:00:00.000Z',
  blockNumber: 12345,
  token: {},
  tokenTransfers: [
    { from: LEGACY_FROM, to: LEGACY_TO, amount: '5000000', token: USDC },
  ],
  transfers: [],
  isError: false,
};

async function pasteAndSubmit(text: string) {
  const input = screen.getByPlaceholderText('Paste address, tx hash, or URL');
  fireEvent.change(input, { target: { value: text } });
  // handleSubmit awaits the mocked getTransaction promise before updating state;
  // wrapping in act(async) flushes that microtask so the resulting state updates
  // (setValue/setLoading) aren't reported as unwrapped.
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('QuickAddInput transaction prefill', () => {
  it('prefers the decoded transfer leg the tx sender was party to over the native envelope', async () => {
    mockGetTransaction.mockResolvedValue(DETAIL_WITH_TRANSFERS);
    const onResolveTransaction = jest.fn();

    render(
      <QuickAddInput onResolveAddress={jest.fn()} onResolveTransaction={onResolveTransaction} />,
    );

    await pasteAndSubmit(TX_HASH);

    await waitFor(() => expect(onResolveTransaction).toHaveBeenCalled());
    const prefill = onResolveTransaction.mock.calls[0][0];

    // Selected leg is the 25 USDC transfer (index 1), not the 0-value native call.
    expect(prefill.from).toBe(SENDER);
    expect(prefill.to).toBe(RECEIVER);
    expect(prefill.amount).toBe('25000000');
    expect(prefill.token).toEqual(USDC);

    expect(prefill.transfers).toEqual(DETAIL_WITH_TRANSFERS.transfers);
    expect(prefill.selectedTransferIndex).toBe(1);
    expect(prefill.tokenStandard).toBe('erc20');
    expect(prefill.tokenId).toBeUndefined();
  });

  it('falls back to tokenTransfers then the native tx when transfers is empty', async () => {
    mockGetTransaction.mockResolvedValue(DETAIL_LEGACY_FALLBACK);
    const onResolveTransaction = jest.fn();

    render(
      <QuickAddInput onResolveAddress={jest.fn()} onResolveTransaction={onResolveTransaction} />,
    );

    await pasteAndSubmit(TX_HASH);

    await waitFor(() => expect(onResolveTransaction).toHaveBeenCalled());
    const prefill = onResolveTransaction.mock.calls[0][0];

    expect(prefill.from).toBe(LEGACY_FROM);
    expect(prefill.to).toBe(LEGACY_TO);
    expect(prefill.amount).toBe('5000000');
    expect(prefill.token).toEqual(USDC);

    expect(prefill.transfers).toBeUndefined();
    expect(prefill.selectedTransferIndex).toBeUndefined();
    expect(prefill.tokenStandard).toBeUndefined();
    expect(prefill.tokenId).toBeUndefined();
  });

  it('keeps a zero-value leg amount rather than falling back to the native envelope amount', async () => {
    mockGetTransaction.mockResolvedValue(DETAIL_ALL_ZERO_LEGS);
    const onResolveTransaction = jest.fn();

    render(
      <QuickAddInput onResolveAddress={jest.fn()} onResolveTransaction={onResolveTransaction} />,
    );

    await pasteAndSubmit(TX_HASH);

    await waitFor(() => expect(onResolveTransaction).toHaveBeenCalled());
    const prefill = onResolveTransaction.mock.calls[0][0];

    expect(prefill.selectedTransferIndex).toBe(0);
    expect(prefill.from).toBe(SENDER);
    expect(prefill.to).toBe(RECEIVER);
    expect(prefill.token).toEqual(USDC);
    // The leg's own zero amount, not the native tx's 1 ETH.
    expect(prefill.amount).toBe('0');
  });
});
