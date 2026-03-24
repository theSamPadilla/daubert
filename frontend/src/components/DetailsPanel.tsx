import { useState } from 'react';
import { WalletNode, TransactionEdge, Trace } from '../types/investigation';
import { type ScriptRun } from '@/lib/api-client';
import { WalletForm } from './WalletForm';
import { TransactionForm } from './TransactionForm';
import { TraceForm } from './TraceForm';
import { FetchHistoryPanel } from './FetchHistoryPanel';
import { formatTokenAmount } from '../utils/formatAmount';

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
  onRerunScript?: (scriptRunId: string) => Promise<void>;
}

const ADDRESS_TYPE_LABELS: Record<string, string> = {
  wallet: 'Wallet',
  contract: 'Contract',
  unknown: 'Unknown',
};

const ADDRESS_TYPE_COLORS: Record<string, string> = {
  wallet: 'bg-blue-500/20 text-blue-300',
  contract: 'bg-purple-500/20 text-purple-300',
  unknown: 'bg-gray-500/20 text-gray-400',
};

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
  const hasAddress = !!wallet.address;
  const addrType = wallet.addressType || 'unknown';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase">{hasAddress ? 'Address' : 'Node'}</h4>
          {hasAddress && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ADDRESS_TYPE_COLORS[addrType]}`}>
              {ADDRESS_TYPE_LABELS[addrType]}
            </span>
          )}
        </div>
        <button onClick={onEdit} className="text-xs text-blue-400 hover:text-blue-300">Edit</button>
      </div>
      <p className="text-sm font-semibold">{wallet.label}</p>
      {hasAddress && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Address</h4>
          <p className="text-xs font-mono text-gray-300 break-all">{wallet.address}</p>
          {wallet.explorerUrl && (
            <a
              href={wallet.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block"
            >
              View on explorer ↗
            </a>
          )}
        </div>
      )}
      {hasAddress && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Chain</h4>
          <p className="text-sm text-gray-300">{wallet.chain}</p>
        </div>
      )}
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
      {hasAddress && (
        <div className="pt-2 border-t border-gray-700">
          <FetchHistoryPanel
            initialAddress={wallet.address}
            initialChain={wallet.chain}
            onFetch={onFetchHistory}
            loading={fetchLoading}
          />
        </div>
      )}
    </div>
  );
}

function resolveWalletDisplay(id: string, allWallets: { wallet: WalletNode; traceId: string }[]) {
  const match = allWallets.find((w) => w.wallet.id === id);
  if (match) {
    const addr = match.wallet.address;
    const truncated = addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
    return { label: match.wallet.label, address: truncated };
  }
  // Fallback: treat as raw address
  const truncated = id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
  return { label: truncated, address: '' };
}

function TransactionDetails({
  transaction,
  onEdit,
  allWallets,
}: {
  transaction: TransactionEdge;
  onEdit: () => void;
  allWallets: { wallet: WalletNode; traceId: string }[];
}) {
  const fromDisplay = resolveWalletDisplay(transaction.from, allWallets);
  const toDisplay = resolveWalletDisplay(transaction.to, allWallets);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-400 uppercase">Transaction</h4>
        <button onClick={onEdit} className="text-xs text-blue-400 hover:text-blue-300">Edit</button>
      </div>
      <p className="text-sm font-semibold">
        {formatTokenAmount(transaction.amount, transaction.token.decimals)} {transaction.token.symbol}
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
        <p className="text-xs text-gray-300">{fromDisplay.label}</p>
        {fromDisplay.address && <p className="text-[10px] font-mono text-gray-500">{fromDisplay.address}</p>}
        <p className="text-xs text-gray-500 my-1">↓</p>
        <p className="text-xs text-gray-300">{toDisplay.label}</p>
        {toDisplay.address && <p className="text-[10px] font-mono text-gray-500">{toDisplay.address}</p>}
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
        <p className="text-sm text-gray-300">{trace.nodes.length} addresses</p>
        <p className="text-sm text-gray-300">{trace.edges.length} transactions</p>
      </div>
    </div>
  );
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  success: { label: 'Success', cls: 'bg-emerald-500/20 text-emerald-300' },
  error: { label: 'Error', cls: 'bg-red-500/20 text-red-300' },
  timeout: { label: 'Timeout', cls: 'bg-amber-500/20 text-amber-300' },
};

function ScriptRunDetails({
  scriptRun,
  onRerun,
}: {
  scriptRun: ScriptRun;
  onRerun?: () => Promise<void>;
}) {
  const [showCode, setShowCode] = useState(true);
  const [running, setRunning] = useState(false);
  const badge = STATUS_BADGE[scriptRun.status] || STATUS_BADGE.error;

  const handleRerun = async () => {
    if (!onRerun) return;
    setRunning(true);
    try {
      await onRerun();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-xs font-semibold text-gray-400 uppercase">Script</h4>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        <span className="text-[10px] text-gray-500 ml-auto">
          {scriptRun.durationMs}ms
        </span>
        {onRerun && (
          <button
            onClick={handleRerun}
            disabled={running}
            className="px-2 py-0.5 bg-indigo-600/20 hover:bg-indigo-600/40 disabled:opacity-40 text-indigo-300 hover:text-indigo-200 rounded text-[10px] transition-colors"
          >
            {running ? 'Running…' : '▶ Re-run'}
          </button>
        )}
      </div>

      <p className="text-sm font-semibold">{scriptRun.name}</p>

      <div className="text-[10px] text-gray-500">
        {new Date(scriptRun.createdAt).toLocaleString()}
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 border-b border-gray-700">
        <button
          onClick={() => setShowCode(true)}
          className={`px-2 py-1 text-xs transition-colors ${
            showCode
              ? 'text-blue-400 border-b border-blue-400 -mb-px'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Code
        </button>
        <button
          onClick={() => setShowCode(false)}
          className={`px-2 py-1 text-xs transition-colors ${
            !showCode
              ? 'text-blue-400 border-b border-blue-400 -mb-px'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Output
        </button>
      </div>

      {showCode ? (
        <pre className="text-[11px] font-mono text-gray-300 bg-gray-900 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all [scrollbar-width:thin]">
          {scriptRun.code}
        </pre>
      ) : (
        <pre className={`text-[11px] font-mono rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all [scrollbar-width:thin] ${
          scriptRun.status === 'error' || scriptRun.status === 'timeout'
            ? 'text-red-300 bg-red-950/30'
            : 'text-gray-300 bg-gray-900'
        }`}>
          {scriptRun.output || '(no output)'}
        </pre>
      )}
    </div>
  );
}

const TYPE_DISPLAY: Record<string, string> = {
  wallet: 'Address',
  transaction: 'Transaction',
  trace: 'Trace',
  scriptRun: 'Script',
};

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
  onRerunScript,
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
        Select an address, transaction, or trace to view details
      </div>
    );
  }

  if (editing && selectedItem.type === 'wallet') {
    const wallet = selectedItem.data as WalletNode;
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">Edit Address</h3>
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
        {TYPE_DISPLAY[selectedItem.type] || selectedItem.type} Details
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
          allWallets={allWallets}
        />
      )}
      {selectedItem.type === 'trace' && (
        <TraceDetails trace={selectedItem.data} onEdit={() => setEditing(true)} />
      )}
      {selectedItem.type === 'scriptRun' && (
        <ScriptRunDetails
          scriptRun={selectedItem.data}
          onRerun={onRerunScript ? () => onRerunScript(selectedItem.data.id) : undefined}
        />
      )}
    </div>
  );
}
