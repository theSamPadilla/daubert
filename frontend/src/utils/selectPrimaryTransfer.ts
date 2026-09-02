import type { TransferLeg } from '@/types/investigation';

/**
 * Chooses which decoded transfer an edge should represent by default.
 *
 * Deterministic on purpose. The graph is an exhibit, so "why is this the edge
 * shown?" needs an answer that does not depend on a heuristic score: drop the
 * legs that moved nothing, prefer a leg the transaction's sender was actually
 * party to, otherwise take the earliest remaining by log order.
 *
 * Returns an index into `transfers`, or -1 when there are none.
 */
export function selectPrimaryTransfer(transfers: TransferLeg[], txSender?: string): number {
  if (transfers.length === 0) return -1;

  const nonZero = transfers
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => leg.amount !== '0');

  // Every leg moved zero: still show one rather than nothing.
  if (nonZero.length === 0) return 0;

  if (txSender) {
    const sender = txSender.toLowerCase();
    const partyToSender = nonZero.find(
      ({ leg }) => leg.from.toLowerCase() === sender || leg.to.toLowerCase() === sender,
    );
    if (partyToSender) return partyToSender.index;
  }

  return nonZero.reduce((best, current) =>
    current.leg.logIndex < best.leg.logIndex ? current : best,
  ).index;
}
