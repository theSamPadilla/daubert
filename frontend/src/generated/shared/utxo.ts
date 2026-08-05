// shared/utxo.ts — junction planning for BTC transactions with high fan-in/fan-out.
//
// A Bitcoin transaction with N inputs and M outputs cannot be drawn as a single
// address→address edge without inventing a sender. When a row is flagged
// `junction`, the graph instead materializes ONE node standing for the
// transaction itself, with one leg edge per real participant.
//
// This module is pure and dependency-free on purpose: it is the single source
// of truth shared by the backend import path and the frontend staging path, so
// both produce identical junction topology — and therefore identical
// `edgeIdentityKey`s, so a graph authored in the browser dedups against one
// built by a server-side import.
//
// It never mutates the context it is handed: a fetched row's `inputs`/`outputs`
// arrays are SHARED BY REFERENCE across every sibling row of the same
// transaction, so mutating one would corrupt all the others.

/**
 * Structural view of one transaction input or output.
 *
 * Declared locally rather than imported: `shared/` is copied verbatim into both
 * packages and cannot reach backend types. `UtxoInput`/`UtxoOutput` in
 * `backend/src/modules/blockchain/types.ts` are structurally assignable to it.
 */
export interface UtxoIoLike {
  /** null when the script carries no decodable address (bare scripts, coinbase, OP_RETURN). */
  address: string | null;
  /** Satoshis, as a decimal string. */
  value: string;
  /** Output index (`vout`). Absent on inputs. */
  index?: number;
  change?: boolean;
  coinbase?: boolean;
  opReturn?: boolean;
}

export interface UtxoContextLike {
  inputs: UtxoIoLike[];
  outputs: UtxoIoLike[];
  /** Satoshis, as a decimal string. */
  fee: string;
  warnings?: string[];
  confirmed?: boolean;
  blockHeight?: number | null;
}

export interface JunctionPlan {
  node: { address: string; label: string; kind: 'txJunction' };
  inputLegs: { fromAddress: string; amountSats: string; legIndex: number }[];
  outputLegs: { toAddress: string; amountSats: string; vout: number; change?: boolean }[];
}

/**
 * Plan the node + leg edges for one junction-flagged Bitcoin transaction.
 *
 * The junction node's address is the txid: a transaction hash is globally
 * unique and lowercase hex, which makes it a safe key in the case-insensitive
 * address maps the import path already maintains, and makes re-importing the
 * same transaction idempotent.
 */
export function planJunction(txHash: string, utxo: UtxoContextLike): JunctionPlan {
  const inputs = utxo.inputs ?? [];
  const outputs = utxo.outputs ?? [];

  const inputLegs: JunctionPlan['inputLegs'] = [];
  inputs.forEach((input, i) => {
    // Coinbase inputs spend nothing that existed before — there is no sender to
    // draw. Null-address inputs are scripts we cannot attribute; inventing a
    // node for them would assert provenance the chain does not record.
    if (input.coinbase === true) return;
    if (input.address == null || input.address === '') return;
    inputLegs.push({
      fromAddress: input.address,
      amountSats: input.value,
      // The ORIGINAL array index, not the filtered one: `${txid}:in:${legIndex}`
      // is this leg's identity, and it has to stay stable across imports even
      // when earlier inputs are skipped.
      legIndex: i,
    });
  });

  const outputLegs: JunctionPlan['outputLegs'] = [];
  outputs.forEach((output, i) => {
    // OP_RETURN is a data carrier, not a payment — no recipient exists.
    if (output.opReturn === true) return;
    if (output.address == null || output.address === '') return;
    const leg: JunctionPlan['outputLegs'][number] = {
      toAddress: output.address,
      amountSats: output.value,
      // `index` is the authoritative vout; the array position is a fallback for
      // sources that omit it.
      vout: output.index ?? i,
    };
    // `change` is an inference, carried through only when the source rendered a
    // verdict — an absent flag means "not assessed", not "not change".
    if (output.change !== undefined) leg.change = output.change;
    outputLegs.push(leg);
  });

  return {
    node: {
      address: txHash,
      // RAW counts, including the coinbase and OP_RETURN slots that produce no
      // leg: an investigator reading "1 in / 3 out" is reading the transaction
      // as it exists on-chain, not as this graph chose to draw it.
      label: `${inputs.length} in / ${outputs.length} out`,
      kind: 'txJunction',
    },
    inputLegs,
    outputLegs,
  };
}
