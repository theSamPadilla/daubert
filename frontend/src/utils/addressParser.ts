import { EVM_ADDRESS_RE, TRON_ADDRESS_RE, isBtcAddress, isSolanaAddress } from '../generated/shared/address';
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
  { host: 'solscan.io', chain: 'solana' },
  { host: 'explorer.solana.com', chain: 'solana' },
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
      // (base58 1.../3... or bech32 bc1...), and Solana paths: solscan.io/account/{addr},
      // explorer.solana.com/address/{addr} (base58, no prefix).
      //
      // The Solana alternative is listed BEFORE the BTC one — the reverse of the
      // raw-address checks below. Regex alternation doesn't backtrack across
      // alternatives once one matches at a position: with BTC first, its
      // `{24,33}` quantifier greedily consumes only 34 chars total of a longer
      // Solana address (e.g. a 43-char pubkey starting "1"/"3"), truncating it.
      // Putting Solana's `{32,44}` first consumes the whole address instead. This
      // is safe for genuine BTC addresses: a 32-34-char base58 string starting
      // "1"/"3" is captured identically by either alternative, since the Solana
      // shape has no prefix requirement and BTC's shape is fully inside it.
      const fullPath = url.pathname + url.hash;
      const addrMatch = fullPath.match(
        /\/(?:address|contract|account)\/(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|bc1[02-9ac-hj-np-z]{11,87}|[1-9A-HJ-NP-Za-km-z]{32,44}|[13][1-9A-HJ-NP-Za-km-z]{24,33})/,
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

  // Raw Solana address (base58, no prefix convention). Must be checked AFTER Bitcoin:
  // a 32-34-char base58 string starting with 1/3 matches both BTC's base58 shape and
  // Solana's unprefixed shape. BTC wins the overlap because a genuine Solana pubkey
  // that short would need ~5 leading zero bytes to base58-encode — astronomically rare
  // in practice — so short base58 1.../3... strings are treated as BTC, not Solana.
  if (isSolanaAddress(trimmed)) {
    return {
      address: trimmed,
      chain: 'solana',
      explorerUrl: buildExplorerUrl('solana', trimmed),
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
      // EVM: /tx/0x... — Tron: /#/transaction/... — Solana: /tx/{base58 signature, ~87-88 chars}
      const txMatch = fullPath.match(
        /\/(?:tx|transaction)\/(0x[0-9a-fA-F]{64}|[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{80,88})/,
      );
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
    if (/\/(?:address|contract|account)\//.test(fullPath)) return 'address';
    return 'unknown';
  } catch {
    // Not a URL — check raw patterns
  }

  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return 'transaction';
  // Bare 64-hex is itself valid base58, but stays classified as an (EVM-family) tx hash
  // here — this must be checked BEFORE the Solana signature length window below, and the
  // window itself (80-88) never overlaps 64, so this ordering is a belt-and-suspenders
  // regression guard, not load-bearing.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return 'transaction';
  if (EVM_ADDRESS_RE.test(trimmed)) return 'address';
  if (TRON_ADDRESS_RE.test(trimmed)) return 'address';
  if (isBtcAddress(trimmed)) return 'address';
  // Solana tx signatures are base58, ~87-88 chars (never overlaps the 32-44 address
  // window below), so a bare base58 string in that length band is a signature.
  if (/^[1-9A-HJ-NP-Za-km-z]{80,88}$/.test(trimmed)) return 'transaction';
  if (isSolanaAddress(trimmed)) return 'address';
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
  family: 'evm' | 'tron' | 'bitcoin' | 'solana' | 'unknown';
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
    } else if (chain === 'solana') {
      family = 'solana';
    } else if (chain) {
      family = 'evm';
    } else if (TRON_ADDRESS_RE.test(trimmed)) {
      family = 'tron';
    } else if (EVM_ADDRESS_RE.test(trimmed)) {
      family = 'evm';
    } else if (isBtcAddress(trimmed)) {
      family = 'bitcoin';
    } else if (isSolanaAddress(trimmed)) {
      family = 'solana';
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
    } else if (chain === 'solana') {
      family = 'solana';
    } else if (chain) {
      family = 'evm';
    } else if (/^0x[0-9a-fA-F]{64}$/.test(trimmed) || /^[0-9a-fA-F]{64}$/.test(trimmed)) {
      // Bare 64-hex is ambiguous (Tron txid vs EVM txid) and is NEVER inferred as
      // bitcoin or solana here — those tx families are only derived from an explorer
      // URL (chain branch above). Keep this fallback byte-identical to pre-BTC behavior.
      family = 'evm';
    } else if (/^[1-9A-HJ-NP-Za-km-z]{80,88}$/.test(trimmed)) {
      // Bare base58 signature, outside the 64-hex band above.
      family = 'solana';
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
