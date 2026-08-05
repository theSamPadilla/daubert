import {
  parseAddressInput,
  parseTxInput,
  detectInputType,
  inspectInput,
  buildExplorerUrl,
  buildTxExplorerUrl,
} from './addressParser';

const HEX64 = 'a'.repeat(64);
const EVM_ADDR = '0x1234567890123456789012345678901234567890';
const TRON_ADDR = 'TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9';
const BTC_BECH32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BTC_P2PKH = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const BTC_P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';

describe('regression lock — behavior that must not change', () => {
  it('bare 64-hex string: parseTxInput returns just the hash, no chain/explorerUrl', () => {
    expect(parseTxInput(HEX64)).toEqual({ txHash: HEX64 });
  });

  it('bare 64-hex string: detectInputType is transaction', () => {
    expect(detectInputType(HEX64)).toBe('transaction');
  });

  it('bare 64-hex string: inspectInput is transaction/evm, no chain (NOT bitcoin)', () => {
    expect(inspectInput(HEX64)).toEqual({
      kind: 'transaction',
      family: 'evm',
      txHash: HEX64,
    });
  });

  it('bare 64-hex string: parseAddressInput treats it as unknown format', () => {
    expect(parseAddressInput(HEX64)).toEqual({ address: HEX64 });
  });

  it('EVM address paste is unaffected', () => {
    expect(parseAddressInput(EVM_ADDR)).toEqual({ address: EVM_ADDR });
    expect(inspectInput(EVM_ADDR)).toEqual({
      kind: 'address',
      family: 'evm',
      address: EVM_ADDR,
    });
  });

  it('Tron address paste is unaffected', () => {
    expect(parseAddressInput(TRON_ADDR)).toEqual({
      address: TRON_ADDR,
      chain: 'tron',
      explorerUrl: buildExplorerUrl('tron', TRON_ADDR),
    });
    expect(inspectInput(TRON_ADDR)).toEqual({
      kind: 'address',
      family: 'tron',
      chain: 'tron',
      address: TRON_ADDR,
      explorerUrl: buildExplorerUrl('tron', TRON_ADDR),
    });
  });

  it('etherscan address URL is unaffected', () => {
    const url = `https://etherscan.io/address/${EVM_ADDR}`;
    expect(parseAddressInput(url)).toEqual({
      address: EVM_ADDR,
      chain: 'ethereum',
      explorerUrl: url,
    });
  });

  it('tronscan address URL is unaffected', () => {
    const url = `https://tronscan.org/#/address/${TRON_ADDR}`;
    expect(parseAddressInput(url)).toEqual({
      address: TRON_ADDR,
      chain: 'tron',
      explorerUrl: url,
    });
  });
});

describe('bitcoin address support', () => {
  it.each([
    ['bech32', BTC_BECH32],
    ['P2PKH (genesis)', BTC_P2PKH],
    ['P2SH', BTC_P2SH],
  ])('parseAddressInput: %s address pastes to chain bitcoin with mempool.space explorer url', (_label, addr) => {
    expect(parseAddressInput(addr)).toEqual({
      address: addr,
      chain: 'bitcoin',
      explorerUrl: `https://mempool.space/address/${addr}`,
    });
  });

  it.each([
    ['bech32', BTC_BECH32],
    ['P2PKH (genesis)', BTC_P2PKH],
    ['P2SH', BTC_P2SH],
  ])('inspectInput: %s address paste has family bitcoin', (_label, addr) => {
    const result = inspectInput(addr);
    expect(result.kind).toBe('address');
    expect(result.family).toBe('bitcoin');
    expect(result.chain).toBe('bitcoin');
    expect(result.address).toBe(addr);
  });

  it('mempool.space address URL parses to chain bitcoin with the right address', () => {
    const url = `https://mempool.space/address/${BTC_BECH32}`;
    expect(parseAddressInput(url)).toEqual({
      address: BTC_BECH32,
      chain: 'bitcoin',
      explorerUrl: url,
    });
    const inspected = inspectInput(url);
    expect(inspected.kind).toBe('address');
    expect(inspected.family).toBe('bitcoin');
    expect(inspected.chain).toBe('bitcoin');
    expect(inspected.address).toBe(BTC_BECH32);
  });

  it('blockstream.info address URL parses to chain bitcoin with the right address', () => {
    const url = `https://blockstream.info/address/${BTC_P2PKH}`;
    expect(parseAddressInput(url)).toEqual({
      address: BTC_P2PKH,
      chain: 'bitcoin',
      explorerUrl: url,
    });
    const inspected = inspectInput(url);
    expect(inspected.kind).toBe('address');
    expect(inspected.family).toBe('bitcoin');
    expect(inspected.chain).toBe('bitcoin');
    expect(inspected.address).toBe(BTC_P2PKH);
  });
});

describe('bitcoin tx URL support', () => {
  it('mempool.space tx URL parses to kind transaction, family bitcoin, chain bitcoin', () => {
    const url = `https://mempool.space/tx/${HEX64}`;
    expect(parseTxInput(url)).toEqual({
      txHash: HEX64,
      chain: 'bitcoin',
      explorerUrl: url,
    });
    expect(detectInputType(url)).toBe('transaction');
    expect(inspectInput(url)).toEqual({
      kind: 'transaction',
      family: 'bitcoin',
      chain: 'bitcoin',
      txHash: HEX64,
      explorerUrl: url,
    });
  });

  it('blockstream.info tx URL parses to kind transaction, family bitcoin, chain bitcoin', () => {
    const url = `https://blockstream.info/tx/${HEX64}`;
    expect(parseTxInput(url)).toEqual({
      txHash: HEX64,
      chain: 'bitcoin',
      explorerUrl: url,
    });
    expect(detectInputType(url)).toBe('transaction');
    expect(inspectInput(url)).toEqual({
      kind: 'transaction',
      family: 'bitcoin',
      chain: 'bitcoin',
      txHash: HEX64,
      explorerUrl: url,
    });
  });

  it('buildTxExplorerUrl builds the bitcoin tx url', () => {
    expect(buildTxExplorerUrl('bitcoin', HEX64)).toBe(`https://mempool.space/tx/${HEX64}`);
  });
});
