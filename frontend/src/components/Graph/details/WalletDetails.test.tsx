/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { WalletDetails } from './WalletDetails';
import type { WalletNode } from '@/types/investigation';
import type { AddressClassification } from '@/hooks/useAddressClassifications';

// ChainLabel pulls in @web3icons/react, an unrelated dependency this test
// doesn't need to exercise (and which may not be installed in every
// environment). Stub it out so the test only depends on what it's testing —
// the addressType/tokenStandard badges.
jest.mock('@/components/Graph/ChainIcon', () => ({
  ChainLabel: () => null,
}));

function wallet(overrides: Partial<WalletNode> = {}): WalletNode {
  return {
    id: 'w1',
    label: 'Hot Wallet',
    address: '0xabc123',
    chain: 'ethereum',
    notes: '',
    tags: [],
    position: { x: 0, y: 0 },
    parentTrace: 'trace-a',
    ...overrides,
  };
}

function classification(overrides: Partial<AddressClassification> = {}): AddressClassification {
  return {
    chain: 'ethereum',
    address: '0xabc123',
    addressType: 'contract',
    tokenStandard: null,
    symbol: null,
    decimals: null,
    name: null,
    probedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('WalletDetails — address type badge', () => {
  it("shows the lookup's classification over a stored 'unknown'", () => {
    const w = wallet({ addressType: 'unknown' });
    render(
      <WalletDetails
        wallet={w}
        onFetchHistory={jest.fn()}
        lookupAddress={() => undefined}
        lookupClassification={() => classification({ addressType: 'contract' })}
      />,
    );

    expect(screen.getByText('Contract')).toBeTruthy();
    expect(screen.queryByText('Unknown')).toBeNull();
  });

  it('falls back to the stored addressType when the lookup has nothing for this address', () => {
    const w = wallet({ addressType: 'wallet' });
    render(
      <WalletDetails
        wallet={w}
        onFetchHistory={jest.fn()}
        lookupAddress={() => undefined}
        lookupClassification={() => undefined}
      />,
    );

    expect(screen.getByText('Wallet')).toBeTruthy();
  });

  it('renders the token standard badge from the lookup', () => {
    const w = wallet({ addressType: 'unknown' });
    render(
      <WalletDetails
        wallet={w}
        onFetchHistory={jest.fn()}
        lookupAddress={() => undefined}
        lookupClassification={() => classification({ addressType: 'contract', tokenStandard: 'erc20' })}
      />,
    );

    expect(screen.getByText('ERC-20')).toBeTruthy();
  });
});
