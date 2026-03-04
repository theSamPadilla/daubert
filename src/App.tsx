import { useState, useCallback, useEffect, useMemo } from 'react';
import { mockInvestigation } from './data/mockInvestigation';
import { GraphCanvas } from './components/GraphCanvas';
import { SidePanel } from './components/SidePanel';
import { Header } from './components/Header';
import { ContextMenu, ContextMenuItem } from './components/ContextMenu';
import { WalletForm } from './components/WalletForm';
import { TransactionForm } from './components/TransactionForm';
import { WalletNode, TransactionEdge, Trace } from './types/investigation';
import { saveInvestigation, loadInvestigation, createNewInvestigation } from './utils/fileOperations';
import { importFile } from './utils/importData';
import { fetchWalletHistory } from './services/FetchService';
import { useInvestigation } from './hooks/useInvestigation';
import { CytoscapeCallbacks } from './hooks/useCytoscape';

type PanelMode =
  | { type: 'none' }
  | { type: 'createWallet'; position?: { x: number; y: number } }
  | { type: 'createTransaction' };

function App() {
  const {
    investigation,
    setInvestigation,
    addTrace,
    updateTrace,
    deleteTrace,
    toggleTraceVisibility,
    toggleTraceCollapsed,
    addWallet,
    updateWallet,
    deleteWallet,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    updateNodePosition,
  } = useInvestigation(mockInvestigation);

  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [activeChain, setActiveChain] = useState('ethereum');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>({ type: 'none' });
  const [stagedItems, setStagedItems] = useState<TransactionEdge[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);

  // Compute all wallets across traces
  const allWallets = useMemo(() => {
    if (!investigation) return [];
    return investigation.traces.flatMap((t) =>
      t.nodes.map((wallet) => ({ wallet, traceId: t.id }))
    );
  }, [investigation]);

  // Re-derive selectedItem after investigation changes to prevent stale display
  useEffect(() => {
    if (!selectedItem || !investigation) return;
    const { type, data } = selectedItem;
    if (type === 'wallet' && data) {
      for (const trace of investigation.traces) {
        const found = trace.nodes.find((n) => n.id === data.id);
        if (found) {
          setSelectedItem({ type: 'wallet', data: found });
          return;
        }
      }
      setSelectedItem(null);
    } else if (type === 'transaction' && data) {
      for (const trace of investigation.traces) {
        const found = trace.edges.find((e) => e.id === data.id);
        if (found) {
          setSelectedItem({ type: 'transaction', data: found });
          return;
        }
      }
      setSelectedItem(null);
    } else if (type === 'trace' && data) {
      const found = investigation.traces.find((t) => t.id === data.id);
      if (found) {
        setSelectedItem({ type: 'trace', data: found });
      } else {
        setSelectedItem(null);
      }
    }
  }, [investigation]); // eslint-disable-line react-hooks/exhaustive-deps

  // File operations
  const handleNew = useCallback(() => {
    if (confirm('Create new investigation? Unsaved changes will be lost.')) {
      setInvestigation(createNewInvestigation());
      setSelectedItem(null);
      setStagedItems([]);
    }
  }, [setInvestigation]);

  const handleOpen = useCallback(async () => {
    try {
      const loaded = await loadInvestigation();
      setInvestigation(loaded);
      setSelectedItem(null);
      setStagedItems([]);
    } catch (error) {
      console.error('Failed to load investigation:', error);
      alert('Failed to load investigation file');
    }
  }, [setInvestigation]);

  const handleSave = useCallback(() => {
    if (investigation) saveInvestigation(investigation);
  }, [investigation]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.json';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const transactions = await importFile(file);
        setStagedItems((prev) => [...prev, ...transactions]);
      } catch (err) {
        console.error('Import failed:', err);
        alert('Failed to import file');
      }
    };
    input.click();
  }, []);

  // Trace operations
  const handleAddTrace = useCallback(() => {
    const colors = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308', '#ef4444'];
    const trace: Trace = {
      id: crypto.randomUUID(),
      name: `Trace ${(investigation?.traces.length || 0) + 1}`,
      criteria: { type: 'custom' },
      visible: true,
      collapsed: false,
      color: colors[(investigation?.traces.length || 0) % colors.length],
      nodes: [],
      edges: [],
      position: { x: 0, y: 0 },
    };
    addTrace(trace);
    setSelectedItem({ type: 'trace', data: trace });
  }, [addTrace, investigation?.traces.length]);

  const handleSelectTrace = useCallback((trace: Trace) => {
    setSelectedItem({ type: 'trace', data: trace });
  }, []);

  // Wallet creation
  const handleAddWallet = useCallback(() => {
    setPanelMode({ type: 'createWallet' });
  }, []);

  const handleCreateWalletAtPosition = useCallback((position: { x: number; y: number }) => {
    setPanelMode({ type: 'createWallet', position });
  }, []);

  const handleSaveNewWallet = useCallback(
    (traceId: string, data: Partial<WalletNode>) => {
      const position = panelMode.type === 'createWallet' && panelMode.position
        ? panelMode.position
        : { x: Math.random() * 400, y: Math.random() * 400 };

      const wallet: WalletNode = {
        id: crypto.randomUUID(),
        label: data.label || 'New Wallet',
        address: data.address || '',
        chain: data.chain || activeChain,
        color: data.color || '#60a5fa',
        notes: data.notes || '',
        tags: data.tags || [],
        position,
        parentTrace: traceId,
      };
      addWallet(traceId, wallet);
      setPanelMode({ type: 'none' });
      setSelectedItem({ type: 'wallet', data: wallet });
    },
    [addWallet, panelMode, activeChain]
  );

  // Transaction creation
  const handleAddTransaction = useCallback(() => {
    setPanelMode({ type: 'createTransaction' });
  }, []);

  const handleSaveNewTransaction = useCallback(
    (traceId: string, data: Partial<TransactionEdge>) => {
      const transaction: TransactionEdge = {
        id: crypto.randomUUID(),
        from: data.from || '',
        to: data.to || '',
        txHash: data.txHash || '0x',
        chain: data.chain || activeChain,
        timestamp: data.timestamp || new Date().toISOString(),
        amount: data.amount || '0',
        token: data.token || { address: '0x', symbol: 'ETH', decimals: 18 },
        usdValue: data.usdValue,
        color: data.color || '#10b981',
        label: data.label || '',
        notes: data.notes || '',
        tags: data.tags || [],
        blockNumber: data.blockNumber || 0,
        crossTrace: data.crossTrace || false,
      };
      addTransaction(traceId, transaction);
      setPanelMode({ type: 'none' });
      setSelectedItem({ type: 'transaction', data: transaction });
    },
    [addTransaction, activeChain]
  );

  // Fetch blockchain history
  const handleFetchHistory = useCallback(async (address: string, chain: string) => {
    setFetchLoading(true);
    try {
      const result = await fetchWalletHistory(address, chain);
      setStagedItems((prev) => [...prev, ...result.transactions]);
    } catch (err) {
      console.error('Fetch failed:', err);
      alert(`Failed to fetch history: ${err}`);
    } finally {
      setFetchLoading(false);
    }
  }, []);

  // Add staged items to trace
  const handleAddStagedToTrace = useCallback(
    (traceId: string, selected: TransactionEdge[]) => {
      if (!investigation) return;

      const existingTxHashes = new Set<string>();
      investigation.traces.forEach((t) =>
        t.edges.forEach((e) => existingTxHashes.add(`${e.txHash}-${e.from}-${e.to}`))
      );

      const existingWalletAddresses = new Map<string, string>();
      investigation.traces.forEach((t) =>
        t.nodes.forEach((n) => existingWalletAddresses.set(n.address.toLowerCase(), n.id))
      );

      // Find rightmost position for auto-placing new nodes
      let maxX = 0;
      investigation.traces.forEach((t) =>
        t.nodes.forEach((n) => { if (n.position.x > maxX) maxX = n.position.x; })
      );
      let newNodeX = maxX + 150;
      let newNodeY = 100;
      let placedCount = 0;

      for (const tx of selected) {
        const key = `${tx.txHash}-${tx.from}-${tx.to}`;
        if (existingTxHashes.has(key)) continue;

        // Auto-create missing wallet nodes
        for (const addr of [tx.from, tx.to]) {
          if (!existingWalletAddresses.has(addr.toLowerCase())) {
            const x = newNodeX + Math.floor(placedCount / 5) * 150;
            const y = newNodeY + (placedCount % 5) * 100;
            placedCount++;

            const wallet: WalletNode = {
              id: crypto.randomUUID(),
              label: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
              address: addr,
              chain: tx.chain,
              notes: '',
              tags: [],
              position: { x, y },
              parentTrace: traceId,
            };
            addWallet(traceId, wallet);
            existingWalletAddresses.set(addr.toLowerCase(), wallet.id);
          }
        }

        // Map from/to addresses to wallet IDs
        const fromId = existingWalletAddresses.get(tx.from.toLowerCase()) || tx.from;
        const toId = existingWalletAddresses.get(tx.to.toLowerCase()) || tx.to;

        addTransaction(traceId, {
          ...tx,
          id: crypto.randomUUID(),
          from: fromId,
          to: toId,
        });
        existingTxHashes.add(key);
      }

      // Remove added items from staging
      const selectedIds = new Set(selected.map((s) => s.id));
      setStagedItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    },
    [investigation, addWallet, addTransaction]
  );

  // Context menu handler
  const handleContextMenu = useCallback(
    (event: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number }) => {
      if (!investigation) return;

      const items: ContextMenuItem[] = [];

      if (event.type === 'node' && event.id) {
        // Check if it's a trace (parent) or wallet
        const trace = investigation.traces.find((t) => t.id === event.id);
        if (trace) {
          items.push(
            { label: 'Edit Trace', onClick: () => { setSelectedItem({ type: 'trace', data: trace }); } },
            { label: trace.visible ? 'Hide' : 'Show', onClick: () => toggleTraceVisibility(trace.id) },
            { label: trace.collapsed ? 'Expand' : 'Collapse', onClick: () => toggleTraceCollapsed(trace.id) },
            { label: 'Delete Trace', onClick: () => deleteTrace(trace.id), danger: true }
          );
        } else {
          let walletData: { wallet: WalletNode; traceId: string } | undefined;
          for (const t of investigation.traces) {
            const w = t.nodes.find((n) => n.id === event.id);
            if (w) { walletData = { wallet: w, traceId: t.id }; break; }
          }
          if (walletData) {
            items.push(
              { label: 'Edit Wallet', onClick: () => setSelectedItem({ type: 'wallet', data: walletData!.wallet }) },
              {
                label: 'Fetch History',
                onClick: () => handleFetchHistory(walletData!.wallet.address, walletData!.wallet.chain),
              },
              {
                label: 'Delete Wallet',
                onClick: () => deleteWallet(walletData!.traceId, walletData!.wallet.id),
                danger: true,
              }
            );
          }
        }
      } else if (event.type === 'edge' && event.id) {
        let txData: { tx: TransactionEdge; traceId: string } | undefined;
        for (const t of investigation.traces) {
          const tx = t.edges.find((e) => e.id === event.id);
          if (tx) { txData = { tx, traceId: t.id }; break; }
        }
        if (txData) {
          items.push(
            { label: 'Edit Transaction', onClick: () => setSelectedItem({ type: 'transaction', data: txData!.tx }) },
            {
              label: 'Delete Transaction',
              onClick: () => deleteTransaction(txData!.traceId, txData!.tx.id),
              danger: true,
            }
          );
        }
      } else if (event.type === 'background') {
        items.push(
          { label: 'Add Wallet Here', onClick: () => handleCreateWalletAtPosition({ x: event.x, y: event.y }) },
          { label: 'Add Trace', onClick: handleAddTrace }
        );
      }

      if (items.length > 0) {
        setContextMenu({ x: event.x, y: event.y, items });
      }
    },
    [investigation, toggleTraceVisibility, toggleTraceCollapsed, deleteTrace, deleteWallet, deleteTransaction, handleFetchHistory, handleCreateWalletAtPosition, handleAddTrace]
  );

  // Cytoscape callbacks
  const cytoscapeCallbacks: CytoscapeCallbacks = useMemo(
    () => ({
      onSelectItem: setSelectedItem,
      onNodeDrag: updateNodePosition,
      onContextMenu: handleContextMenu,
      onDoubleClickBackground: handleCreateWalletAtPosition,
    }),
    [updateNodePosition, handleContextMenu, handleCreateWalletAtPosition]
  );

  // Selected trace ID for TraceList highlight
  const selectedTraceId = selectedItem?.type === 'trace' ? selectedItem.data?.id : undefined;

  // Render creation panels
  const renderCreationPanel = () => {
    if (!investigation) return null;

    if (panelMode.type === 'createWallet') {
      return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40">
          <div className="bg-gray-800 rounded-lg p-6 w-96 max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">New Wallet</h3>
            <WalletForm
              traces={investigation.traces}
              selectedTraceId={investigation.traces[0]?.id}
              onSave={handleSaveNewWallet}
              onCancel={() => setPanelMode({ type: 'none' })}
            />
          </div>
        </div>
      );
    }

    if (panelMode.type === 'createTransaction') {
      return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40">
          <div className="bg-gray-800 rounded-lg p-6 w-[480px] max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">New Transaction</h3>
            <TransactionForm
              traces={investigation.traces}
              allWallets={allWallets}
              onSave={handleSaveNewTransaction}
              onCancel={() => setPanelMode({ type: 'none' })}
            />
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <Header
        investigation={investigation}
        activeChain={activeChain}
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        onImport={handleImport}
        onChainChange={setActiveChain}
        onAddWallet={handleAddWallet}
        onAddTransaction={handleAddTransaction}
      />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 bg-gray-900">
          <GraphCanvas
            investigation={investigation}
            callbacks={cytoscapeCallbacks}
          />
        </div>
        <SidePanel
          selectedItem={selectedItem}
          traces={investigation?.traces || []}
          allWallets={allWallets}
          selectedTraceId={selectedTraceId}
          stagedItems={stagedItems}
          fetchLoading={fetchLoading}
          onSelectTrace={handleSelectTrace}
          onToggleVisibility={toggleTraceVisibility}
          onToggleCollapsed={toggleTraceCollapsed}
          onAddTrace={handleAddTrace}
          onUpdateWallet={updateWallet}
          onDeleteWallet={(traceId, walletId) => {
            deleteWallet(traceId, walletId);
            setSelectedItem(null);
          }}
          onUpdateTransaction={updateTransaction}
          onDeleteTransaction={(traceId, txId) => {
            deleteTransaction(traceId, txId);
            setSelectedItem(null);
          }}
          onUpdateTrace={updateTrace}
          onDeleteTrace={(traceId) => {
            deleteTrace(traceId);
            setSelectedItem(null);
          }}
          onFetchHistory={handleFetchHistory}
          onAddStagedToTrace={handleAddStagedToTrace}
          onClearStaged={() => setStagedItems([])}
        />
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {renderCreationPanel()}
    </div>
  );
}

export default App;
