import { TransactionEdge } from '@/types/investigation';

/**
 * Classification of a single Bitcoin fetch/staging row, derived purely from
 * its `utxo` provenance and the address the row was fetched for. Kept out of
 * JSX so FetchModal and StagingPanel can render identical badges without
 * duplicating the logic.
 *
 * Direction is implicit in the ledger row (see
 * backend/src/modules/blockchain/btc/map-btc-history.ts):
 *  - `from === fetchedAddress`            -> outgoing (`out`)
 *  - `from === to === fetchedAddress`     -> self-send (`self`)
 *  - `to === fetchedAddress` (and not from) -> incoming (`in`)
 * When `fetchedAddress` isn't available (e.g. a staged row with no fetch
 * context) neither comparison can match, and direction falls back to `in`;
 * callers without an address should simply not render the direction pill.
 */
export interface BtcRowClassification {
  direction: 'in' | 'out' | 'self';
  isChange: boolean;
  changeEvidence: string[];
  isJunction: boolean;
  inCount: number;
  outCount: number;
}

/**
 * Classifies a transaction row for BTC-specific display. Returns `null` for
 * non-BTC rows (no `utxo` field) so callers can render the existing EVM/Tron
 * UI unchanged.
 */
export function classifyBtcRow(
  tx: TransactionEdge,
  fetchedAddress: string,
): BtcRowClassification | null {
  const utxo = tx.utxo;
  if (!utxo) return null;

  const isFromAddr = !!fetchedAddress && tx.from === fetchedAddress;
  const isToAddr = !!fetchedAddress && tx.to === fetchedAddress;
  const direction: 'in' | 'out' | 'self' =
    isFromAddr && isToAddr ? 'self' : isFromAddr ? 'out' : 'in';

  const outputs = utxo.outputs ?? [];
  const ownOutput =
    utxo.vout != null ? outputs.find((o, i) => (o.index ?? i) === utxo.vout) : undefined;
  const isChange = !!ownOutput?.change;
  const changeEvidence = ownOutput?.changeEvidence ?? [];

  return {
    direction,
    isChange,
    changeEvidence,
    isJunction: !!utxo.junction,
    inCount: utxo.inputs?.length ?? 0,
    outCount: outputs.length,
  };
}
