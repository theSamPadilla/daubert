import { CHAINS, CHAIN_IDS, explorerAddressUrl, explorerTxUrl } from '../generated/shared/chains';

describe('chains registry', () => {
  it('has exactly 6 chains with the expected ids', () => {
    expect(CHAIN_IDS.sort()).toEqual(
      ['arbitrum', 'base', 'bitcoin', 'ethereum', 'polygon', 'tron'].sort(),
    );
    expect(Object.keys(CHAINS).length).toBe(6);
  });

  it('has a bitcoin entry with family utxo, 8 decimals, case-sensitive addresses', () => {
    const btc = CHAINS.bitcoin;
    expect(btc).toBeDefined();
    expect(btc.family).toBe('utxo');
    expect(btc.nativeCurrency.decimals).toBe(8);
    expect(btc.caseSensitiveAddresses).toBe(true);
  });

  it('produces the hash-route form for tron address urls', () => {
    expect(explorerAddressUrl('tron', 'Txyz')).toBe('https://tronscan.org/#/address/Txyz');
  });

  it('produces the correct bitcoin tx url', () => {
    expect(explorerTxUrl('bitcoin', 'abc')).toBe('https://mempool.space/tx/abc');
  });

  it('returns empty string for an unknown chain', () => {
    expect(explorerAddressUrl('nonexistent', 'x')).toBe('');
  });
});
