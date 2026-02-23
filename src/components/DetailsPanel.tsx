import { WalletNode, TransactionEdge, Trace } from '../types/investigation';

interface DetailsPanelProps {
  selectedItem: any | null;
}

function WalletDetails({ wallet }: { wallet: WalletNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Wallet</h4>
        <p className="text-sm font-semibold">{wallet.label}</p>
      </div>
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
              <span key={tag} className="px-2 py-0.5 bg-gray-700 rounded text-xs">
                {tag}
              </span>
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
    </div>
  );
}

function TransactionDetails({ transaction }: { transaction: TransactionEdge }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Transaction</h4>
        <p className="text-sm font-semibold">
          {transaction.amount} {transaction.token.symbol}
        </p>
        {transaction.usdValue && (
          <p className="text-xs text-gray-400 mt-1">
            ${transaction.usdValue.toLocaleString()}
          </p>
        )}
      </div>
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
              <span key={tag} className="px-2 py-0.5 bg-gray-700 rounded text-xs">
                {tag}
              </span>
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

function TraceDetails({ trace }: { trace: Trace }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Trace</h4>
        <p className="text-sm font-semibold">{trace.name}</p>
      </div>
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

export function DetailsPanel({ selectedItem }: DetailsPanelProps) {
  if (!selectedItem) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        Select a wallet, transaction, or trace to view details
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">
        {selectedItem.type} Details
      </h3>

      {selectedItem.type === 'wallet' && <WalletDetails wallet={selectedItem.data} />}
      {selectedItem.type === 'transaction' && <TransactionDetails transaction={selectedItem.data} />}
      {selectedItem.type === 'trace' && <TraceDetails trace={selectedItem.data} />}
    </div>
  );
}
