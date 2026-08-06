import {
  CHAINS,
  CHAIN_IDS,
  explorerAddressUrl,
  explorerTxUrl,
  usesCursorPagination,
} from '../generated/shared/chains';

describe('chains registry', () => {
  it('has exactly 7 chains with the expected ids', () => {
    expect(CHAIN_IDS.sort()).toEqual(
      ['arbitrum', 'base', 'bitcoin', 'ethereum', 'polygon', 'solana', 'tron'].sort(),
    );
    expect(Object.keys(CHAINS).length).toBe(7);
  });

  it('has a bitcoin entry with family utxo, 8 decimals, case-sensitive addresses', () => {
    const btc = CHAINS.bitcoin;
    expect(btc).toBeDefined();
    expect(btc.family).toBe('utxo');
    expect(btc.nativeCurrency.decimals).toBe(8);
    expect(btc.caseSensitiveAddresses).toBe(true);
  });

  it('has a solana entry with family solana, 9 decimals, case-sensitive addresses', () => {
    const sol = CHAINS.solana;
    expect(sol).toBeDefined();
    expect(sol.family).toBe('solana');
    expect(sol.nativeCurrency).toEqual({ symbol: 'SOL', decimals: 9 });
    expect(sol.caseSensitiveAddresses).toBe(true);
  });

  it('produces the hash-route form for tron address urls', () => {
    expect(explorerAddressUrl('tron', 'Txyz')).toBe('https://tronscan.org/#/address/Txyz');
  });

  it('produces the correct bitcoin tx url', () => {
    expect(explorerTxUrl('bitcoin', 'abc')).toBe('https://mempool.space/tx/abc');
  });

  it('produces the correct solana explorer urls', () => {
    expect(explorerAddressUrl('solana', 'abc')).toBe('https://solscan.io/account/abc');
    expect(explorerTxUrl('solana', 'xyz')).toBe('https://solscan.io/tx/xyz');
  });

  it('returns empty string for an unknown chain', () => {
    expect(explorerAddressUrl('nonexistent', 'x')).toBe('');
  });
});

describe('usesCursorPagination', () => {
  it('is true for the cursor-paginated chains (bitcoin, solana)', () => {
    expect(usesCursorPagination('bitcoin')).toBe(true);
    expect(usesCursorPagination('solana')).toBe(true);
  });

  it('is false for block/page-paginated chains (ethereum, tron)', () => {
    expect(usesCursorPagination('ethereum')).toBe(false);
    expect(usesCursorPagination('tron')).toBe(false);
  });

  it('is false for an unknown chain', () => {
    expect(usesCursorPagination('nonexistent')).toBe(false);
  });
});
