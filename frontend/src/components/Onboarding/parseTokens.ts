import { inspectInput } from '@/utils/addressParser';

// A token that parses to a usable seed input (wallet address or transaction
// hash), with its resolved family.
export interface ParsedToken {
  raw: string;
  address: string;
  family: 'evm' | 'tron' | 'bitcoin' | 'solana' | 'unknown';
  isTxHash: boolean;
  valid: boolean;
}

export function parseTokens(input: string): ParsedToken[] {
  return input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((raw) => {
      const info = inspectInput(raw);
      if (info.kind === 'transaction') {
        return { raw, address: info.txHash ?? raw, family: info.family, isTxHash: true, valid: true };
      }
      if (info.kind === 'address' && info.family !== 'unknown') {
        return { raw, address: info.address ?? raw, family: info.family, isTxHash: false, valid: true };
      }
      return { raw, address: raw, family: 'unknown' as const, isTxHash: false, valid: false };
    });
}
