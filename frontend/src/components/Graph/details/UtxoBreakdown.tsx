import { UtxoContext } from '@/types/investigation';
import {
  warningLabel,
  evidenceTitle,
  formatBtcValue,
  confirmationLabel,
  truncateMiddle,
} from '@/utils/utxoDisplay';

/**
 * Amber "change?" badge for a flagged output, shared by the outputs list
 * below and by the compact leg-edge reference in TransactionDetails. Title
 * attribute carries the human-readable evidence list as a tooltip.
 */
export function ChangeBadge({ evidence }: { evidence?: string[] | null }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 shrink-0"
      title={evidenceTitle(evidence)}
    >
      change?
    </span>
  );
}

function WarningChips({ warnings }: { warnings?: string[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {warnings.map((w) => (
        <span
          key={w}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-300"
        >
          {warningLabel(w)}
        </span>
      ))}
    </div>
  );
}

function InputsList({ inputs }: { inputs: UtxoContext['inputs'] }) {
  if (!inputs || inputs.length === 0) return null;
  return (
    <div className="space-y-1">
      <h5 className="text-[10px] font-semibold text-canvas-muted uppercase">Inputs</h5>
      <div className="max-h-40 overflow-y-auto overflow-x-hidden rounded-lg bg-canvas-fill divide-y divide-canvas-line [scrollbar-width:thin]">
        {inputs.map((input, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-[11px] px-2 py-1.5">
            <span className="font-mono text-canvas-muted truncate">
              {input.coinbase ? 'Coinbase' : input.address ? truncateMiddle(input.address) : '—'}
            </span>
            <span className="text-canvas-ink shrink-0 tabular-nums">
              {formatBtcValue(input.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OutputsList({
  outputs,
  highlightVout,
}: {
  outputs: UtxoContext['outputs'];
  highlightVout?: number;
}) {
  if (!outputs || outputs.length === 0) return null;
  return (
    <div className="space-y-1">
      <h5 className="text-[10px] font-semibold text-canvas-muted uppercase">Outputs</h5>
      <div className="max-h-40 overflow-y-auto overflow-x-hidden rounded-lg bg-canvas-fill divide-y divide-canvas-line [scrollbar-width:thin]">
        {outputs.map((output, i) => {
          const vout = output.index ?? i;
          const highlighted = highlightVout !== undefined && vout === highlightVout;
          return (
            <div
              key={i}
              className={`flex items-center justify-between gap-2 text-[11px] px-2 py-1.5 ${
                highlighted ? 'bg-brand/10' : ''
              }`}
            >
              <span className="text-canvas-muted shrink-0 w-4 text-right tabular-nums">{vout}</span>
              <span className="font-mono text-canvas-muted truncate flex-1">
                {output.opReturn ? 'OP_RETURN' : output.address ? truncateMiddle(output.address) : '—'}
              </span>
              {output.change && <ChangeBadge evidence={output.changeEvidence} />}
              <span className="text-canvas-ink shrink-0 tabular-nums">
                {formatBtcValue(output.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Shared UTXO ledger breakdown: warning chips, fee, confirmation status, and
 * scrollable inputs/outputs lists. Used by TxJunctionDetails (the full
 * `node.utxoTx` record) and by TransactionDetails for full direct BTC edges
 * (`transaction.utxo`, with `highlightVout` marking the edge's own output).
 * Slim junction-leg edges don't use this — see TransactionDetails' compact
 * reference block instead, since their inputs/outputs arrays are empty by
 * design (the full record lives on the junction node).
 */
export function UtxoBreakdown({
  utxo,
  highlightVout,
}: {
  utxo: UtxoContext;
  highlightVout?: number;
}) {
  const hasFee = !!utxo.fee && utxo.fee !== '0';
  const confirmText = confirmationLabel(utxo.confirmed, utxo.blockHeight);
  const inputCount = utxo.inputs?.length ?? 0;
  const outputCount = utxo.outputs?.length ?? 0;

  return (
    <div className="space-y-3">
      <WarningChips warnings={utxo.warnings} />
      {hasFee && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Fee</h4>
          <p className="text-sm text-canvas-muted">{formatBtcValue(utxo.fee)}</p>
        </div>
      )}
      {confirmText && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Status</h4>
          <p className="text-sm text-canvas-muted">{confirmText}</p>
        </div>
      )}
      <InputsList inputs={utxo.inputs} />
      <OutputsList outputs={utxo.outputs} highlightVout={highlightVout} />
      <p className="text-[11px] text-canvas-muted">
        {inputCount} input{inputCount === 1 ? '' : 's'} / {outputCount} output{outputCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}
