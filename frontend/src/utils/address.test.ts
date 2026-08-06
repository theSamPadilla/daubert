import {
  ADDRESS_RE,
  BTC_BASE58_ADDRESS_RE,
  BTC_BECH32_ADDRESS_RE,
  SOLANA_ADDRESS_RE,
  isBtcAddress,
  isSolanaAddress,
  isValidAddress,
  validateAddressForChain,
  normalizeAddressForChain,
} from '../generated/shared/address';

// ── Fixtures ──────────────────────────────────────────────────────────────

const BTC_LEGACY = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // genesis block coinbase P2PKH
const BTC_P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const BTC_BECH32_V0 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BTC_BECH32_TAPROOT =
  'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';

const EVM_ADDR = '0x1234567890123456789012345678901234567890';
const TRON_ADDR = 'T123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 33 base58 chars after T

// Solana System Program id — 32 chars, well-known canonical address.
const SOLANA_WALLET = '11111111111111111111111111111111';
// USDC mint on Solana mainnet — 44 chars.
const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ── BTC_BASE58_ADDRESS_RE / BTC_BECH32_ADDRESS_RE / isBtcAddress ──────────

describe('BTC address regexes', () => {
  it('accepts legacy P2PKH and P2SH base58 addresses', () => {
    expect(BTC_BASE58_ADDRESS_RE.test(BTC_LEGACY)).toBe(true);
    expect(BTC_BASE58_ADDRESS_RE.test(BTC_P2SH)).toBe(true);
  });

  it('accepts segwit v0 and taproot bech32/bech32m addresses', () => {
    expect(BTC_BECH32_ADDRESS_RE.test(BTC_BECH32_V0)).toBe(true);
    expect(BTC_BECH32_ADDRESS_RE.test(BTC_BECH32_TAPROOT)).toBe(true);
  });

  it('rejects mixed-case and all-uppercase bech32 addresses', () => {
    const mixedCase = 'bc1QAR0SRRR7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const allCaps = 'BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ';
    expect(BTC_BECH32_ADDRESS_RE.test(mixedCase)).toBe(false);
    expect(BTC_BECH32_ADDRESS_RE.test(allCaps)).toBe(false);
    expect(isBtcAddress(mixedCase)).toBe(false);
    expect(isBtcAddress(allCaps)).toBe(false);
  });

  it('isBtcAddress accepts all four valid samples', () => {
    expect(isBtcAddress(BTC_LEGACY)).toBe(true);
    expect(isBtcAddress(BTC_P2SH)).toBe(true);
    expect(isBtcAddress(BTC_BECH32_V0)).toBe(true);
    expect(isBtcAddress(BTC_BECH32_TAPROOT)).toBe(true);
  });

  it('isBtcAddress rejects an EVM address', () => {
    expect(isBtcAddress(EVM_ADDR)).toBe(false);
  });
});

// ── SOLANA_ADDRESS_RE / isSolanaAddress ────────────────────────────────────

describe('SOLANA_ADDRESS_RE / isSolanaAddress', () => {
  it('accepts a 32-char wallet address and a 44-char mint address', () => {
    expect(SOLANA_ADDRESS_RE.test(SOLANA_WALLET)).toBe(true);
    expect(SOLANA_ADDRESS_RE.test(SOLANA_USDC_MINT)).toBe(true);
    expect(isSolanaAddress(SOLANA_WALLET)).toBe(true);
    expect(isSolanaAddress(SOLANA_USDC_MINT)).toBe(true);
  });

  it('rejects an EVM address', () => {
    expect(isSolanaAddress(EVM_ADDR)).toBe(false);
  });

  it('overlaps with the BTC legacy shape for short leading-"1" addresses (expected)', () => {
    // A 34-char base58 string starting with "1" or "3" matches both the BTC
    // legacy shape and the Solana shape. Auto-detection resolves BTC-first:
    // a genuine Solana pubkey this short needs ~5 leading zero bytes, which
    // is astronomically unlikely to occur by chance. Chain-explicit
    // validation (validateAddressForChain) is unaffected by the overlap.
    expect(BTC_BASE58_ADDRESS_RE.test(BTC_LEGACY)).toBe(true);
    expect(SOLANA_ADDRESS_RE.test(BTC_LEGACY)).toBe(true);
  });
});

// ── ADDRESS_RE ──────────────────────────────────────────────────────────

describe('ADDRESS_RE', () => {
  it('matches all four BTC samples plus EVM, Tron, and Solana samples', () => {
    const samples = [
      BTC_LEGACY,
      BTC_P2SH,
      BTC_BECH32_V0,
      BTC_BECH32_TAPROOT,
      EVM_ADDR,
      TRON_ADDR,
      SOLANA_WALLET,
      SOLANA_USDC_MINT,
    ];
    for (const sample of samples) {
      expect(ADDRESS_RE.test(sample)).toBe(true);
    }
  });

  it('rejects a mixed-case bech32 address', () => {
    expect(ADDRESS_RE.test('bc1QAR0SRRR7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(false);
  });
});

// ── isValidAddress ──────────────────────────────────────────────────────

describe('isValidAddress', () => {
  it('accepts BTC addresses', () => {
    expect(isValidAddress(BTC_LEGACY)).toBe(true);
    expect(isValidAddress(BTC_P2SH)).toBe(true);
    expect(isValidAddress(BTC_BECH32_V0)).toBe(true);
    expect(isValidAddress(BTC_BECH32_TAPROOT)).toBe(true);
  });

  it('still accepts EVM and Tron addresses (regression)', () => {
    expect(isValidAddress(EVM_ADDR)).toBe(true);
    expect(isValidAddress(TRON_ADDR)).toBe(true);
  });

  it('accepts Solana addresses', () => {
    expect(isValidAddress(SOLANA_WALLET)).toBe(true);
    expect(isValidAddress(SOLANA_USDC_MINT)).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidAddress('not-an-address')).toBe(false);
  });
});

// ── validateAddressForChain ─────────────────────────────────────────────

describe('validateAddressForChain — bitcoin', () => {
  it('accepts all four valid BTC samples', () => {
    expect(validateAddressForChain(BTC_LEGACY, 'bitcoin')).toBeNull();
    expect(validateAddressForChain(BTC_P2SH, 'bitcoin')).toBeNull();
    expect(validateAddressForChain(BTC_BECH32_V0, 'bitcoin')).toBeNull();
    expect(validateAddressForChain(BTC_BECH32_TAPROOT, 'bitcoin')).toBeNull();
  });

  it('rejects a mixed-case bech32 address for bitcoin', () => {
    const result = validateAddressForChain(
      'bc1QAR0SRRR7xfkvy5l643lydnw9re59gtzzwf5mdq',
      'bitcoin',
    );
    expect(result).toBe(
      'bitcoin requires a base58 (1…/3…) or bech32 (bc1…) address',
    );
  });

  it('rejects an all-caps bech32 address for bitcoin', () => {
    const result = validateAddressForChain(
      'BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ',
      'bitcoin',
    );
    expect(result).toBe(
      'bitcoin requires a base58 (1…/3…) or bech32 (bc1…) address',
    );
  });

  it('rejects an EVM address on chain bitcoin', () => {
    const result = validateAddressForChain(EVM_ADDR, 'bitcoin');
    expect(result).toBe(
      'bitcoin requires a base58 (1…/3…) or bech32 (bc1…) address',
    );
  });

  it('rejects a 44-char Solana-shaped base58 address on chain bitcoin', () => {
    // Too long for the BTC base58 shape (max 34 chars) even though it's a
    // valid Solana address.
    const result = validateAddressForChain(SOLANA_USDC_MINT, 'bitcoin');
    expect(result).toBe(
      'bitcoin requires a base58 (1…/3…) or bech32 (bc1…) address',
    );
  });
});

describe('validateAddressForChain — solana', () => {
  it('accepts a 32-char wallet address and a 44-char mint address', () => {
    expect(validateAddressForChain(SOLANA_WALLET, 'solana')).toBeNull();
    expect(validateAddressForChain(SOLANA_USDC_MINT, 'solana')).toBeNull();
  });

  it('rejects an EVM address on chain solana', () => {
    const result = validateAddressForChain(EVM_ADDR, 'solana');
    expect(result).toBe('solana requires a base58 address (32-44 chars)');
  });

  it('F9: rejects a Tron-shaped address (T + 33 base58 chars) even though it falls inside the 32-44 char window', () => {
    // TRON_ADDR is 34 chars total (T + 33), inside SOLANA_ADDRESS_RE's 32-44
    // window, and every character is valid base58 — shape overlap with a
    // genuine Solana pubkey. A Tron address must never validate as Solana.
    const result = validateAddressForChain(TRON_ADDR, 'solana');
    expect(result).toBe('solana requires a base58 address (32-44 chars)');
  });
});

describe('validateAddressForChain — regressions', () => {
  it('rejects a BTC address on chain ethereum', () => {
    const result = validateAddressForChain(BTC_LEGACY, 'ethereum');
    expect(result).toBe('ethereum requires an EVM address (0x + 40 hex)');
  });

  it('still accepts a valid EVM address on chain ethereum', () => {
    expect(validateAddressForChain(EVM_ADDR, 'ethereum')).toBeNull();
  });

  it('still accepts a valid Tron address on chain tron', () => {
    expect(validateAddressForChain(TRON_ADDR, 'tron')).toBeNull();
  });

  it('still rejects an unsupported chain', () => {
    expect(validateAddressForChain(EVM_ADDR, 'dogecoin')).toBe(
      'unsupported chain: dogecoin',
    );
  });
});

// ── normalizeAddressForChain ────────────────────────────────────────────

describe('normalizeAddressForChain', () => {
  it('lowercases EVM addresses', () => {
    expect(normalizeAddressForChain(` ${EVM_ADDR.toUpperCase()} `, 'ethereum')).toBe(
      EVM_ADDR.toLowerCase(),
    );
  });

  it('preserves Tron case (regression)', () => {
    expect(normalizeAddressForChain(` ${TRON_ADDR} `, 'tron')).toBe(TRON_ADDR);
  });

  it('preserves Bitcoin case', () => {
    expect(normalizeAddressForChain(` ${BTC_LEGACY} `, 'bitcoin')).toBe(BTC_LEGACY);
    expect(normalizeAddressForChain(` ${BTC_BECH32_V0} `, 'bitcoin')).toBe(
      BTC_BECH32_V0,
    );
  });

  it('preserves Solana case', () => {
    expect(normalizeAddressForChain(` ${SOLANA_USDC_MINT} `, 'solana')).toBe(
      SOLANA_USDC_MINT,
    );
  });
});
