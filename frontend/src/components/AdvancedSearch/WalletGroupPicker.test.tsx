/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { WalletGroupPicker } from './WalletGroupPicker';
import type { Investigation, Trace, WalletNode } from '../../types/investigation';

// WalletGroupPicker calls useLabeledEntities() (network-backed cache) — stub it
// out, same convention as the api-client mocks in useWalletTransactionAuthoring.test.ts.
jest.mock('@/hooks/useLabeledEntities', () => ({
  useLabeledEntities: () => ({ lookupAddress: () => undefined }),
}));

function wallet(id: string, overrides: Partial<WalletNode> = {}): WalletNode {
  return {
    id,
    label: id,
    address: `addr-${id}`,
    chain: 'bitcoin',
    notes: '',
    tags: [],
    position: { x: 0, y: 0 },
    parentTrace: 'trace-1',
    ...overrides,
  };
}

function makeInvestigation(nodes: WalletNode[]): Investigation {
  const trace: Trace = {
    id: 'trace-1',
    name: 'Trace 1',
    criteria: { type: 'custom' },
    visible: true,
    nodes,
    edges: [],
    collapsed: false,
    position: { x: 0, y: 0 },
  };
  return {
    id: 'inv-1',
    name: 'Test',
    description: '',
    createdAt: '2024-01-01',
    traces: [trace],
    metadata: {},
  };
}

describe('WalletGroupPicker — junction exclusion', () => {
  it('does not offer txJunction nodes as selectable wallets', () => {
    const w = wallet('w1', {
      label: 'bc1q2w…xuxr',
      address: 'bc1q2w9xxf9wf7cvgepsxp83qg9x0a7fcfyx9mxuxr',
    });
    const junction = wallet('j1', {
      label: '40 in / 1 out',
      address: 'c4b2c45d8f73085da8b6b9d37d29dd304d344a4dca58a2ceaa6e1e5356031db8',
      kind: 'txJunction',
    });
    const inv = makeInvestigation([w, junction]);

    // value={} → picker opens in "By wallets" mode (the vulnerable path)
    render(
      <WalletGroupPicker
        label="SIDE A"
        investigation={inv}
        chain="bitcoin"
        value={{}}
        onChange={() => {}}
      />
    );

    // The real wallet is offered…
    expect(screen.getByText('bc1q2w…xuxr')).toBeTruthy();
    // …the junction is not — neither by label nor by (truncated) txid.
    expect(screen.queryByText('40 in / 1 out')).toBeNull();
    expect(screen.queryByText(/c4b2c4/)).toBeNull();
  });

  it('still offers explicit kind:"wallet" nodes (only txJunction is excluded)', () => {
    const w = wallet('w1', { label: 'bc1qzp…e8ac', kind: 'wallet' });
    render(
      <WalletGroupPicker
        label="SIDE A"
        investigation={makeInvestigation([w])}
        chain="bitcoin"
        value={{}}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('bc1qzp…e8ac')).toBeTruthy();
  });
});
