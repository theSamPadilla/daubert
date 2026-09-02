/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { TransferPicker } from './TransferPicker';
import type { TransferLeg } from '@/types/investigation';

// The three addresses the reported relayed USDC transaction actually routes
// between — none of them the pasted sender, which is the whole reason the
// picker exists.
const A = '0xc55fcca7a7c2d4b6a2c9c4f5e6d7a8b9c0d1e2f3';
const B = '0x776023a4f2e1d0c9b8a7968574635241302f1e0d';
const C = '0x66dbff2c1a0b9e8d7c6b5a4938271605f4e3d2c1';

const USDC = { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 };

function leg(overrides: Partial<TransferLeg> = {}): TransferLeg {
  return {
    standard: 'erc20',
    from: A,
    to: B,
    amount: '1500000',
    token: USDC,
    logIndex: 0,
    ...overrides,
  };
}

describe('TransferPicker', () => {
  it('renders one row per leg with symbol, amount and truncated endpoints', () => {
    const transfers = [
      leg({ logIndex: 0 }),
      leg({ from: B, to: C, amount: '2500000', logIndex: 1 }),
    ];
    render(<TransferPicker transfers={transfers} selectedIndex={0} onSelect={jest.fn()} />);

    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(2);

    expect(rows[0].textContent).toContain('ERC-20');
    expect(rows[0].textContent).toContain('1.5');
    expect(rows[0].textContent).toContain('USDC');
    expect(rows[0].textContent).toContain('0xc55f…e2f3');
    expect(rows[0].textContent).toContain('0x7760…1e0d');

    expect(rows[1].textContent).toContain('2.5');
    expect(rows[1].textContent).toContain('0x7760…1e0d');
    expect(rows[1].textContent).toContain('0x66db…d2c1');
  });

  it('marks the row at selectedIndex as active', () => {
    const transfers = [leg({ logIndex: 0 }), leg({ amount: '900000', logIndex: 1 })];
    render(<TransferPicker transfers={transfers} selectedIndex={1} onSelect={jest.fn()} />);

    const rows = screen.getAllByRole('button');
    expect(rows[0].getAttribute('aria-pressed')).toBe('false');
    expect(rows[1].getAttribute('aria-pressed')).toBe('true');
    expect(rows[1].className).toContain('bg-brand');
    expect(rows[0].className).not.toContain('bg-brand');
  });

  it('renders a zero-value leg with its zero amount and keeps it selectable', () => {
    const onSelect = jest.fn();
    const transfers = [
      leg({ logIndex: 0 }),
      leg({ from: B, to: C, amount: '0', logIndex: 1 }),
    ];
    render(<TransferPicker transfers={transfers} selectedIndex={0} onSelect={onSelect} />);

    const rows = screen.getAllByRole('button');
    expect(rows[1].textContent).toContain('0');
    expect(rows[1].textContent).toContain('USDC');
    expect((rows[1] as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("calls onSelect with the clicked leg's index", () => {
    const onSelect = jest.fn();
    const transfers = [
      leg({ logIndex: 0 }),
      leg({ from: B, to: C, amount: '2500000', logIndex: 1 }),
      leg({ from: C, to: A, amount: '3500000', logIndex: 2 }),
    ];
    render(<TransferPicker transfers={transfers} selectedIndex={0} onSelect={onSelect} />);

    fireEvent.click(screen.getAllByRole('button')[2]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('renders an ERC-721 leg token id rather than an amount', () => {
    const transfers = [
      leg({ logIndex: 0 }),
      leg({
        standard: 'erc721',
        from: B,
        to: C,
        amount: '7',
        tokenId: '4242',
        token: { address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', symbol: 'BAYC', decimals: 0 },
        logIndex: 1,
      }),
    ];
    render(<TransferPicker transfers={transfers} selectedIndex={0} onSelect={jest.fn()} />);

    const rows = screen.getAllByRole('button');
    expect(rows[1].textContent).toContain('ERC-721');
    expect(rows[1].textContent).toContain('#4242');
    expect(rows[1].textContent).not.toContain('7 BAYC');
  });

  it('renders nothing when transfers is undefined', () => {
    const { container } = render(<TransferPicker onSelect={jest.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a single-leg transaction (no choice to offer)', () => {
    const { container } = render(
      <TransferPicker transfers={[leg()]} selectedIndex={0} onSelect={jest.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
