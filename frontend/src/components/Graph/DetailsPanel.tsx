import { useState, forwardRef, useImperativeHandle } from 'react';
import { WalletNode, TransactionEdge, Trace, Group, EdgeBundle } from '@/types/investigation';
import { WalletForm } from '@/components/Forms/WalletForm';
import { TransactionForm } from '@/components/Forms/TransactionForm';
import { TraceForm } from '@/components/Forms/TraceForm';
import { useLabeledEntities } from '@/hooks/useLabeledEntities';
import { EdgeBundleDetails } from './details/EdgeBundleDetails';
import { GroupDetails } from './details/GroupDetails';
import { AggregatedEdgeDetails } from './details/AggregatedEdgeDetails';
import { TraceDetails } from './details/TraceDetails';
import { ScriptRunDetails } from './details/ScriptRunDetails';
import { TransactionDetails } from './details/TransactionDetails';
import { WalletDetails } from './details/WalletDetails';

interface DetailsPanelProps {
  selectedItem: any | null;
  traces: Trace[];
  allWallets: { wallet: WalletNode; traceId: string }[];
  onUpdateWallet: (traceId: string, walletId: string, updates: Partial<WalletNode>) => void;
  onDeleteWallet: (traceId: string, walletId: string) => void;
  onUpdateTransaction: (traceId: string, txId: string, updates: Partial<TransactionEdge>) => void;
  onDeleteTransaction: (traceId: string, txId: string) => void;
  onUpdateTrace: (traceId: string, updates: Partial<Trace>) => void;
  onDeleteTrace: (traceId: string) => void;
  onUpdateGroup: (traceId: string, groupId: string, updates: Partial<Group>) => void;
  onDeleteGroup: (traceId: string, groupId: string) => void;
  onSetNodeGroup: (traceId: string, nodeIds: string[], groupId: string | null) => void;
  onFetchHistory: (address: string, chain: string) => void;
  onBundleAllOutbound?: (walletId: string, color: string) => void;
  onDeleteAllOutbound?: (walletId: string) => void;
  onBundleAllInbound?: (walletId: string, color: string) => void;
  onDeleteAllInbound?: (walletId: string) => void;
  onRerunScript?: (scriptRunId: string) => Promise<void>;
  onToggleEdgeBundle?: (traceId: string, bundleId: string) => void;
  onUpdateEdgeBundle?: (traceId: string, bundleId: string, updates: Partial<EdgeBundle>) => void;
  onDeleteEdgeBundle?: (traceId: string, bundleId: string) => void;
  onArcEdge?: (edgeId: string, delta: number | null) => void;
}

const TYPE_DISPLAY: Record<string, string> = {
  wallet: 'Address',
  transaction: 'Transaction',
  trace: 'Trace',
  group: 'Subgroup',
  scriptRun: 'Script',
  edgeBundle: 'Edge Bundle',
  aggregatedEdge: 'Aggregated Transactions',
};

export interface DetailsPanelHandle {
  startEdit: () => void;
}

export const DetailsPanel = forwardRef<DetailsPanelHandle, DetailsPanelProps>(function DetailsPanel({
  selectedItem,
  traces,
  allWallets,
  onUpdateWallet,
  onDeleteWallet,
  onUpdateTransaction,
  onDeleteTransaction,
  onUpdateTrace,
  onDeleteTrace,
  onUpdateGroup,
  onDeleteGroup,
  onSetNodeGroup,
  onFetchHistory,
  onBundleAllOutbound,
  onDeleteAllOutbound,
  onBundleAllInbound,
  onDeleteAllInbound,
  onRerunScript,
  onToggleEdgeBundle,
  onUpdateEdgeBundle,
  onDeleteEdgeBundle,
  onArcEdge,
}: DetailsPanelProps, ref) {
  const [editing, setEditing] = useState(false);
  useImperativeHandle(ref, () => ({ startEdit: () => setEditing(true) }), []);
  const { lookupAddress } = useLabeledEntities();

  // Reset editing when selection changes
  const selectedId = selectedItem?.data?.id;
  const [lastSelectedId, setLastSelectedId] = useState<string | undefined>();
  if (selectedId !== lastSelectedId) {
    setLastSelectedId(selectedId);
    if (editing) setEditing(false);
  }

  if (!selectedItem) {
    return (
      <div className="p-4 text-canvas-muted text-sm">
        Select an address, transaction, or trace to view details
      </div>
    );
  }

  if (editing && selectedItem.type === 'wallet') {
    const wallet = selectedItem.data as WalletNode;
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-canvas-muted uppercase mb-4">Edit Address</h3>
        <WalletForm
          wallet={wallet}
          traces={traces}
          selectedTraceId={wallet.parentTrace}
          onSave={(traceId, updates) => {
            onUpdateWallet(traceId, wallet.id, updates);
            setEditing(false);
          }}
          onDelete={(traceId) => {
            onDeleteWallet(traceId, wallet.id);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  if (editing && selectedItem.type === 'transaction') {
    const tx = selectedItem.data as TransactionEdge;
    // Find trace containing this transaction
    const traceId = traces.find((t) => t.edges.some((e) => e.id === tx.id))?.id || '';
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-canvas-muted uppercase mb-4">Edit Transaction</h3>
        <TransactionForm
          transaction={tx}
          traces={traces}
          allWallets={allWallets}
          onSave={(_tid, updates) => {
            // Always use traceId found by edge lookup — the form's tid may be wrong
            // for cross-trace edges where `from` is a wallet in a different trace.
            onUpdateTransaction(traceId, tx.id, updates);
            setEditing(false);
          }}
          onDelete={(_tid) => {
            onDeleteTransaction(traceId, tx.id);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  if (editing && selectedItem.type === 'trace') {
    const trace = selectedItem.data as Trace;
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-canvas-muted uppercase mb-4">Edit Trace</h3>
        <TraceForm
          trace={trace}
          onSave={(updates) => {
            onUpdateTrace(trace.id, updates);
            setEditing(false);
          }}
          onDelete={() => {
            onDeleteTrace(trace.id);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="p-4">
      {selectedItem.type === 'wallet' && (
        <WalletDetails
          wallet={selectedItem.data}
          onFetchHistory={onFetchHistory}
          onBundleAllOutbound={onBundleAllOutbound}
          onDeleteAllOutbound={onDeleteAllOutbound}
          onBundleAllInbound={onBundleAllInbound}
          onDeleteAllInbound={onDeleteAllInbound}
          onUpdate={(updates) => {
            const w = selectedItem.data as WalletNode;
            onUpdateWallet(w.parentTrace, w.id, updates);
          }}
          lookupAddress={lookupAddress}
        />
      )}
      {selectedItem.type === 'transaction' && (
        <TransactionDetails
          transaction={selectedItem.data}
          allWallets={allWallets}
          onUpdate={(updates) => {
            const tx = selectedItem.data as TransactionEdge;
            const traceId = traces.find((t) => t.edges.some((e) => e.id === tx.id))?.id || '';
            onUpdateTransaction(traceId, tx.id, updates);
          }}
          onArcEdge={onArcEdge ? (delta) => onArcEdge((selectedItem.data as TransactionEdge).id, delta) : undefined}
        />
      )}
      {selectedItem.type === 'trace' && (
        <TraceDetails
          trace={selectedItem.data}
          onEdit={() => setEditing(true)}
          onUpdate={(updates) => onUpdateTrace((selectedItem.data as Trace).id, updates)}
        />
      )}
      {selectedItem.type === 'group' && (
        <GroupDetails
          group={selectedItem.data}
          traces={traces}
          onUpdate={(updates) => onUpdateGroup(selectedItem.data.traceId, selectedItem.data.id, updates)}
          onDelete={() => onDeleteGroup(selectedItem.data.traceId, selectedItem.data.id)}
          onSetNodeGroup={onSetNodeGroup}
        />
      )}
      {selectedItem.type === 'scriptRun' && (
        <ScriptRunDetails
          scriptRun={selectedItem.data}
          onRerun={onRerunScript ? () => onRerunScript(selectedItem.data.id) : undefined}
        />
      )}
      {selectedItem.type === 'edgeBundle' && (
        <EdgeBundleDetails
          bundle={selectedItem.data as EdgeBundle}
          traces={traces}
          onToggle={() => onToggleEdgeBundle?.(selectedItem.data.traceId, selectedItem.data.id)}
          onUpdate={onUpdateEdgeBundle ? (updates) => onUpdateEdgeBundle(selectedItem.data.traceId, selectedItem.data.id, updates) : undefined}
          onDelete={() => onDeleteEdgeBundle?.(selectedItem.data.traceId, selectedItem.data.id)}
          onArcEdge={onArcEdge ? (delta) => onArcEdge((selectedItem.data as EdgeBundle).id, delta) : undefined}
        />
      )}
      {selectedItem.type === 'aggregatedEdge' && (
        <AggregatedEdgeDetails
          edges={selectedItem.data.edges}
          fromLabel={selectedItem.data.fromLabel}
          toLabel={selectedItem.data.toLabel}
          traceId={selectedItem.data.traceId}
          onArcEdge={onArcEdge ? (delta) => onArcEdge(selectedItem.data.syntheticEdgeId, delta) : undefined}
          onUpdateTransaction={onUpdateTransaction}
          onDeleteTransaction={onDeleteTransaction}
        />
      )}
    </div>
  );
});
