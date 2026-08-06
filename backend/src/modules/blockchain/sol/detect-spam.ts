import { HeliusParsedTx, HeliusTokenTransfer } from '../helius-client';

const MASS_DISTRIBUTION_MIN_RECIPIENTS = 10;

/**
 * Solana's three largest, most frequently spoofed mints. A transfer of one
 * of these is never flagged 'unknown-mint', regardless of whether upstream
 * mint-metadata resolution succeeded. Deliberately small and hand-verified
 * (never populate from an untrusted/derived source) -- additional majors
 * are added only with verified addresses, never from memory.
 */
export const KNOWN_MINTS: Record<string, true> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: true, // USDC
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: true, // USDT
  So11111111111111111111111111111111111111112: true, // wSOL
};

export interface SpamVerdict {
  spam: boolean;
  evidence: string[];
}

/**
 * Pure, court-facing spam detector for a single incoming SPL token
 * transfer within a Solana transaction. Only the three documented
 * heuristics below are applied -- no additional inference. Evidence
 * arrays are displayed to legal investigators verbatim, and every
 * heuristic that fired is listed regardless of whether the spam
 * threshold was met.
 *
 * Contract: callers invoke this only for incoming SPL token transfers
 * (`transfer.toUserAccount === address`, resolved elsewhere before this
 * call). Native SOL transfers and outgoing rows are skipped entirely by
 * the caller and never reach this function.
 *
 *  1. unsolicited: `transfer.toUserAccount === address`, `address` does
 *     not appear as `fromUserAccount` in any transfer of the tx (native
 *     or token), and `tx.feePayer !== address`. Someone who paid the fee
 *     or sent funds elsewhere in the same tx is a participant, not an
 *     unsolicited recipient.
 *  2. unknown-mint: `transfer.mint` is outside `KNOWN_MINTS` AND
 *     upstream mint-metadata resolution failed (`mintResolved` is
 *     false). A mint that resolved successfully -- even if it isn't one
 *     of the three hardcoded majors -- does not count as unknown.
 *  3. mass-distribution: the tx's `tokenTransfers` contains at least 10
 *     distinct non-null `toUserAccount` values, i.e. this transfer is
 *     part of a bulk airdrop to many holders.
 *
 * `spam` is true iff `unsolicited` AND (`unknown-mint` OR
 * `mass-distribution`) -- an unsolicited transfer of a known, resolved
 * mint to fewer than 10 recipients is not flagged.
 */
export function detectSpam(
  tx: HeliusParsedTx,
  transfer: HeliusTokenTransfer,
  address: string,
  mintResolved: boolean,
): SpamVerdict {
  const evidence: string[] = [];

  const sentElsewhere =
    tx.nativeTransfers.some((t) => t.fromUserAccount === address) ||
    tx.tokenTransfers.some((t) => t.fromUserAccount === address);
  const unsolicited =
    transfer.toUserAccount === address &&
    !sentElsewhere &&
    tx.feePayer !== address;
  if (unsolicited) evidence.push('unsolicited');

  const unknownMint = !KNOWN_MINTS[transfer.mint] && !mintResolved;
  if (unknownMint) evidence.push('unknown-mint');

  const distinctRecipients = new Set(
    tx.tokenTransfers
      .map((t) => t.toUserAccount)
      .filter((a): a is string => a !== null),
  );
  const massDistribution =
    distinctRecipients.size >= MASS_DISTRIBUTION_MIN_RECIPIENTS;
  if (massDistribution) evidence.push('mass-distribution');

  const spam = unsolicited && (unknownMint || massDistribution);

  return { spam, evidence };
}
