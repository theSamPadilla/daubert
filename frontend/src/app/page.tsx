'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { GraphCanvas } from '@/components/GraphCanvas';
import { AIChat } from '@/components/AIChat';
import { Header } from '@/components/Header';
import { DetailsPanel } from '@/components/DetailsPanel';
import { BatchEditPanel } from '@/components/BatchEditPanel';
import { StagingPanel } from '@/components/StagingPanel';
import { ContextMenu, ContextMenuItem } from '@/components/ContextMenu';
import { WalletForm } from '@/components/WalletForm';
import { TransactionForm } from '@/components/TransactionForm';
import { LinkInputModal, type LinkInputResult } from '@/components/LinkInputModal';
import { WalletNode, TransactionEdge, Trace, Investigation } from '@/types/investigation';
import { useInvestigation } from '@/hooks/useInvestigation';
import { CytoscapeCallbacks } from '@/hooks/useCytoscape';
import { apiClient, type Investigation as ApiInvestigation, type ScriptRun } from '@/lib/api-client';
import { buildExplorerUrl, parseAddressInput } from '@/utils/addressParser';

type PanelMode =
  | { type: 'none' }
  | { type: 'linkInput'; intent: 'address' | 'transaction'; position?: { x: number; y: number } }
  | { type: 'createWallet'; position?: { x: number; y: number }; prefill?: Partial<WalletNode> }
  | { type: 'createTransaction'; prefill?: Partial<TransactionEdge> };

export default function AppShell() {
  const [activeInvestigationId, setActiveInvestigationId] = useState<string | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);

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
  } = useInvestigation(null);

  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<{ id: string; traceId: string }[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>({ type: 'none' });
  const [stagedItems, setStagedItems] = useState<TransactionEdge[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scriptRuns, setScriptRuns] = useState<ScriptRun[]>([]);

  // Load investigation from backend when selection changes
  const loadInvestigationFromApi = useCallback(async (id: string) => {
    setLoading(true);
    setSelectedItem(null);
    setStagedItems([]);
    try {
      const inv = await apiClient.getInvestigation(id);
      const clientInv: Investigation = {
        id: inv.id,
        name: inv.name,
        description: inv.notes || '',
        createdAt: inv.createdAt,
        traces: (inv.traces || []).map((t) => ({
          id: t.id,
          name: t.name,
          criteria: (t.data as any)?.criteria || { type: 'custom' as const },
          visible: t.visible,
          collapsed: t.collapsed,
          color: t.color || undefined,
          nodes: ((t.data as any)?.nodes || []).map((n: any) => {
            // Fix legacy nodes where address field contains a full explorer URL
            const parsed = parseAddressInput(n.address);
            const address = parsed.chain ? parsed.address : n.address;
            const chain = parsed.chain || n.chain;
            return {
              ...n,
              address,
              chain,
              explorerUrl: n.explorerUrl || parsed.explorerUrl || buildExplorerUrl(chain, address),
              addressType: n.addressType || 'unknown',
            };
          }),
          edges: (t.data as any)?.edges || [],
          position: (t.data as any)?.position || { x: 0, y: 0 },
        })),
        metadata: {},
      };
      setInvestigation(clientInv);
    } catch (err) {
      console.error('Failed to load investigation:', err);
    } finally {
      setLoading(false);
    }
  }, [setInvestigation]);

  useEffect(() => {
    if (activeInvestigationId) {
      loadInvestigationFromApi(activeInvestigationId);
      apiClient.listScriptRuns(activeInvestigationId).then(setScriptRuns).catch(console.error);
    } else {
      setInvestigation(null);
      setScriptRuns([]);
    }
  }, [activeInvestigationId, loadInvestigationFromApi, setInvestigation]);

  // Refresh script runs periodically while an investigation is active
  // (the AI might create new runs in the background via chat)
  useEffect(() => {
    if (!activeInvestigationId) return;
    const interval = setInterval(() => {
      apiClient.listScriptRuns(activeInvestigationId).then(setScriptRuns).catch(console.error);
    }, 10_000);
    return () => clearInterval(interval);
  }, [activeInvestigationId]);

  // Auto-save traces to backend
  const saveTimeoutRef = useMemo(() => ({ current: null as ReturnType<typeof setTimeout> | null }), []);
  useEffect(() => {
    if (!investigation || loading) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        for (const trace of investigation.traces) {
          const traceData = {
            criteria: trace.criteria,
            nodes: trace.nodes,
            edges: trace.edges,
            position: trace.position,
          };
          await apiClient.updateTrace(trace.id, {
            name: trace.name,
            color: trace.color || null,
            visible: trace.visible,
            collapsed: trace.collapsed,
            data: traceData,
          });
        }
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, 1000);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [investigation, loading, saveTimeoutRef]);

  const allWallets = useMemo(() => {
    if (!investigation) return [];
    return investigation.traces.flatMap((t) =>
      t.nodes.map((wallet) => ({ wallet, traceId: t.id }))
    );
  }, [investigation]);

  // Re-derive selectedItem after investigation changes
  useEffect(() => {
    if (!selectedItem || !investigation) return;
    const { type, data } = selectedItem;
    if (type === 'wallet' && data) {
      for (const trace of investigation.traces) {
        const found = trace.nodes.find((n: WalletNode) => n.id === data.id);
        if (found) { setSelectedItem({ type: 'wallet', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'transaction' && data) {
      for (const trace of investigation.traces) {
        const found = trace.edges.find((e: TransactionEdge) => e.id === data.id);
        if (found) { setSelectedItem({ type: 'transaction', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'trace' && data) {
      const found = investigation.traces.find((t) => t.id === data.id);
      if (found) setSelectedItem({ type: 'trace', data: found });
      else setSelectedItem(null);
    }
  }, [investigation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sidebar callback
  const handleSelectInvestigation = useCallback((inv: ApiInvestigation) => {
    setActiveInvestigationId(inv.id);
    setActiveCaseId(inv.caseId);
  }, []);

  // Trace operations — returns the new trace ID (used by inline create in WalletForm)
  const handleAddTrace = useCallback(async (): Promise<string | undefined> => {
    if (!activeInvestigationId) return undefined;
    const colors = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308', '#ef4444'];
    const color = colors[(investigation?.traces.length || 0) % colors.length];
    const name = `Trace ${(investigation?.traces.length || 0) + 1}`;

    try {
      const created = await apiClient.createTrace(activeInvestigationId, { name, color });
      const trace: Trace = {
        id: created.id,
        name: created.name,
        criteria: { type: 'custom' },
        visible: true,
        collapsed: false,
        color,
        nodes: [],
        edges: [],
        position: { x: 0, y: 0 },
      };
      addTrace(trace);
      setSelectedItem({ type: 'trace', data: trace });
      return trace.id;
    } catch (err) {
      console.error('Failed to create trace:', err);
      return undefined;
    }
  }, [addTrace, investigation?.traces.length, activeInvestigationId]);

  const handleSelectTrace = useCallback((trace: Trace) => {
    setSelectedItem({ type: 'trace', data: trace });
  }, []);

  const handleSelectScriptRun = useCallback((run: ScriptRun) => {
    setSelectedItem({ type: 'scriptRun', data: run });
  }, []);

  const handleAddWallet = useCallback(() => {
    setPanelMode({ type: 'linkInput', intent: 'address' });
  }, []);

  const handleCreateWalletAtPosition = useCallback((position: { x: number; y: number }) => {
    setPanelMode({ type: 'linkInput', intent: 'address', position });
  }, []);

  const handleSaveNewWallet = useCallback(
    (traceId: string, data: Partial<WalletNode>) => {
      const position = panelMode.type === 'createWallet' && panelMode.position
        ? panelMode.position
        : { x: Math.random() * 400, y: Math.random() * 400 };

      const addr = data.address || '';
      const ch = data.chain || 'ethereum';
      const wallet: WalletNode = {
        id: crypto.randomUUID(),
        label: data.label || 'New Node',
        address: addr,
        chain: ch,
        color: data.color || '#60a5fa',
        size: data.size,
        notes: data.notes || '',
        tags: data.tags || [],
        position,
        parentTrace: traceId,
        addressType: addr ? 'unknown' : undefined,
        explorerUrl: addr ? buildExplorerUrl(ch, addr) : undefined,
      };
      addWallet(traceId, wallet);
      setPanelMode({ type: 'none' });
      setSelectedItem({ type: 'wallet', data: wallet });

      // Look up address info in the background
      if (addr) {
        apiClient.getAddressInfo(addr, ch).then((info) => {
          updateWallet(traceId, wallet.id, { addressType: info.addressType });
        }).catch(() => {});
      }
    },
    [addWallet, updateWallet, panelMode]
  );

  const handleAddTransaction = useCallback(() => {
    setPanelMode({ type: 'linkInput', intent: 'transaction' });
  }, []);

  /** Find an existing wallet by address or create one in the given trace */
  const findOrCreateWallet = useCallback(
    (address: string, chain: string, traceId: string): string => {
      // Check existing wallets
      const existing = allWallets.find(
        (w) => w.wallet.address.toLowerCase() === address.toLowerCase()
      );
      if (existing) return existing.wallet.id;

      // Create new wallet
      const walletId = crypto.randomUUID();
      const wallet: WalletNode = {
        id: walletId,
        label: address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address,
        address,
        chain,
        notes: '',
        tags: [],
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        parentTrace: traceId,
        addressType: 'unknown',
        explorerUrl: buildExplorerUrl(chain, address),
      };
      addWallet(traceId, wallet);

      // Look up address info in the background and update the wallet
      apiClient.getAddressInfo(address, chain).then((info) => {
        updateWallet(traceId, walletId, { addressType: info.addressType });
      }).catch(() => {
        // Address info unavailable — keep as unknown
      });

      return wallet.id;
    },
    [allWallets, addWallet, updateWallet]
  );

  const handleSaveNewTransaction = useCallback(
    (traceId: string, data: Partial<TransactionEdge>) => {
      const ch = data.chain || 'ethereum';

      // from/to may be wallet IDs or raw addresses — resolve them
      let fromId = data.from || '';
      let toId = data.to || '';
      const isExistingWallet = (val: string) =>
        allWallets.some((w) => w.wallet.id === val || w.wallet.address.toLowerCase() === val.toLowerCase());
      if (fromId && !isExistingWallet(fromId)) {
        fromId = findOrCreateWallet(fromId, ch, traceId);
      }
      if (toId && !isExistingWallet(toId)) {
        toId = findOrCreateWallet(toId, ch, traceId);
      }

      const fromTrace = allWallets.find((w) => w.wallet.id === fromId)?.traceId;
      const toTrace = allWallets.find((w) => w.wallet.id === toId)?.traceId;
      const crossTrace = !!(fromTrace && toTrace && fromTrace !== toTrace);

      const transaction: TransactionEdge = {
        id: crypto.randomUUID(),
        from: fromId,
        to: toId,
        txHash: data.txHash || '0x',
        chain: ch,
        timestamp: data.timestamp || new Date().toISOString(),
        amount: data.amount || '0',
        token: data.token || { address: '0x', symbol: 'ETH', decimals: 18 },
        usdValue: data.usdValue,
        color: data.color || '#10b981',
        label: data.label || '',
        notes: data.notes || '',
        tags: data.tags || [],
        blockNumber: data.blockNumber || 0,
        crossTrace,
      };
      addTransaction(traceId, transaction);
      setPanelMode({ type: 'none' });
      setSelectedItem({ type: 'transaction', data: transaction });
    },
    [addTransaction, allWallets, findOrCreateWallet]
  );

  const handleFetchHistory = useCallback(async (address: string, chain: string) => {
    setFetchLoading(true);
    try {
      const result = await apiClient.fetchHistory(address, chain);
      setStagedItems((prev) => [...prev, ...result.transactions]);
    } catch (err) {
      console.error('Fetch failed:', err);
      alert(`Failed to fetch history: ${err}`);
    } finally {
      setFetchLoading(false);
    }
  }, []);

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

        const fromId = existingWalletAddresses.get(tx.from.toLowerCase()) || tx.from;
        const toId = existingWalletAddresses.get(tx.to.toLowerCase()) || tx.to;

        addTransaction(traceId, { ...tx, id: crypto.randomUUID(), from: fromId, to: toId });
        existingTxHashes.add(key);
      }

      const selectedIds = new Set(selected.map((s) => s.id));
      setStagedItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    },
    [investigation, addWallet, addTransaction]
  );

  // Batch edit handlers for multi-select
  const handleBatchRename = useCallback((prefix: string) => {
    selectedNodeIds.forEach(({ id, traceId }, i) => {
      updateWallet(traceId, id, { label: `${prefix} ${i + 1}` });
    });
    setSelectedNodeIds([]);
  }, [selectedNodeIds, updateWallet]);

  const handleBatchRecolor = useCallback((color: string) => {
    selectedNodeIds.forEach(({ id, traceId }) => {
      updateWallet(traceId, id, { color });
    });
    setSelectedNodeIds([]);
  }, [selectedNodeIds, updateWallet]);

  const handleBatchDelete = useCallback(() => {
    selectedNodeIds.forEach(({ id, traceId }) => {
      deleteWallet(traceId, id);
    });
    setSelectedNodeIds([]);
  }, [selectedNodeIds, deleteWallet]);

  const handleContextMenu = useCallback(
    (event: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number }) => {
      if (!investigation) return;

      const items: ContextMenuItem[] = [];

      if (event.type === 'node' && event.id) {
        const trace = investigation.traces.find((t) => t.id === event.id);
        if (trace) {
          items.push(
            { label: 'Edit Trace', onClick: () => setSelectedItem({ type: 'trace', data: trace }) },
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
              { label: 'Edit Address', onClick: () => setSelectedItem({ type: 'wallet', data: walletData!.wallet }) },
              { label: 'Fetch History', onClick: () => handleFetchHistory(walletData!.wallet.address, walletData!.wallet.chain) },
              { label: 'Delete Address', onClick: () => deleteWallet(walletData!.traceId, walletData!.wallet.id), danger: true }
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
            { label: 'Delete Transaction', onClick: () => deleteTransaction(txData!.traceId, txData!.tx.id), danger: true }
          );
        }
      } else if (event.type === 'background') {
        items.push(
          { label: 'Add Address Here', onClick: () => handleCreateWalletAtPosition({ x: event.x, y: event.y }) },
          { label: 'Add Trace', onClick: handleAddTrace }
        );
      }

      if (items.length > 0) {
        setContextMenu({ x: event.x, y: event.y, items });
      }
    },
    [investigation, toggleTraceVisibility, toggleTraceCollapsed, deleteTrace, deleteWallet, deleteTransaction, handleFetchHistory, handleCreateWalletAtPosition, handleAddTrace]
  );

  const cytoscapeCallbacks: CytoscapeCallbacks = useMemo(
    () => ({
      onSelectItem: (item: any) => {
        setSelectedItem(item);
        setSelectedNodeIds([]);
      },
      onMultiSelect: (nodes) => {
        setSelectedNodeIds(nodes);
        setSelectedItem(null);
      },
      onNodeDrag: updateNodePosition,
      onContextMenu: handleContextMenu,
      onDoubleClickBackground: handleCreateWalletAtPosition,
    }),
    [updateNodePosition, handleContextMenu, handleCreateWalletAtPosition]
  );

  const selectedTraceId = selectedItem?.type === 'trace' ? selectedItem.data?.id : undefined;

  const handleLinkResolved = useCallback((result: LinkInputResult, position?: { x: number; y: number }) => {
    if (result.type === 'transaction' && result.txPrefill) {
      setPanelMode({ type: 'createTransaction', prefill: result.txPrefill });
    } else if (result.addressPrefill) {
      setPanelMode({ type: 'createWallet', position, prefill: result.addressPrefill });
    }
  }, []);

  const renderCreationPanel = () => {
    if (!investigation) return null;

    if (panelMode.type === 'linkInput') {
      return (
        <LinkInputModal
          intent={panelMode.intent}
          onResolved={(result) => handleLinkResolved(result, panelMode.position)}
          onSkip={() => {
            if (panelMode.intent === 'transaction') {
              setPanelMode({ type: 'createTransaction' });
            } else {
              setPanelMode({ type: 'createWallet', position: panelMode.position });
            }
          }}
          onCancel={() => setPanelMode({ type: 'none' })}
        />
      );
    }

    if (panelMode.type === 'createWallet') {
      return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40">
          <div className="bg-gray-800 rounded-lg p-6 w-96 max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">New Address</h3>
            <WalletForm
              traces={investigation.traces}
              selectedTraceId={investigation.traces[0]?.id}
              onSave={handleSaveNewWallet}
              onCancel={() => setPanelMode({ type: 'none' })}
              onCreateTrace={handleAddTrace}
              prefill={panelMode.prefill}
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
              onCreateTrace={handleAddTrace}
              prefill={panelMode.prefill}
            />
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="h-screen flex bg-gray-900 text-white">
      <Sidebar
        activeInvestigationId={activeInvestigationId}
        onSelectInvestigation={handleSelectInvestigation}
        traces={investigation?.traces}
        selectedTraceId={selectedTraceId}
        onAddTrace={handleAddTrace}
        onSelectTrace={handleSelectTrace}
        onToggleVisibility={toggleTraceVisibility}
        onToggleCollapsed={toggleTraceCollapsed}
        scriptRuns={scriptRuns}
        selectedScriptRunId={selectedItem?.type === 'scriptRun' ? selectedItem.data?.id : undefined}
        onSelectScriptRun={handleSelectScriptRun}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {investigation ? (
          <>
            <Header
              investigation={investigation}
              onAddAddress={handleAddWallet}
              onAddTransaction={handleAddTransaction}
            />
            <div className="flex-1 bg-gray-900 relative overflow-hidden">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-400">Loading...</p>
                  </div>
                ) : (
                  <GraphCanvas
                    investigation={investigation}
                    callbacks={cytoscapeCallbacks}
                  />
                )}

                {/* Batch edit floating panel */}
                {selectedNodeIds.length >= 2 && (
                  <div className="absolute bottom-4 left-4 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl max-h-[60vh] flex flex-col z-20">
                    <BatchEditPanel
                      count={selectedNodeIds.length}
                      onRename={handleBatchRename}
                      onRecolor={handleBatchRecolor}
                      onDelete={handleBatchDelete}
                      onDeselect={() => setSelectedNodeIds([])}
                    />
                  </div>
                )}

                {/* Details floating panel */}
                {selectedItem && selectedNodeIds.length < 2 && (
                  <div className="absolute bottom-4 left-4 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl max-h-[60vh] flex flex-col z-20">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
                      <span className="text-xs font-semibold text-gray-400 uppercase">
                        {selectedItem.type === 'wallet' ? 'Address'
                          : selectedItem.type === 'scriptRun' ? 'Script'
                          : selectedItem.type} Details
                      </span>
                      <button
                        onClick={() => setSelectedItem(null)}
                        className="text-gray-500 hover:text-white text-sm leading-none"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="overflow-y-auto">
                      <DetailsPanel
                        selectedItem={selectedItem}
                        traces={investigation.traces}
                        allWallets={allWallets}
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
                        fetchLoading={fetchLoading}
                      />
                    </div>
                  </div>
                )}

                {/* Staging floating panel */}
                {stagedItems.length > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 z-20">
                    <StagingPanel
                      items={stagedItems}
                      traces={investigation.traces}
                      onAddToTrace={handleAddStagedToTrace}
                      onClear={() => setStagedItems([])}
                    />
                  </div>
                )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2">Daubert</h2>
              <p className="text-gray-500">Select or create an investigation to begin</p>
            </div>
          </div>
        )}
      </div>

      <AIChat
        activeCaseId={activeCaseId}
        activeInvestigationId={activeInvestigationId}
        onGraphUpdated={() => {
          if (activeInvestigationId) loadInvestigationFromApi(activeInvestigationId);
        }}
      />

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
