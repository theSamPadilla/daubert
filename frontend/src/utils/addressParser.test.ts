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
// 44-char base58 string of 'z' — not a BTC/Tron/EVM prefix and not a hex digit, so it can't
// collide with the BTC base58 ([13]-prefixed) or hex-64 alternatives in the shared regexes.
// Unambiguous Solana pubkey shape.
const SOLANA_ADDR = 'z'.repeat(44);
// 87-char base58 string of 'z' — inside the 80-88 signature length window, well outside the
// 32-44 address window, and (being non-hex) can't be partially consumed by the 64-hex
// alternative the way an all-digit base58 string could.
const SOLANA_SIG = 'z'.repeat(87);

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

describe('solana address support', () => {
  it('parseAddressInput: solana wallet address pastes to chain solana with solscan /account/ explorer url', () => {
    expect(parseAddressInput(SOLANA_ADDR)).toEqual({
      address: SOLANA_ADDR,
      chain: 'solana',
      explorerUrl: `https://solscan.io/account/${SOLANA_ADDR}`,
    });
  });

  it('inspectInput: solana wallet address paste has family solana', () => {
    const result = inspectInput(SOLANA_ADDR);
    expect(result.kind).toBe('address');
    expect(result.family).toBe('solana');
    expect(result.chain).toBe('solana');
    expect(result.address).toBe(SOLANA_ADDR);
  });

  it('precedence lock: a 33-34 char base58 string starting with 1 (BTC-shaped) still classifies bitcoin, not solana — a real Solana pubkey that short would need ~5 leading zero bytes, astronomically rare', () => {
    expect(parseAddressInput(BTC_P2PKH)).toEqual({
      address: BTC_P2PKH,
      chain: 'bitcoin',
      explorerUrl: buildExplorerUrl('bitcoin', BTC_P2PKH),
    });
    const inspected = inspectInput(BTC_P2PKH);
    expect(inspected.family).toBe('bitcoin');
    expect(inspected.chain).toBe('bitcoin');
  });

  it('solscan account URL parses to chain solana with the right address', () => {
    const url = `https://solscan.io/account/${SOLANA_ADDR}`;
    expect(parseAddressInput(url)).toEqual({
      address: SOLANA_ADDR,
      chain: 'solana',
      explorerUrl: url,
    });
    const inspected = inspectInput(url);
    expect(inspected.kind).toBe('address');
    expect(inspected.family).toBe('solana');
    expect(inspected.chain).toBe('solana');
    expect(inspected.address).toBe(SOLANA_ADDR);
  });

  it('explorer.solana.com address URL parses to chain solana with the right address', () => {
    const url = `https://explorer.solana.com/address/${SOLANA_ADDR}`;
    expect(parseAddressInput(url)).toEqual({
      address: SOLANA_ADDR,
      chain: 'solana',
      explorerUrl: url,
    });
    const inspected = inspectInput(url);
    expect(inspected.kind).toBe('address');
    expect(inspected.family).toBe('solana');
    expect(inspected.chain).toBe('solana');
    expect(inspected.address).toBe(SOLANA_ADDR);
  });

  it('F2: a solscan URL for a 43-char Solana address starting with "1" yields the FULL address, not truncated to 34 chars', () => {
    // The real Solana "incinerator" burn address — base58, starts with "1",
    // 43 chars. A [13]-prefixed BTC alternative earlier in the URL-extraction
    // regex would greedily consume only the first 34 chars.
    const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
    expect(INCINERATOR).toHaveLength(43);
    const url = `https://solscan.io/account/${INCINERATOR}`;

    const parsed = parseAddressInput(url);
    expect(parsed.address).toBe(INCINERATOR);
    expect(parsed.address).toHaveLength(43);
    expect(parsed.chain).toBe('solana');
  });

  it('F2: a solscan URL for a 44-char Solana address starting with "3" yields the FULL address, not truncated', () => {
    const addr = `3${'z'.repeat(43)}`;
    expect(addr).toHaveLength(44);
    const url = `https://solscan.io/account/${addr}`;

    const parsed = parseAddressInput(url);
    expect(parsed.address).toBe(addr);
    expect(parsed.address).toHaveLength(44);
    expect(parsed.chain).toBe('solana');
  });
});

describe('solana tx support', () => {
  it('solscan tx URL parses to kind transaction, family solana, chain solana', () => {
    const url = `https://solscan.io/tx/${SOLANA_SIG}`;
    expect(parseTxInput(url)).toEqual({
      txHash: SOLANA_SIG,
      chain: 'solana',
      explorerUrl: url,
    });
    expect(detectInputType(url)).toBe('transaction');
    expect(inspectInput(url)).toEqual({
      kind: 'transaction',
      family: 'solana',
      chain: 'solana',
      txHash: SOLANA_SIG,
      explorerUrl: url,
    });
  });

  it('explorer.solana.com tx URL parses to kind transaction, family solana, chain solana', () => {
    const url = `https://explorer.solana.com/tx/${SOLANA_SIG}`;
    expect(parseTxInput(url)).toEqual({
      txHash: SOLANA_SIG,
      chain: 'solana',
      explorerUrl: url,
    });
    expect(inspectInput(url)).toEqual({
      kind: 'transaction',
      family: 'solana',
      chain: 'solana',
      txHash: SOLANA_SIG,
      explorerUrl: url,
    });
  });

  it('bare 80-88 char base58 string classifies as a solana tx signature (family solana)', () => {
    expect(detectInputType(SOLANA_SIG)).toBe('transaction');
    const inspected = inspectInput(SOLANA_SIG);
    expect(inspected.kind).toBe('transaction');
    expect(inspected.family).toBe('solana');
    expect(inspected.txHash).toBe(SOLANA_SIG);
  });

  it('buildTxExplorerUrl builds the solana tx url', () => {
    expect(buildTxExplorerUrl('solana', SOLANA_SIG)).toBe(`https://solscan.io/tx/${SOLANA_SIG}`);
  });
});
