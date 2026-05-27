'use client';

import { useRef } from 'react';
import { FloatingPanel } from '@/components/Common/FloatingPanel';
import { DetailsPanel, type DetailsPanelHandle } from '@/components/Graph/DetailsPanel';
import { WalletHeaderActions, TransactionHeaderActions } from '@/components/Graph/HeaderActions';
import { applyArcDelta } from '@/utils/arcEdge';
import { apiClient } from '@/lib/api-client';
import type { Investigation, WalletNode, TransactionEdge, Trace, Group, EdgeBundle } from '@/types/investigation';
import type { GraphCanvasHandle } from '@/components/Graph/GraphCanvas';

interface SelectionDetailsPanelProps {
  selectedItem: any;
  setSelectedItem: (item: any | null) => void;
  investigation: Investigation;
  allWallets: { wallet: WalletNode; traceId: string }[];
  graphRef: React.RefObject<GraphCanvasHandle>;
  activeInvestigationId: string | null;

  updateWallet: (traceId: string, walletId: string, patch: Partial<WalletNode>) => void;
  deleteWallet: (traceId: string, walletId: string) => void;
  updateTransaction: (traceId: string, txId: string, patch: Partial<TransactionEdge>) => void;
  deleteTransaction: (traceId: string, txId: string) => void;
  updateTrace: (traceId: string, patch: Partial<Trace>) => void;
  deleteTrace: (traceId: string) => void;
  updateGroup: (traceId: string, groupId: string, patch: Partial<Group>) => void;
  deleteGroup: (traceId: string, groupId: string) => void;
  setNodeGroup: (traceId: string, nodeIds: string[], groupId: string | null) => void;
  toggleEdgeBundle: (traceId: string, bundleId: string) => void;
  updateEdgeBundle: (traceId: string, bundleId: string, patch: Partial<EdgeBundle>) => void;
  deleteEdgeBundle: (traceId: string, bundleId: string) => void;

  onFetchHistory: (address: string, chain: string) => void;
  onBundleAllOutbound: (walletId: string, color: string) => void;
  onDeleteAllOutbound: (walletId: string) => void;
  onBundleAllInbound: (walletId: string, color: string) => void;
  onDeleteAllInbound: (walletId: string) => void;
  onRefreshScriptRuns: () => Promise<void>;
}

export function SelectionDetailsPanel(props: SelectionDetailsPanelProps) {
  const {
    selectedItem, setSelectedItem, investigation, allWallets, graphRef,
    updateWallet, deleteWallet, updateTransaction, deleteTransaction,
    updateTrace, deleteTrace, updateGroup, deleteGroup, setNodeGroup,
    toggleEdgeBundle, updateEdgeBundle, deleteEdgeBundle,
    onFetchHistory, onBundleAllOutbound, onDeleteAllOutbound,
    onBundleAllInbound, onDeleteAllInbound, onRefreshScriptRuns,
  } = props;

  const detailsPanelRef = useRef<DetailsPanelHandle>(null);

  const title = selectedItem.type === 'wallet' ? 'Address'
    : selectedItem.type === 'scriptRun' ? 'Script'
    : selectedItem.type === 'aggregatedEdge' ? 'Aggregated Transactions'
    : selectedItem.type;

  return (
    <FloatingPanel
      title={`${title} Details`}
      onClose={() => { setSelectedItem(null); graphRef.current?.unselectAll(); }}
      className="absolute bottom-4 left-4"
      width="w-[420px]"
      actions={selectedItem.type === 'wallet' ? (
        <WalletHeaderActions
          wallet={selectedItem.data as WalletNode}
          onEdit={() => detailsPanelRef.current?.startEdit()}
          onDelete={() => {
            const w = selectedItem.data as WalletNode;
            deleteWallet(w.parentTrace, w.id);
            setSelectedItem(null);
            graphRef.current?.unselectAll();
          }}
          onColorChange={(color) => updateWallet(selectedItem.data.parentTrace, selectedItem.data.id, { color })}
        />
      ) : selectedItem.type === 'transaction' ? (
        <TransactionHeaderActions
          transaction={selectedItem.data as TransactionEdge}
          onEdit={() => detailsPanelRef.current?.startEdit()}
          onDelete={() => {
            const tx = selectedItem.data as TransactionEdge;
            const traceId = investigation.traces.find((t) => t.edges.some((e) => e.id === tx.id))?.id || '';
            deleteTransaction(traceId, tx.id);
            setSelectedItem(null);
            graphRef.current?.unselectAll();
          }}
          onColorChange={(color) => {
            const tx = selectedItem.data as TransactionEdge;
            const traceId = investigation.traces.find((t) => t.edges.some((e) => e.id === tx.id))?.id || '';
            updateTransaction(traceId, tx.id, { color });
          }}
        />
      ) : undefined}
    >
      <DetailsPanel
        ref={detailsPanelRef}
        selectedItem={selectedItem}
        traces={investigation.traces}
        allWallets={allWallets}
        onUpdateWallet={updateWallet}
        onDeleteWallet={(traceId, walletId) => { deleteWallet(traceId, walletId); setSelectedItem(null); }}
        onUpdateTransaction={updateTransaction}
        onDeleteTransaction={(traceId, txId) => { deleteTransaction(traceId, txId); setSelectedItem(null); }}
        onUpdateTrace={updateTrace}
        onDeleteTrace={(traceId) => {
          apiClient.deleteTrace(traceId).catch(console.error);
          deleteTrace(traceId);
          setSelectedItem(null);
        }}
        onUpdateGroup={updateGroup}
        onDeleteGroup={(traceId, groupId) => { deleteGroup(traceId, groupId); setSelectedItem(null); }}
        onSetNodeGroup={setNodeGroup}
        onToggleEdgeBundle={toggleEdgeBundle}
        onUpdateEdgeBundle={updateEdgeBundle}
        onDeleteEdgeBundle={(traceId, bundleId) => { deleteEdgeBundle(traceId, bundleId); setSelectedItem(null); }}
        onFetchHistory={onFetchHistory}
        onBundleAllOutbound={onBundleAllOutbound}
        onDeleteAllOutbound={onDeleteAllOutbound}
        onBundleAllInbound={onBundleAllInbound}
        onDeleteAllInbound={onDeleteAllInbound}
        onRerunScript={async (scriptRunId) => {
          await apiClient.rerunScript(scriptRunId);
          await onRefreshScriptRuns();
        }}
        onArcEdge={(edgeId, delta) => {
          const persisted = applyArcDelta(investigation, edgeId, delta, { updateTransaction, updateEdgeBundle });
          if (!persisted) graphRef.current?.setEdgeArc(edgeId, delta);
        }}
      />
    </FloatingPanel>
  );
}
