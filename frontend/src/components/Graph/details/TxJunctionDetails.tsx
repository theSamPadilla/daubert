import { WalletNode } from '@/types/investigation';
import { CopyButton } from '@/components/Common/CopyButton';
import { UtxoBreakdown } from './UtxoBreakdown';

/**
 * Details for a Bitcoin tx-junction node. Junctions stand in for a
 * transaction with too many participants to draw as a single
 * address→address edge (see generated/shared/utxo.ts#planJunction) — there is
 * no wallet to edit here, only the transaction's identity and the full
 * input/output ledger record carried on `node.utxoTx`.
 */
export function TxJunctionDetails({ node }: { node: WalletNode }) {
  const utxo = node.utxoTx;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-canvas-muted uppercase">Transaction Junction</h4>
      <p className="text-sm font-semibold">{node.label}</p>
      <div>
        <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Transaction ID</h4>
        <div className="flex items-start gap-1.5">
          {node.explorerUrl ? (
            <a
              href={node.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-accent hover:text-canvas-ink break-all underline decoration-accent/40 hover:decoration-accent/70 transition-colors"
            >
              {node.address}
            </a>
          ) : (
            <p className="text-xs font-mono text-canvas-muted break-all">{node.address}</p>
          )}
          <CopyButton text={node.address} className="shrink-0 text-canvas-muted hover:text-canvas-ink transition-colors" />
        </div>
      </div>
      {utxo && <UtxoBreakdown utxo={utxo} />}
    </div>
  );
}
