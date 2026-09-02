import { selectPrimaryTransfer } from './selectPrimaryTransfer';
import { TransferLeg } from '@/types/investigation';

/**
 * Legs mirror Polygon tx 0xb7a0ee5870a518ecf9784e447d536c3c4f17a4e7cc853d3d5c38f46e7cbcc1ef:
 * a relayer submits the tx, but every transfer runs between the payer, a router
 * contract, and the payee — the relayer (RELAYER) is party to none of them.
 */
const USDC = { address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', symbol: 'USDC', decimals: 6 };
const NFT = { address: '0x251be3a17af4892035c37ebf5890f4a4d889dcad', symbol: 'COURTYARD', decimals: 0 };

const PAYER = '0xc55fcca7133d58a934c0431fa14383b45b6c014e';
const ROUTER = '0x776023a4573bd972c4c3e2a76f611d3c2bef516e';
const PAYEE = '0x66dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const RELAYER = '0x9999999999999999999999999999999999999999';

function leg(overrides: Partial<TransferLeg> = {}): TransferLeg {
  return {
    standard: 'erc20',
    from: PAYER,
    to: ROUTER,
    amount: '25000000',
    token: USDC,
    logIndex: 1,
    ...overrides,
  };
}

// The 25 USDC payment: PAYER -> ROUTER.
const PAYMENT = leg({ from: PAYER, to: ROUTER, amount: '25000000', logIndex: 1 });
// The onward hop: ROUTER -> PAYEE.
const ONWARD_HOP = leg({ from: ROUTER, to: PAYEE, amount: '25000000', logIndex: 2 });
// A zero-value refund leg: ROUTER -> PAYER.
const REFUND = leg({ from: ROUTER, to: PAYER, amount: '0', logIndex: 3 });
// The ERC-721 mint: ZERO_ADDR -> PAYER.
const MINT = leg({
  standard: 'erc721',
  from: ZERO_ADDR,
  to: PAYER,
  amount: '1',
  token: NFT,
  tokenId: '4469282264829956043634515469381478210621183059247356743393779657588816520578',
  logIndex: 5,
});

describe('selectPrimaryTransfer', () => {
  it('never selects a zero-value leg', () => {
    expect(selectPrimaryTransfer([REFUND, PAYMENT])).toBe(1);
  });

  it('prefers a leg the transaction sender is party to over an earlier leg it is not party to', () => {
    // PAYEE is not party to PAYMENT (index 0), but is the recipient of ONWARD_HOP (index 1).
    expect(selectPrimaryTransfer([PAYMENT, ONWARD_HOP], PAYEE)).toBe(1);
  });

  it('falls back to the first non-zero leg by logIndex when the sender is party to nothing (the reported tx)', () => {
    expect(selectPrimaryTransfer([PAYMENT, ONWARD_HOP, REFUND, MINT], RELAYER)).toBe(0);
  });

  it('returns index 0 when every leg moved zero value, rather than -1', () => {
    const zeroOnly = [REFUND, leg({ from: PAYEE, to: PAYER, amount: '0', logIndex: 4 })];
    expect(selectPrimaryTransfer(zeroOnly)).toBe(0);
  });

  it('returns -1 for an empty array', () => {
    expect(selectPrimaryTransfer([])).toBe(-1);
  });

  it('matches the sender case-insensitively on both from and to', () => {
    const upperFrom = leg({ from: PAYER.toUpperCase(), to: ROUTER, amount: '25000000', logIndex: 1 });
    const upperTo = leg({ from: ROUTER, to: PAYEE.toUpperCase(), amount: '25000000', logIndex: 2 });
    expect(selectPrimaryTransfer([upperFrom, upperTo], PAYER)).toBe(0);
    expect(selectPrimaryTransfer([upperFrom, upperTo], PAYEE.toUpperCase())).toBe(1);
  });
});
