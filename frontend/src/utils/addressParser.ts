import { EVM_ADDRESS_RE, TRON_ADDRESS_RE, isBtcAddress } from '../generated/shared/address';
import { explorerAddressUrl, explorerTxUrl } from '../generated/shared/chains';

interface ParsedAddress {
  address: string;
  chain?: string;
  explorerUrl?: string;
}

const EXPLORER_PATTERNS: { host: string; chain: string }[] = [
  { host: 'etherscan.io', chain: 'ethereum' },
  { host: 'polygonscan.com', chain: 'polygon' },
  { host: 'arbiscan.io', chain: 'arbitrum' },
  { host: 'basescan.org', chain: 'base' },
  { host: 'tronscan.org', chain: 'tron' },
  { host: 'tronscan.io', chain: 'tron' },
  { host: 'mempool.space', chain: 'bitcoin' },
  { host: 'blockstream.info', chain: 'bitcoin' },
];

export function parseAddressInput(input: string): ParsedAddress {
  const trimmed = input.trim();

  // Try URL parsing
  try {
    const url = new URL(trimmed);
    const match = EXPLORER_PATTERNS.find((p) => url.hostname === p.host || url.hostname === `www.${p.host}`);
    if (match) {
      // Extract address from path: /address/0x... or /#/address/T... or /#/contract/T...
      // Also matches BTC paths: mempool.space/address/{addr}, blockstream.info/address/{addr}
      // (base58 1.../3... or bech32 bc1...).
      const fullPath = url.pathname + url.hash;
      const addrMatch = fullPath.match(
        /\/(?:address|contract)\/(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{24,33})/,
      );
      if (addrMatch) {
        const address = addrMatch[1];
        return {
          address,
          chain: match.chain,
          explorerUrl: trimmed,
        };
      }
    }
  } catch {
    // Not a URL, continue
  }

  // Raw Tron address
  if (TRON_ADDRESS_RE.test(trimmed)) {
    return {
      address: trimmed,
      chain: 'tron',
      explorerUrl: buildExplorerUrl('tron', trimmed),
    };
  }

  // Raw EVM address
  if (EVM_ADDRESS_RE.test(trimmed)) {
    return {
      address: trimmed,
      // chain left undefined — user picks, default ethereum
    };
  }

  // Raw Bitcoin address (base58 or bech32)
  if (isBtcAddress(trimmed)) {
    return {
      address: trimmed,
      chain: 'bitcoin',
      explorerUrl: buildExplorerUrl('bitcoin', trimmed),
    };
  }

  // Unknown format
  return { address: trimmed };
}

export interface ParsedTxInput {
  txHash: string;
  chain?: string;
  explorerUrl?: string;
}

export function parseTxInput(input: string): ParsedTxInput {
  const trimmed = input.trim();

  // Try URL parsing
  try {
    const url = new URL(trimmed);
    const match = EXPLORER_PATTERNS.find((p) => url.hostname === p.host || url.hostname === `www.${p.host}`);
    if (match) {
      const fullPath = url.pathname + url.hash;
      // EVM: /tx/0x... — Tron: /#/transaction/...
      const txMatch = fullPath.match(/\/(?:tx|transaction)\/(0x[0-9a-fA-F]{64}|[0-9a-fA-F]{64})/);
      if (txMatch) {
        const hash = txMatch[1].startsWith('0x') ? txMatch[1] : txMatch[1];
        return { txHash: hash, chain: match.chain, explorerUrl: trimmed };
      }
    }
  } catch {
    // Not a URL
  }

  // Raw EVM tx hash
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { txHash: trimmed };
  }

  // Raw hex hash (no 0x prefix, 64 chars — could be tron)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { txHash: trimmed };
  }

  return { txHash: trimmed };
}

/** Detect whether an input looks like a tx URL/hash vs an address URL/address */
export function detectInputType(input: string): 'address' | 'transaction' | 'unknown' {
  const trimmed = input.trim();
  if (!trimmed) return 'unknown';

  try {
    const url = new URL(trimmed);
    const fullPath = url.pathname + url.hash;
    if (/\/(?:tx|transaction)\//.test(fullPath)) return 'transaction';
    if (/\/(?:address|contract)\//.test(fullPath)) return 'address';
    return 'unknown';
  } catch {
    // Not a URL — check raw patterns
  }

  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return 'transaction';
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return 'transaction';
  if (EVM_ADDRESS_RE.test(trimmed)) return 'address';
  if (TRON_ADDRESS_RE.test(trimmed)) return 'address';
  if (isBtcAddress(trimmed)) return 'address';
  return 'unknown';
}

export function buildExplorerUrl(chain: string, address: string): string {
  return explorerAddressUrl(chain, address);
}

export function buildTxExplorerUrl(chain: string, txHash: string): string {
  if (!txHash) return '';
  return explorerTxUrl(chain, txHash);
}

export interface InspectedInput {
  kind: 'address' | 'transaction' | 'unknown';
  family: 'evm' | 'tron' | 'bitcoin' | 'unknown';
  chain?: string;        // exact chain id when derivable (URL host or Tron prefix); undefined for ambiguous EVM
  address?: string;      // populated when kind === 'address'
  txHash?: string;       // populated when kind === 'transaction'
  explorerUrl?: string;  // populated when input was a URL
}

// Canonical entry point for "what is this input?" queries. parseAddressInput/parseTxInput/detectInputType are kept for legacy parse-on-edit callers (e.g., WalletForm.handleAddressChange).
export function inspectInput(input: string): InspectedInput {
  const kind = detectInputType(input);
  const trimmed = input.trim();

  if (kind === 'address') {
    const parsed = parseAddressInput(input);
    const chain = parsed.chain;
    let family: InspectedInput['family'];
    if (chain === 'tron') {
      family = 'tron';
    } else if (chain === 'bitcoin') {
      family = 'bitcoin';
    } else if (chain) {
      family = 'evm';
    } else if (TRON_ADDRESS_RE.test(trimmed)) {
      family = 'tron';
    } else if (EVM_ADDRESS_RE.test(trimmed)) {
      family = 'evm';
    } else if (isBtcAddress(trimmed)) {
      family = 'bitcoin';
    } else {
      family = 'unknown';
    }
    return {
      kind,
      family,
      chain,
      address: parsed.address,
      explorerUrl: parsed.explorerUrl,
    };
  }

  if (kind === 'transaction') {
    const parsed = parseTxInput(input);
    const chain = parsed.chain;
    let family: InspectedInput['family'];
    if (chain === 'tron') {
      family = 'tron';
    } else if (chain === 'bitcoin') {
      family = 'bitcoin';
    } else if (chain) {
      family = 'evm';
    } else if (/^0x[0-9a-fA-F]{64}$/.test(trimmed) || /^[0-9a-fA-F]{64}$/.test(trimmed)) {
      // Bare 64-hex is ambiguous (Tron txid vs EVM txid) and is NEVER inferred as
      // bitcoin here — bitcoin tx family is only derived from an explorer URL
      // (chain branch above). Keep this fallback byte-identical to pre-BTC behavior.
      family = 'evm';
    } else {
      family = 'unknown';
    }
    return {
      kind,
      family,
      chain,
      txHash: parsed.txHash,
      explorerUrl: parsed.explorerUrl,
    };
  }

  // kind === 'unknown'
  return { kind: 'unknown', family: 'unknown' };
}
