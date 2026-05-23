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

/** Any valid blockchain address (EVM or Tron). */
export const ADDRESS_RE = /^(?:0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})$/;

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
  return EVM_ADDRESS_RE.test(addr) || TRON_ADDRESS_RE.test(addr);
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
  return `unsupported chain: ${chain}`;
}

/** Lowercase for EVM (case-insensitive), preserve case for Tron base58. */
export function normalizeAddressForChain(addr: string, chain: string): string {
  const trimmed = addr.trim();
  return isEvmChain(chain) ? trimmed.toLowerCase() : trimmed;
}
