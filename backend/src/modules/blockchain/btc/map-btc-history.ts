import { randomUUID } from 'crypto';
import { edgeIdentityKey } from '../../../generated/shared/edge-identity';
import type { TransactionResult } from '../blockchain.service';
import { EsploraTx } from '../esplora-client';
import { UtxoContext, UtxoInput, UtxoOutput } from '../types';
import { detectChange } from './detect-change';
import { detectPatterns } from './detect-patterns';

const OP_RETURN = 'op_return';

/**
 * Patterns that make a transaction's flow unattributable at the row level:
 * the ledger does not say which input paid which output, so the tx itself
 * must be drawn as a junction node rather than as address-to-address edges.
 */
const JUNCTION_PATTERNS = ['possible-coinjoin', 'consolidation', 'coinbase'];

/**
 * Above this many real (non-change, non-OP_RETURN) payment outputs, a
 * spend fans out too widely to read as a set of direct edges and is drawn
 * as a junction instead.
 */
const MAX_DIRECT_PAYMENT_OUTPUTS = 3;

const BTC_TOKEN = { address: '', symbol: 'BTC', decimals: 8 };

/**
 * Maps Esplora transactions into canvas-ready transaction rows for one
 * subject address `A`. Pure: no network, no service dependencies.
 *
 * This function draws the line between LEDGER FACT and INFERENCE, and that
 * line is load-bearing -- what it emits becomes evidence on an
 * investigator's canvas.
 *
 * Ledger facts (always emitted verbatim): txid, output index, satoshi
 * values, fee, every input and output with its address and script type,
 * confirmation status and block height.
 *
 * Inference (always labelled, never load-bearing on its own): the
 * `change` / `changeEvidence` verdicts from detectChange(), the pattern
 * `warnings` from detectPatterns(), and the `junction` flag.
 *
 * The hard rule: **a sender is NEVER synthesized.** An incoming payment is
 * attributed to a concrete `from` address only when the transaction has
 * exactly one input and that input's previous output carries a decodable
 * address -- the single case where the ledger itself names the payer.
 * In every other case (multiple inputs, coinbase, undecodable prevout, or
 * any junction pattern) the row is emitted with `from: ''` and
 * `junction: true`, so the canvas shows the transaction as an
 * unattributed junction rather than inventing a counterparty.
 *
 * Direction:
 * - `A` among the inputs -> OUTGOING. One row per non-OP_RETURN output,
 *   including change and including `A`'s own outputs in a self-send. This
 *   subsumes the "A is in both inputs and outputs" case, so no output is
 *   ever emitted twice.
 * - `A` only among the outputs -> INCOMING. One row per output paying `A`.
 * - `A` in neither -> nothing (the tx is not the subject's).
 *
 * OP_RETURN outputs never produce rows (they pay no one) but are always
 * retained in `utxo.outputs` with `opReturn: true` for the record.
 *
 * Rows are finally de-duplicated by their canonical edge identity key
 * (`txid:vout` for Bitcoin), keeping the first occurrence, so overlapping
 * pages or a tx returned by both the mempool and chain endpoints collapse
 * to one row per output.
 */
export function mapBtcHistory(
  address: string,
  txs: EsploraTx[],
): TransactionResult[] {
  const rows: TransactionResult[] = [];
  for (const tx of txs) {
    rows.push(...mapTx(address, tx));
  }

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = edgeIdentityKey(row, row.from, row.to);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Builds the full UTXO ledger record for one transaction: inputs, outputs
 * (with change/opReturn annotations), fee, pattern warnings, and
 * confirmation status. Pure and side-effect free -- shared by
 * `mapBtcHistory` (one row's worth of context, reused across every row a
 * tx produces) and by `BlockchainService.getTransaction`'s single-tx
 * detail path, so there is exactly one implementation of this mapping.
 */
export function buildUtxoContext(tx: EsploraTx): UtxoContext {
  const warnings = detectPatterns(tx);
  const verdicts = detectChange(tx);

  const inputs: UtxoInput[] = tx.vin.map((v) => ({
    address: v.prevout?.scriptpubkey_address ?? null,
    value: String(v.prevout?.value ?? 0),
    prevTxid: v.txid,
    prevVout: v.vout,
    scriptType: v.prevout?.scriptpubkey_type,
    coinbase: v.is_coinbase,
  }));

  const outputs: UtxoOutput[] = tx.vout.map((o, index) => ({
    address: o.scriptpubkey_address ?? null,
    value: String(o.value),
    index,
    scriptType: o.scriptpubkey_type,
    change: verdicts[index].change,
    changeEvidence: verdicts[index].evidence,
    opReturn: o.scriptpubkey_type === OP_RETURN,
  }));

  return {
    inputs,
    outputs,
    fee: String(tx.fee),
    warnings,
    confirmed: tx.status.confirmed,
    blockHeight: tx.status.block_height ?? null,
  };
}

function mapTx(address: string, tx: EsploraTx): TransactionResult[] {
  // Built once per transaction and shared (by reference) across every row
  // it produces: all rows describe the same ledger record.
  const context = buildUtxoContext(tx);
  const { inputs, outputs, warnings = [] } = context;

  // Unconfirmed txs have no block_time; they are stamped "now" so they sort
  // as the most recent activity, and blockNumber 0 marks them as unmined.
  const timestamp =
    tx.status.confirmed && tx.status.block_time != null
      ? new Date(tx.status.block_time * 1000).toISOString()
      : new Date().toISOString();
  const blockNumber = tx.status.block_height ?? 0;

  const txIsJunction = warnings.some((w) => JUNCTION_PATTERNS.includes(w));

  // Bitcoin addresses are case-sensitive; compare them exactly.
  const inInputs = tx.vin.some(
    (v) => v.prevout?.scriptpubkey_address === address,
  );
  const inOutputs = tx.vout.some((o) => o.scriptpubkey_address === address);

  const row = (from: string, to: string, out: UtxoOutput, junction: boolean) =>
    buildRow({
      from,
      to,
      amount: out.value,
      txid: tx.txid,
      timestamp,
      blockNumber,
      utxo: { ...context, vout: out.index, junction },
    });

  if (inInputs) {
    // OUTGOING (also covers self-sends and A-in-both).
    const payable = outputs.filter((o) => !o.opReturn);
    const paymentCount = payable.filter((o) => !o.change).length;
    const junction = txIsJunction || paymentCount > MAX_DIRECT_PAYMENT_OUTPUTS;

    return payable.map((out) => row(address, out.address ?? '', out, junction));
  }

  if (inOutputs) {
    // INCOMING. Attribute a sender only when the ledger names exactly one.
    const soleInputAddress =
      tx.vin.length === 1
        ? tx.vin[0].prevout?.scriptpubkey_address
        : undefined;
    const attributable = !txIsJunction && !!soleInputAddress;

    return outputs
      .filter((o) => o.address === address)
      .map((out) =>
        row(attributable ? soleInputAddress! : '', address, out, !attributable),
      );
  }

  return [];
}

function buildRow(p: {
  from: string;
  to: string;
  amount: string;
  txid: string;
  timestamp: string;
  blockNumber: number;
  utxo: UtxoContext;
}): TransactionResult {
  return {
    id: randomUUID(),
    from: p.from,
    to: p.to,
    txHash: p.txid,
    chain: 'bitcoin',
    timestamp: p.timestamp,
    amount: p.amount,
    token: { ...BTC_TOKEN },
    blockNumber: p.blockNumber,
    notes: '',
    tags: [],
    crossTrace: false,
    utxo: p.utxo,
  };
}
