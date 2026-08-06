import { randomUUID } from 'crypto';
import { edgeIdentityKey } from '../../../generated/shared/edge-identity';
import type { TransactionResult } from '../blockchain.service';
import {
  HeliusNativeTransfer,
  HeliusParsedTx,
  HeliusTokenTransfer,
  MintMetadata,
} from '../helius-client';
import { SolanaContext } from '../types';
import { detectSpam } from './detect-spam';

const SOL_TOKEN = { address: '', symbol: 'SOL', decimals: 9 };

/**
 * Expands a numeric string into plain decimal notation.
 *
 * JS renders numbers below 1e-6 and at or above 1e21 in exponential form --
 * `String(0.0000001) === '1e-7'` -- and a naive split on '.' reads that as an
 * integer part of '1e-7', producing a wildly wrong amount. High-decimal SPL
 * mints carrying tiny amounts hit this routinely, so every value is
 * normalized here before any digit manipulation.
 */
function toPlainString(value: number | string): string {
  const rendered = typeof value === 'string' ? value.trim() : String(value);
  if (!/[eE]/.test(rendered)) return rendered;

  const match = /^([+-]?)(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(rendered);
  if (!match) return rendered;

  const [, sign, rawInt, rawFrac = '', rawExp] = match;
  const intDigits = rawInt === '' ? '0' : rawInt;
  const digits = intDigits + rawFrac;
  // The decimal point starts just after the integer digits; the exponent
  // shifts it right (positive) or left (negative).
  const pointPos = intDigits.length + parseInt(rawExp, 10);

  let expanded: string;
  if (pointPos <= 0) {
    expanded = `0.${'0'.repeat(-pointPos)}${digits}`;
  } else if (pointPos >= digits.length) {
    expanded = digits + '0'.repeat(pointPos - digits.length);
  } else {
    expanded = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
  }

  return sign === '-' ? `-${expanded}` : expanded;
}

/**
 * Converts a decimal-adjusted token amount into its raw base-unit string --
 * the canonical on-chain integer -- using string math only. Floating-point
 * multiplication is never used: `1.1 * 1e18` is off by hundreds of raw units,
 * and these amounts end up in court exhibits.
 *
 * Fraction digits beyond `decimals` are truncated, matching the ledger, which
 * cannot represent them.
 *
 * Precision caveat: a `number` input has already lost precision before this
 * function sees it (the double nearest 123456789.123456789 stringifies as
 * '123456789.12345679'). decimalToRaw is exact on whatever it receives;
 * callers needing full precision must pass the amount as a string.
 */
export function decimalToRaw(amount: number | string, decimals: number): string {
  const plain = toPlainString(amount);
  const negative = plain.startsWith('-');
  const unsigned = negative ? plain.slice(1) : plain;

  const [intPart = '', fracPart = ''] = unsigned.split('.');
  const scaledFrac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const digits = (intPart + scaledFrac).replace(/^0+/, '');
  const raw = digits === '' ? '0' : digits;

  return negative && raw !== '0' ? `-${raw}` : raw;
}

/**
 * True when the amount is exactly zero, decided on the digits rather than by
 * a float comparison so that neither underflow ('1e-400') nor an odd literal
 * ('0.000') is misread.
 */
function isZeroAmount(amount: number | string): boolean {
  const digits = toPlainString(amount).replace('-', '').replace('.', '');
  return /^0*$/.test(digits);
}

/**
 * Maps Helius parsed transactions into canvas-ready transaction rows for one
 * subject address `A`. Pure: no network, no service dependencies.
 *
 * Solana's account model names both endpoints of every transfer outright, so
 * unlike the Bitcoin mapper there is no attribution to reason about -- and
 * that makes the prime directive absolute here: **a counterparty is NEVER
 * synthesized.** A transfer whose `fromUserAccount` or `toUserAccount` is null
 * (the ledger did not resolve an owner) simply produces no row. That is not an
 * error condition; it is the mapper declining to invent a party. No path in
 * this module emits a row with an empty `from` or `to`.
 *
 * One signature can carry many transfers. Each is emitted as its own row,
 * identified by `transferIndex` -- its position in
 * `[...nativeTransfers, ...tokenTransfers]`. Helius's parse is deterministic,
 * so that index is stable across refetches and serves as the edge identity.
 *
 * Ledger facts (emitted verbatim): signature, slot, timestamp, both owner
 * accounts, the amount in raw base units, the mint, the underlying token
 * accounts, the fee payer, and Helius's own type/source classification.
 *
 * Inference (always labelled, never load-bearing on its own): the
 * `spam` / `spamEvidence` verdict from detectSpam(), which is evaluated ONLY
 * for INCOMING SPL transfers -- a row the subject sent, or a native SOL
 * transfer, is never assessed for spam and carries no spam fields at all.
 * The fields are attached only when at least one heuristic fired, so their
 * presence itself signals that something was noticed.
 *
 * Failed transactions (`transactionError != null`) moved nothing and produce
 * no rows, as do zero-amount transfers and transfers not touching `A`.
 *
 * Rows are finally de-duplicated by their canonical edge identity key
 * (`signature:sol:transferIndex`), keeping the first occurrence, so
 * overlapping pages collapse to one row per transfer.
 */
export function mapSolanaHistory(
  address: string,
  txs: HeliusParsedTx[],
  mintMeta: Map<string, MintMetadata>,
): TransactionResult[] {
  const rows: TransactionResult[] = [];
  for (const tx of txs) {
    rows.push(...mapTx(address, tx, mintMeta));
  }

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = edgeIdentityKey(row, row.from, row.to);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapTx(
  address: string,
  tx: HeliusParsedTx,
  mintMeta: Map<string, MintMetadata>,
): TransactionResult[] {
  // A failed transaction settled no value; its transfers are what the sender
  // attempted, not what happened.
  if (tx.transactionError != null) return [];

  const timestamp = new Date(tx.timestamp * 1000).toISOString();
  const rows: TransactionResult[] = [];

  // transferIndex spans both lists as one sequence, natives first. It is the
  // position within the transaction -- never within the emitted rows -- so
  // skipping a transfer must not shift the indices of the ones that follow.
  tx.nativeTransfers.forEach((transfer, i) => {
    const row = mapNative(address, tx, transfer, i, timestamp);
    if (row) rows.push(row);
  });

  const offset = tx.nativeTransfers.length;
  tx.tokenTransfers.forEach((transfer, i) => {
    const row = mapToken(address, tx, transfer, offset + i, timestamp, mintMeta);
    if (row) rows.push(row);
  });

  return rows;
}

/**
 * Both endpoints must be named by the ledger and at least one of them must be
 * the subject. Returns the pair only when the transfer earns a row.
 *
 * An empty string is rejected alongside null: both mean the owner was not
 * resolved, and a row carrying one would render as an edge to a node that
 * does not exist -- invisible on the canvas while still counted in the trace.
 */
function resolveEndpoints(
  address: string,
  transfer: { fromUserAccount: string | null; toUserAccount: string | null },
): { from: string; to: string } | null {
  const { fromUserAccount: from, toUserAccount: to } = transfer;
  if (!from || !to) return null;
  if (from !== address && to !== address) return null;
  return { from, to };
}

function mapNative(
  address: string,
  tx: HeliusParsedTx,
  transfer: HeliusNativeTransfer,
  transferIndex: number,
  timestamp: string,
): TransactionResult | null {
  const endpoints = resolveEndpoints(address, transfer);
  if (!endpoints || isZeroAmount(transfer.amount)) return null;

  const solana: SolanaContext = {
    transferIndex,
    feePayer: tx.feePayer,
    kind: 'native',
    type: tx.type,
    source: tx.source,
    slot: tx.slot,
  };

  return buildRow({
    ...endpoints,
    // Lamports are already the raw base unit, so the scale is 0 -- this is
    // here for the normalization, which keeps exponential notation out of the
    // amount string the same way it does for token amounts.
    amount: decimalToRaw(transfer.amount, 0),
    token: { ...SOL_TOKEN },
    tx,
    timestamp,
    solana,
  });
}

function mapToken(
  address: string,
  tx: HeliusParsedTx,
  transfer: HeliusTokenTransfer,
  transferIndex: number,
  timestamp: string,
  mintMeta: Map<string, MintMetadata>,
): TransactionResult | null {
  const endpoints = resolveEndpoints(address, transfer);
  // Judged on the ledger's own decimal amount, not on the derived raw value:
  // when a mint is unresolved the decimals fall back to 0, and a real dust
  // transfer must not disappear because our fallback truncated it away.
  if (!endpoints || isZeroAmount(transfer.tokenAmount)) return null;

  const meta = mintMeta.get(transfer.mint);
  // `meta` being present is not enough: HeliusClient.getMintMetadata writes
  // a fallback entry for every mint it couldn't resolve via DAS, so the
  // explicit `resolved` flag (not mere Map membership) is what distinguishes
  // a genuinely-resolved mint from an unresolvable one.
  const mintResolved = meta?.resolved === true;
  const symbol = meta?.symbol ?? `${transfer.mint.slice(0, 4)}…`;
  const decimals = meta?.decimals ?? 0;

  const solana: SolanaContext = {
    transferIndex,
    feePayer: tx.feePayer,
    kind: 'spl',
    mint: transfer.mint,
    decimals,
    // Token accounts are evidence in their own right: they tie the owner
    // wallets to the specific accounts the ledger actually debited/credited.
    fromTokenAccount: transfer.fromTokenAccount ?? undefined,
    toTokenAccount: transfer.toTokenAccount ?? undefined,
    type: tx.type,
    source: tx.source,
    slot: tx.slot,
  };

  // Spam is a property of what arrived unbidden. Rows the subject sent are
  // never assessed -- detectSpam's contract assumes an incoming transfer.
  const incoming =
    endpoints.to === address && endpoints.from !== address;
  if (incoming) {
    const verdict = detectSpam(tx, transfer, address, mintResolved);
    if (verdict.evidence.length > 0) {
      solana.spam = verdict.spam;
      solana.spamEvidence = verdict.evidence;
    }
  }

  return buildRow({
    ...endpoints,
    amount: decimalToRaw(transfer.tokenAmount, decimals),
    token: { address: transfer.mint, symbol, decimals },
    tx,
    timestamp,
    solana,
  });
}

function buildRow(p: {
  from: string;
  to: string;
  amount: string;
  token: { address: string; symbol: string; decimals: number };
  tx: HeliusParsedTx;
  timestamp: string;
  solana: SolanaContext;
}): TransactionResult {
  return {
    id: randomUUID(),
    from: p.from,
    to: p.to,
    txHash: p.tx.signature,
    chain: 'solana',
    timestamp: p.timestamp,
    amount: p.amount,
    token: p.token,
    blockNumber: p.tx.slot,
    notes: '',
    tags: [],
    crossTrace: false,
    solana: p.solana,
  };
}
