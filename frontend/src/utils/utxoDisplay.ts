import { formatTokenAmount } from './formatAmount';

/**
 * Pure display-mapping helpers for Bitcoin UTXO detail panels
 * (TxJunctionDetails, TransactionDetails, UtxoBreakdown). Kept out of JSX so
 * the enum -> human-label mappings are unit-testable without mounting a
 * component. Enum values come from `UtxoContext`
 * (frontend/src/types/investigation.ts) — see backend/src/modules/blockchain/
 * btc/detect-patterns.ts and detect-change.ts for where they're produced.
 */

const WARNING_LABELS: Record<string, string> = {
  'possible-coinjoin': 'Possible CoinJoin',
  consolidation: 'Consolidation',
  'multi-input': 'Multi-input',
  coinbase: 'Coinbase',
};

/** Human label for a UtxoContext warning string. Unknown values pass through unchanged. */
export function warningLabel(w: string): string {
  return WARNING_LABELS[w] ?? w;
}

const EVIDENCE_LABELS: Record<string, string> = {
  'address-reuse': 'address reuse',
  'script-type-match': 'script-type match',
  'non-round-value': 'non-round value',
};

/** Human label for a change-output evidence string. Unknown values pass through unchanged. */
export function evidenceLabel(e: string): string {
  return EVIDENCE_LABELS[e] ?? e;
}

/**
 * Tooltip text for a "change?" badge: a comma-joined list of human evidence
 * labels, or a generic fallback when the source didn't record any.
 */
export function evidenceTitle(evidence: string[] | undefined | null): string {
  if (!evidence || evidence.length === 0) return 'Change output';
  return evidence.map(evidenceLabel).join(', ');
}

/** BTC-formatted satoshi value, e.g. formatBtcValue('5000') -> '0.00005 BTC'. */
export function formatBtcValue(sats: string | undefined | null): string {
  return `${formatTokenAmount(sats ?? '0', 8)} BTC`;
}

/**
 * Human summary of a transaction's confirmation state, e.g. "Confirmed ·
 * Block 820,123", "Unconfirmed", or "Block 820,123" when confirmed is
 * unknown but a height is present. Returns '' when there's nothing to show.
 */
export function confirmationLabel(
  confirmed: boolean | undefined,
  blockHeight: number | null | undefined,
): string {
  const parts: string[] = [];
  if (confirmed === true) parts.push('Confirmed');
  else if (confirmed === false) parts.push('Unconfirmed');
  if (blockHeight != null) parts.push(`Block ${blockHeight.toLocaleString()}`);
  return parts.join(' · ');
}

/**
 * Middle-truncate a long hex string (address/txid) for compact table
 * display: 'bc1qspender1longaddress...' -> 'bc1qsp…dress'. Returns the
 * input unchanged when it's already short enough or empty.
 */
export function truncateMiddle(value: string | undefined | null, front = 6, back = 4): string {
  if (!value) return value ?? '';
  if (value.length <= front + back + 1) return value;
  return `${value.slice(0, front)}…${value.slice(-back)}`;
}
