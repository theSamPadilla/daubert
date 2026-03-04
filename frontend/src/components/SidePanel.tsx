import { WalletNode, TransactionEdge, Trace } from '../types/investigation';
import { TraceList } from './TraceList';
import { DetailsPanel } from './DetailsPanel';
import { StagingPanel } from './StagingPanel';

interface SidePanelProps {
  selectedItem: any | null;
  traces: Trace[];
  allWallets: { wallet: WalletNode; traceId: string }[];
  selectedTraceId?: string;
  stagedItems: TransactionEdge[];
  fetchLoading: boolean;
  onSelectTrace: (trace: Trace) => void;
  onToggleVisibility: (traceId: string) => void;
  onToggleCollapsed: (traceId: string) => void;
  onAddTrace: () => void;
  onUpdateWallet: (traceId: string, walletId: string, updates: Partial<WalletNode>) => void;
  onDeleteWallet: (traceId: string, walletId: string) => void;
  onUpdateTransaction: (traceId: string, txId: string, updates: Partial<TransactionEdge>) => void;
  onDeleteTransaction: (traceId: string, txId: string) => void;
  onUpdateTrace: (traceId: string, updates: Partial<Trace>) => void;
  onDeleteTrace: (traceId: string) => void;
  onFetchHistory: (address: string, chain: string) => void;
  onAddStagedToTrace: (traceId: string, selected: TransactionEdge[]) => void;
  onClearStaged: () => void;
}

export function SidePanel({
  selectedItem,
  traces,
  allWallets,
  selectedTraceId,
  stagedItems,
  fetchLoading,
  onSelectTrace,
  onToggleVisibility,
  onToggleCollapsed,
  onAddTrace,
  onUpdateWallet,
  onDeleteWallet,
  onUpdateTransaction,
  onDeleteTransaction,
  onUpdateTrace,
  onDeleteTrace,
  onFetchHistory,
  onAddStagedToTrace,
  onClearStaged,
}: SidePanelProps) {
  return (
    <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
      <TraceList
        traces={traces}
        selectedTraceId={selectedTraceId}
        onSelectTrace={onSelectTrace}
        onToggleVisibility={onToggleVisibility}
        onToggleCollapsed={onToggleCollapsed}
        onAddTrace={onAddTrace}
      />
      <div className="flex-1 border-b border-gray-700 overflow-y-auto">
        <DetailsPanel
          selectedItem={selectedItem}
          traces={traces}
          allWallets={allWallets}
          onUpdateWallet={onUpdateWallet}
          onDeleteWallet={onDeleteWallet}
          onUpdateTransaction={onUpdateTransaction}
          onDeleteTransaction={onDeleteTransaction}
          onUpdateTrace={onUpdateTrace}
          onDeleteTrace={onDeleteTrace}
          onFetchHistory={onFetchHistory}
          fetchLoading={fetchLoading}
        />
      </div>
      <StagingPanel
        items={stagedItems}
        traces={traces}
        onAddToTrace={onAddStagedToTrace}
        onClear={onClearStaged}
      />
    </div>
  );
}
