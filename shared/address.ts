// Single source of truth for blockchain address validation.
// Imported by both backend (class-validator decorators, runtime checks) and
// frontend (manual entry, URL parsing). Keep additions chain-agnostic and
// runtime-only — no Node or browser globals.

/** EVM address: `0x` + 40 hex characters. Case-insensitive on hex. */
export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Tron base58 address: `T` + 33 characters from the strict base58 alphabet
 * (excludes `0`, `O`, `I`, `l` to avoid ambiguity).
 */
export const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** Bitcoin legacy base58 (P2PKH `1...`, P2SH `3...`). Case-sensitive. */
export const BTC_BASE58_ADDRESS_RE = /^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/;
/** Bitcoin bech32/bech32m (`bc1q...` segwit v0, `bc1p...` taproot). Lowercase only per BIP-173. */
export const BTC_BECH32_ADDRESS_RE = /^bc1[02-9ac-hj-np-z]{11,87}$/;
export function isBtcAddress(addr: string): boolean {
  return BTC_BASE58_ADDRESS_RE.test(addr) || BTC_BECH32_ADDRESS_RE.test(addr);
}

/** Solana base58-encoded 32-byte pubkey. No prefix — see the ambiguity note on ADDRESS_RE. Case-sensitive. */
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isSolanaAddress(addr: string): boolean {
  return SOLANA_ADDRESS_RE.test(addr);
}

/**
 * Solana System Program — the zero pubkey (32 zero bytes → 32 base58 '1's).
 * The one well-known Solana address that collides with the Bitcoin legacy
 * base58 shape; validateAddressForChain exempts it from BTC-first overlap
 * resolution. (Other reserved addresses like the incinerator are 42+ chars,
 * outside Bitcoin's 25-34 char window.)
 */
export const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111';

/**
 * Any valid blockchain address (EVM, Tron, Bitcoin, or Solana).
 *
 * The prefixes are no longer mutually exclusive: a 32-34 char base58 string
 * starting with `1` or `3` matches both the BTC base58 shape and the Solana
 * shape (Solana has no prefix convention — see SOLANA_ADDRESS_RE). This is
 * intentional and harmless. Auto-detection (isValidAddress, address parsing)
 * resolves such overlaps BTC-first, because a genuine Solana pubkey that
 * short would need roughly 5 leading zero bytes to base58-encode into so few
 * characters — astronomically rare in practice. Chain-explicit validation
 * (validateAddressForChain) applies the same BTC-first policy: a BTC-shaped
 * address passed with chain 'solana' is rejected with a corrective message,
 * mirroring the existing Tron-shape rejection.
 */
export const ADDRESS_RE =
  /^(?:0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[13][1-9A-HJ-NP-Za-km-z]{24,33}|bc1[02-9ac-hj-np-z]{11,87}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

/** EVM chain keys supported by the platform. */
export const EVM_CHAINS = ['ethereum', 'polygon', 'arbitrum', 'base'] as const;
export type EvmChain = typeof EVM_CHAINS[number];

export function isEvmChain(chain: string): chain is EvmChain {
  return (EVM_CHAINS as readonly string[]).includes(chain);
}

export function isEvmAddress(addr: string): boolean {
  return EVM_ADDRESS_RE.test(addr);
}

export function isTronAddress(addr: string): boolean {
  return TRON_ADDRESS_RE.test(addr);
}

export function isValidAddress(addr: string): boolean {
  return (
    EVM_ADDRESS_RE.test(addr) ||
    TRON_ADDRESS_RE.test(addr) ||
    isBtcAddress(addr) ||
    isSolanaAddress(addr)
  );
}

/**
 * Validate that an address's shape matches the expected chain.
 * Returns null on success, or a human-readable error message describing the mismatch.
 */
export function validateAddressForChain(addr: string, chain: string): string | null {
  if (isEvmChain(chain)) {
    if (!isEvmAddress(addr)) {
      return `${chain} requires an EVM address (0x + 40 hex)`;
    }
    return null;
  }
  if (chain === 'tron') {
    if (!isTronAddress(addr)) {
      return 'tron requires a base58 address starting with T';
    }
    return null;
  }
  if (chain === 'bitcoin') {
    if (!isBtcAddress(addr)) {
      return 'bitcoin requires a base58 (1…/3…) or bech32 (bc1…) address';
    }
    return null;
  }
  if (chain === 'solana') {
    // Tron (T + 33 base58 chars = 34 total) and legacy Bitcoin (1…/3…,
    // 25-34 chars) addresses both fall inside Solana's 32-44 char base58
    // window with every character valid base58 — the shapes overlap. Reject
    // both explicitly, with a corrective message naming the likely chain: a
    // genuine Solana pubkey short enough to collide with either shape would
    // need several leading zero bytes, astronomically rare in practice.
    // (Bech32 bc1… fails the base58 charset anyway, but gets the same
    // corrective Bitcoin message rather than the generic one.)
    if (isTronAddress(addr)) {
      return 'this address matches the Tron shape (T + 33 base58 chars) — use chain "tron", not "solana"';
    }
    if (addr !== SOLANA_SYSTEM_PROGRAM && isBtcAddress(addr)) {
      return 'this address matches a Bitcoin shape (legacy 1…/3… base58 or bech32 bc1…) — use chain "bitcoin", not "solana"';
    }
    if (!isSolanaAddress(addr)) {
      return 'solana requires a base58 address (32-44 chars)';
    }
    return null;
  }
  return `unsupported chain: ${chain}`;
}

/** Lowercase for EVM (case-insensitive), preserve case for Tron base58 and Bitcoin. */
export function normalizeAddressForChain(addr: string, chain: string): string {
  const trimmed = addr.trim();
  return isEvmChain(chain) ? trimmed.toLowerCase() : trimmed;
}
