import { EsploraTx } from '../esplora-client';
import { detectPatterns } from './detect-patterns';

const ROUND_VALUE_UNIT = 10_000;

export interface ChangeVerdict {
  index: number;
  change: boolean;
  evidence: string[];
}

/**
 * Pure, court-facing change-output detector for a single Bitcoin
 * transaction. Only the two documented heuristics below are applied --
 * no additional inference. Evidence arrays are displayed to legal
 * investigators verbatim.
 *
 *  1. address-reuse (certain): an output pays back to an address that
 *     also appears among this transaction's own input prevouts.
 *  2. script-type-match + non-round-value (probable, both fire
 *     together): every input spends from exactly one shared
 *     scriptpubkey_type, exactly one (non address-reuse) output matches
 *     that type while at least one other output uses a different type,
 *     and that matching output's value is non-round while at least one
 *     other output's value is round.
 *
 * Address-reuse takes precedence: an output that already resolved via
 * address-reuse is excluded from the script-type-match candidate pool,
 * and script-type-match's "exactly one matching output" is evaluated
 * only over outputs that didn't hit address-reuse.
 *
 * Guard: CoinJoin-style transactions (see detectPatterns) never get a
 * change guess here. With many equal-value outputs contributed by many
 * independent participants, any of these heuristics -- including
 * address-reuse -- could misattribute a stranger's output as change
 * back to one of the participants. Misattribution risk outweighs any
 * value the guess would add, so every output is reported change:false
 * whenever 'possible-coinjoin' is detected.
 *
 * OP_RETURN outputs (scriptpubkey_type === 'op_return', never carry an
 * address) are always change:false. This is guaranteed structurally by
 * the heuristics above (no address means address-reuse can't fire, and
 * no real prevout is ever of type 'op_return' so it can never be "the"
 * matching output) but is also enforced explicitly below as a
 * belt-and-suspenders guard, since this list is a documented contract.
 */
export function detectChange(tx: EsploraTx): ChangeVerdict[] {
  const verdicts: ChangeVerdict[] = tx.vout.map((_, index) => ({
    index,
    change: false,
    evidence: [],
  }));

  if (detectPatterns(tx).includes('possible-coinjoin')) {
    return verdicts;
  }

  const inputAddresses = new Set(
    tx.vin
      .map((v) => v.prevout?.scriptpubkey_address)
      .filter((address): address is string => address !== undefined),
  );

  const resolved = new Set<number>();

  tx.vout.forEach((out, index) => {
    if (out.scriptpubkey_type === 'op_return') return;
    if (
      out.scriptpubkey_address &&
      inputAddresses.has(out.scriptpubkey_address)
    ) {
      verdicts[index] = { index, change: true, evidence: ['address-reuse'] };
      resolved.add(index);
    }
  });

  const inputTypes = new Set(
    tx.vin
      .map((v) => v.prevout?.scriptpubkey_type)
      .filter((type): type is string => type !== undefined),
  );

  if (inputTypes.size === 1) {
    const [inputType] = inputTypes;
    const candidates = tx.vout
      .map((out, index) => ({ out, index }))
      .filter(({ index }) => !resolved.has(index));

    const matches = candidates.filter(
      ({ out }) => out.scriptpubkey_type === inputType,
    );
    const hasDifferentType = candidates.some(
      ({ out }) => out.scriptpubkey_type !== inputType,
    );

    if (matches.length === 1 && hasDifferentType) {
      const { out, index } = matches[0];
      if (out.scriptpubkey_type !== 'op_return') {
        const isRound = (value: number) => value % ROUND_VALUE_UNIT === 0;
        const matchIsNonRound = !isRound(out.value);
        const someOtherIsRound = candidates.some(
          ({ out: other, index: otherIndex }) =>
            otherIndex !== index && isRound(other.value),
        );

        if (matchIsNonRound && someOtherIsRound) {
          verdicts[index] = {
            index,
            change: true,
            evidence: ['script-type-match', 'non-round-value'],
          };
        }
      }
    }
  }

  return verdicts;
}
