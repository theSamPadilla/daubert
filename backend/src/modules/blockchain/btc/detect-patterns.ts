import { EsploraTx } from '../esplora-client';

const COINJOIN_MIN_INPUTS = 5;
const COINJOIN_MIN_OUTPUTS = 5;
const COINJOIN_MIN_SHARED_VALUE_COUNT = 3;
const CONSOLIDATION_MIN_INPUTS = 5;
const CONSOLIDATION_MAX_OUTPUTS = 2;

/**
 * Pure, court-facing pattern detector for a single Bitcoin transaction.
 * No heuristics beyond what's documented below -- these labels are shown
 * to legal investigators verbatim.
 *
 * - 'coinbase': tx.vin[0].is_coinbase is true. A coinbase tx is reported
 *   as ['coinbase'] ONLY -- no other pattern is evaluated or appended,
 *   since coinbase txs don't have real inputs to reason about.
 * - 'possible-coinjoin': >=5 inputs AND >=5 outputs AND at least 3
 *   outputs share one exact value.
 * - 'consolidation': >=5 inputs AND <=2 outputs.
 * - 'multi-input' (informational): more than 1 input.
 *
 * Return order is fixed and part of the public contract:
 * coinjoin, consolidation, multi-input.
 */
export function detectPatterns(tx: EsploraTx): string[] {
  if (tx.vin[0]?.is_coinbase) {
    return ['coinbase'];
  }

  const patterns: string[] = [];

  if (
    tx.vin.length >= COINJOIN_MIN_INPUTS &&
    tx.vout.length >= COINJOIN_MIN_OUTPUTS
  ) {
    const valueCounts = new Map<number, number>();
    for (const out of tx.vout) {
      valueCounts.set(out.value, (valueCounts.get(out.value) ?? 0) + 1);
    }
    const hasSharedValue = [...valueCounts.values()].some(
      (count) => count >= COINJOIN_MIN_SHARED_VALUE_COUNT,
    );
    if (hasSharedValue) {
      patterns.push('possible-coinjoin');
    }
  }

  if (
    tx.vin.length >= CONSOLIDATION_MIN_INPUTS &&
    tx.vout.length <= CONSOLIDATION_MAX_OUTPUTS
  ) {
    patterns.push('consolidation');
  }

  if (tx.vin.length > 1) {
    patterns.push('multi-input');
  }

  return patterns;
}
