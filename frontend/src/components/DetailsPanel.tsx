import { useState } from 'react';
import { WalletNode, TransactionEdge, Trace } from '../types/investigation';
import { WalletForm } from './WalletForm';
import { TransactionForm } from './TransactionForm';
import { TraceForm } from './TraceForm';
import { FetchHistoryPanel } from './FetchHistoryPanel';

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
  onFetchHistory: (address: string, chain: string) => void;
  fetchLoading: boolean;
}

function WalletDetails({
  wallet,
  onEdit,
  onFetchHistory,
  fetchLoading,
}: {
  wallet: WalletNode;
  onEdit: () => void;
  onFetchHistory: (address: string, chain: string) => void;
  fetchLoading: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-400 uppercase">Wallet</h4>
        <button onClick={onEdit} className="text-xs text-blue-400 hover:text-blue-300">Edit</button>
      </div>
      <p className="text-sm font-semibold">{wallet.label}</p>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Address</h4>
        <p className="text-xs font-mono text-gray-300 break-all">{wallet.address}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Chain</h4>
        <p className="text-sm text-gray-300">{wallet.chain}</p>
      </div>
      {wallet.tags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Tags</h4>
          <div className="flex flex-wrap gap-1">
            {wallet.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-gray-700 rounded text-xs">{tag}</span>
            ))}
          </div>
        </div>
      )}
      {wallet.notes && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Notes</h4>
          <p className="text-sm text-gray-300">{wallet.notes}</p>
        </div>
      )}
      <div className="pt-2 border-t border-gray-700">
        <FetchHistoryPanel
          initialAddress={wallet.address}
          initialChain={wallet.chain}
          onFetch={onFetchHistory}
          loading={fetchLoading}
        />
      </div>
    </div>
  );
}

function TransactionDetails({
  transaction,
  onEdit,
}: {
  transaction: TransactionEdge;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-400 uppercase">Transaction</h4>
        <button onClick={onEdit} className="text-xs text-blue-400 hover:text-blue-300">Edit</button>
      </div>
      <p className="text-sm font-semibold">
        {transaction.amount} {transaction.token.symbol}
      </p>
      {transaction.usdValue && (
        <p className="text-xs text-gray-400">${transaction.usdValue.toLocaleString()}</p>
      )}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Hash</h4>
        <p className="text-xs font-mono text-gray-300 break-all">{transaction.txHash}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">From → To</h4>
        <p className="text-xs font-mono text-gray-300">{transaction.from}</p>
        <p className="text-xs text-gray-500 my-1">↓</p>
        <p className="text-xs font-mono text-gray-300">{transaction.to}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Timestamp</h4>
        <p className="text-sm text-gray-300">
          {new Date(transaction.timestamp).toLocaleString()}
        </p>
      </div>
      {transaction.tags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Tags</h4>
          <div className="flex flex-wrap gap-1">
            {transaction.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-gray-700 rounded text-xs">{tag}</span>
            ))}
          </div>
        </div>
      )}
      {transaction.notes && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Notes</h4>
          <p className="text-sm text-gray-300">{transaction.notes}</p>
        </div>
      )}
    </div>
  );
}

function TraceDetails({ trace, onEdit }: { trace: Trace; onEdit: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-400 uppercase">Trace</h4>
        <button onClick={onEdit} className="text-xs text-blue-400 hover:text-blue-300">Edit</button>
      </div>
      <p className="text-sm font-semibold">{trace.name}</p>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Type</h4>
        <p className="text-sm text-gray-300 capitalize">{trace.criteria.type}</p>
      </div>
      {trace.criteria.timeRange && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Time Range</h4>
          <p className="text-xs text-gray-300">
            {new Date(trace.criteria.timeRange.start).toLocaleDateString()}
          </p>
          <p className="text-xs text-gray-500">to</p>
          <p className="text-xs text-gray-300">
            {new Date(trace.criteria.timeRange.end).toLocaleDateString()}
          </p>
        </div>
      )}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Stats</h4>
        <p className="text-sm text-gray-300">{trace.nodes.length} wallets</p>
        <p className="text-sm text-gray-300">{trace.edges.length} transactions</p>
      </div>
    </div>
  );
}

export function DetailsPanel({
  selectedItem,
  traces,
  allWallets,
  onUpdateWallet,
  onDeleteWallet,
  onUpdateTransaction,
  onDeleteTransaction,
  onUpdateTrace,
  onDeleteTrace,
  onFetchHistory,
  fetchLoading,
}: DetailsPanelProps) {
  const [editing, setEditing] = useState(false);

  // Reset editing when selection changes
  const selectedId = selectedItem?.data?.id;
  const [lastSelectedId, setLastSelectedId] = useState<string | undefined>();
  if (selectedId !== lastSelectedId) {
    setLastSelectedId(selectedId);
    if (editing) setEditing(false);
  }

  if (!selectedItem) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        Select a wallet, transaction, or trace to view details
      </div>
    );
  }

  if (editing && selectedItem.type === 'wallet') {
    const wallet = selectedItem.data as WalletNode;
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">Edit Wallet</h3>
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
        <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">Edit Transaction</h3>
        <TransactionForm
          transaction={tx}
          traces={traces}
          allWallets={allWallets}
          onSave={(tid, updates) => {
            onUpdateTransaction(tid || traceId, tx.id, updates);
            setEditing(false);
          }}
          onDelete={(tid) => {
            onDeleteTransaction(tid || traceId, tx.id);
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
        <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">Edit Trace</h3>
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
      <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">
        {selectedItem.type} Details
      </h3>

      {selectedItem.type === 'wallet' && (
        <WalletDetails
          wallet={selectedItem.data}
          onEdit={() => setEditing(true)}
          onFetchHistory={onFetchHistory}
          fetchLoading={fetchLoading}
        />
      )}
      {selectedItem.type === 'transaction' && (
        <TransactionDetails
          transaction={selectedItem.data}
          onEdit={() => setEditing(true)}
        />
      )}
      {selectedItem.type === 'trace' && (
        <TraceDetails trace={selectedItem.data} onEdit={() => setEditing(true)} />
      )}
    </div>
  );
}
