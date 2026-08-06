import { TransactionEdge } from '@/types/investigation';

/**
 * Classification of a single Solana fetch/staging row, derived purely from
 * its `solana` provenance and the address the row was fetched for. Kept out
 * of JSX so FetchModal and StagingPanel can render identical badges without
 * duplicating the logic. Mirrors classifyBtcRow (see btcRowDisplay.ts).
 *
 * Direction:
 *  - `from === fetchedAddress`            -> outgoing (`out`)
 *  - `from === to === fetchedAddress`     -> self-send (`self`)
 *  - otherwise                            -> incoming (`in`)
 * When `fetchedAddress` isn't available (e.g. a staged row with no fetch
 * context) neither comparison can match, and direction falls back to `in`;
 * callers without an address should simply not render the direction pill.
 */
export interface SolanaRowClassification {
  direction: 'in' | 'out' | 'self';
  isSpam: boolean;
  evidence: string[];
}

/**
 * Classifies a transaction row for Solana-specific display. Returns `null`
 * for non-Solana rows (no `solana` field) so callers can render the existing
 * EVM/BTC UI unchanged.
 */
export function classifySolanaRow(
  tx: TransactionEdge,
  fetchedAddress: string,
): SolanaRowClassification | null {
  const solana = tx.solana;
  if (!solana) return null;

  // Solana addresses are case-sensitive (base58) — compare exactly, no normalization.
  const isFromAddr = !!fetchedAddress && tx.from === fetchedAddress;
  const isToAddr = !!fetchedAddress && tx.to === fetchedAddress;
  const direction: 'in' | 'out' | 'self' =
    isFromAddr && isToAddr ? 'self' : isFromAddr ? 'out' : 'in';

  return {
    direction,
    isSpam: solana.spam === true,
    evidence: solana.spamEvidence ?? [],
  };
}
