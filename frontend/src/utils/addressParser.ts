import { SUPPORTED_CHAINS } from '../services/types';

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
];

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export function parseAddressInput(input: string): ParsedAddress {
  const trimmed = input.trim();

  // Try URL parsing
  try {
    const url = new URL(trimmed);
    const match = EXPLORER_PATTERNS.find((p) => url.hostname === p.host || url.hostname === `www.${p.host}`);
    if (match) {
      // Extract address from path: /address/0x... or /#/address/T... or /#/contract/T...
      const fullPath = url.pathname + url.hash;
      const addrMatch = fullPath.match(/\/(?:address|contract)\/(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/);
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
  return 'unknown';
}

export function buildExplorerUrl(chain: string, address: string): string {
  const config = SUPPORTED_CHAINS[chain];
  if (!config) return '';
  if (chain === 'tron') {
    return `${config.explorerUrl}/#/address/${address}`;
  }
  return `${config.explorerUrl}/address/${address}`;
}

export function buildTxExplorerUrl(chain: string, txHash: string): string {
  const config = SUPPORTED_CHAINS[chain];
  if (!config || !txHash) return '';
  if (chain === 'tron') {
    return `${config.explorerUrl}/#/transaction/${txHash}`;
  }
  return `${config.explorerUrl}/tx/${txHash}`;
}
