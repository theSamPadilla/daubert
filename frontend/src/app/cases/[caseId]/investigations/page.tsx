'use client';

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa6';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { InvestigationsSidebar } from '@/components/InvestigationsSidebar';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/GraphCanvas';
import { AIChat } from '@/components/AIChat';
import { Header } from '@/components/Header';
import { DetailsPanel, type DetailsPanelHandle } from '@/components/DetailsPanel';
import { FloatingPanel } from '@/components/FloatingPanel';
import { InvestigationForm } from '@/components/InvestigationForm';
import { FetchModal } from '@/components/FetchModal';
import { BatchEditPanel } from '@/components/BatchEditPanel';
import { EdgeBatchPanel } from '@/components/EdgeBatchPanel';
import { StagingPanel } from '@/components/StagingPanel';
import { ContextMenu, ContextMenuItem } from '@/components/ContextMenu';
import { WalletForm } from '@/components/WalletForm';
import { TransactionForm } from '@/components/TransactionForm';
import { LinkInputModal, type LinkInputResult } from '@/components/LinkInputModal';
import { WalletNode, TransactionEdge, Trace, Investigation, Group, EdgeBundle } from '@/types/investigation';
import { useInvestigation } from '@/hooks/useInvestigation';
import { CytoscapeCallbacks } from '@/hooks/useCytoscape';
import { apiClient, type Investigation as ApiInvestigation, type ScriptRun, type Production } from '@/lib/api-client';
import { ProductionViewer } from '@/components/ProductionViewer';
import { buildExplorerUrl, parseAddressInput } from '@/utils/addressParser';
import { normalizeToken } from '@/utils/formatAmount';
import UserMenu from '@/components/UserMenu';

type PanelMode =
  | { type: 'none' }
  | { type: 'linkInput'; intent: 'address' | 'transaction'; position?: { x: number; y: number } }
  | { type: 'createWallet'; position?: { x: number; y: number }; prefill?: Partial<WalletNode> }
  | { type: 'createTransaction'; prefill?: Partial<TransactionEdge> };

const EDIT_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

const TRASH_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
);

const PRESET_COLORS = [
  '#3b82f6', '#06b6d4', '#10b981', '#22c55e',
  '#ef4444', '#f97316', '#eab308', '#f59e0b',
  '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#14b8a6', '#6366f1', '#84cc16', '#fb7185',
  '#94a3b8', '#6b7280', '#78716c', '#ffffff',
];

function ColorPicker({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const customRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-3.5 h-3.5 rounded-full border-2 border-gray-600 hover:border-gray-400 transition-colors shrink-0"
        style={{ backgroundColor: color }}
        title="Change color"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div className="absolute right-0 top-5 z-50 bg-gray-900 border border-gray-700 rounded-lg p-2 shadow-2xl" style={{ width: '116px' }}>
            <div className="grid grid-cols-4 gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => { onChange(c); setOpen(false); }}
                  className="w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: c === color ? '#fff' : 'transparent',
                  }}
                />
              ))}
              <button
                onClick={() => customRef.current?.click()}
                className="w-6 h-6 rounded-full border-2 border-dashed border-gray-600 hover:border-gray-400 flex items-center justify-center text-gray-400 hover:text-white text-xs transition-colors"
                title="Custom color"
              >
                +
              </button>
            </div>
            <input
              ref={customRef}
              type="color"
              value={color}
              onChange={(e) => { onChange(e.target.value); setOpen(false); }}
              className="sr-only"
            />
          </div>
        </>
      )}
    </div>
  );
}

function EditDeleteActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <button onClick={onEdit} title="Edit" className="text-gray-500 hover:text-gray-300 transition-colors">
        {EDIT_ICON}
      </button>
      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <button onClick={() => { onDelete(); setConfirmDelete(false); }}
            className="text-[10px] px-1.5 py-0.5 bg-red-600 hover:bg-red-500 rounded text-white">
            Delete
          </button>
          <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-gray-400 hover:text-white">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirmDelete(true)} title="Delete" className="text-gray-500 hover:text-red-400 transition-colors">
          {TRASH_ICON}
        </button>
      )}
    </div>
  );
}

function TransactionHeaderActions({
  transaction,
  onEdit,
  onDelete,
  onColorChange,
}: {
  transaction: TransactionEdge;
  onEdit: () => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <ColorPicker color={transaction.color || '#10b981'} onChange={onColorChange} />
      <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function WalletHeaderActions({
  wallet,
  onEdit,
  onDelete,
  onColorChange,
}: {
  wallet: WalletNode;
  onEdit: () => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <ColorPicker color={wallet.color || '#60a5fa'} onChange={onColorChange} />
      <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function InvestigationsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const caseId = params.caseId as string;

  const [activeInvestigationId, setActiveInvestigationId] = useState<string | null>(null);

  const {
    investigation,
    setInvestigation,
    canUndo,
    undo,
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
    extractToTrace,
    createGroup,
    updateGroup,
    deleteGroup,
    setNodeGroup,
    addEdgeBundle,
    updateEdgeBundle,
    toggleEdgeBundle,
    deleteEdgeBundle,
  } = useInvestigation(null);

  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const graphRef = useRef<GraphCanvasHandle>(null);
  const detailsPanelRef = useRef<DetailsPanelHandle>(null);
  const [editingInvestigation, setEditingInvestigation] = useState<ApiInvestigation | null>(null);
  const [fetchModalWallet, setFetchModalWallet] = useState<{ address: string; chain: string } | null>(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [selectedNodeIds, setSelectedNodeIds] = useState<{ id: string; traceId: string }[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>({ type: 'none' });
  const [stagedItems, setStagedItems] = useState<TransactionEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [scriptRuns, setScriptRuns] = useState<ScriptRun[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [selectedProduction, setSelectedProduction] = useState<Production | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(480);
  const chatDragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!chatDragRef.current) return;
      const delta = chatDragRef.current.startX - e.clientX;
      setChatWidth(Math.min(900, Math.max(320, chatDragRef.current.startW + delta)));
    };
    const onMouseUp = () => {
      if (chatDragRef.current) {
        chatDragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

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
          groups: (t.data as any)?.groups || [],
          edgeBundles: (t.data as any)?.edgeBundles || [],
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

  // Bootstrap from URL on first render
  useEffect(() => {
    const invId = searchParams.get('inv');
    if (invId) setActiveInvestigationId(invId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeInvestigationId) {
      loadInvestigationFromApi(activeInvestigationId);
      apiClient.listScriptRuns(activeInvestigationId).then(setScriptRuns).catch(console.error);
    } else {
      setInvestigation(null);
      setScriptRuns([]);
    }
  }, [activeInvestigationId, loadInvestigationFromApi, setInvestigation]);

  useEffect(() => {
    apiClient.listProductions(caseId).then(setProductions).catch(() => setProductions([]));
  }, [caseId]);

  // Refresh script runs periodically
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
            groups: trace.groups || [],
            edgeBundles: trace.edgeBundles || [],
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
    } else if (type === 'group' && data) {
      for (const trace of investigation.traces) {
        const found = (trace.groups || []).find((g) => g.id === data.id);
        if (found) { setSelectedItem({ type: 'group', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'edgeBundle' && data) {
      for (const trace of investigation.traces) {
        const found = (trace.edgeBundles || []).find((b) => b.id === data.id);
        if (found) { setSelectedItem({ type: 'edgeBundle', data: found }); return; }
      }
      setSelectedItem(null);
    }
  }, [investigation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sidebar callback
  const handleSelectInvestigation = useCallback((inv: ApiInvestigation) => {
    setActiveInvestigationId(inv.id);
    setSelectedProduction(null);
    router.push(`/cases/${caseId}/investigations?inv=${inv.id}`, { scroll: false });
  }, [router, caseId]);

  // Trace operations
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
    setSelectedProduction(null);
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

      const addr = (data.address || '').toLowerCase();
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

  const findOrCreateWallet = useCallback(
    (address: string, chain: string, traceId: string): string => {
      const existing = allWallets.find(
        (w) => w.wallet.address.toLowerCase() === address.toLowerCase()
      );
      if (existing) return existing.wallet.id;

      const normAddress = address.toLowerCase();
      const walletId = crypto.randomUUID();
      const wallet: WalletNode = {
        id: walletId,
        label: normAddress.length > 10 ? `${normAddress.slice(0, 6)}...${normAddress.slice(-4)}` : normAddress,
        address: normAddress,
        chain,
        notes: '',
        tags: [],
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        parentTrace: traceId,
        addressType: 'unknown',
        explorerUrl: buildExplorerUrl(chain, normAddress),
      };
      addWallet(traceId, wallet);

      apiClient.getAddressInfo(normAddress, chain).then((info) => {
        updateWallet(traceId, walletId, { addressType: info.addressType });
      }).catch(() => {});

      return wallet.id;
    },
    [allWallets, addWallet, updateWallet]
  );

  const handleSaveNewTransaction = useCallback(
    (traceId: string, data: Partial<TransactionEdge>) => {
      const ch = data.chain || 'ethereum';

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

  const handleFetchHistory = useCallback((address: string, chain: string) => {
    setFetchModalWallet({ address, chain });
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

            const normAddr = addr.toLowerCase();
            const wallet: WalletNode = {
              id: crypto.randomUUID(),
              label: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
              address: normAddr,
              chain: tx.chain,
              notes: '',
              tags: [],
              position: { x, y },
              parentTrace: traceId,
            };
            addWallet(traceId, wallet);
            existingWalletAddresses.set(normAddr, wallet.id);
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

  const handleGroupNodes = useCallback((name: string) => {
    if (selectedNodeIds.length < 2) return;
    const traceId = selectedNodeIds[0].traceId;
    const group: Group = {
      id: crypto.randomUUID(),
      name,
      traceId,
    };
    createGroup(traceId, group, selectedNodeIds.map((n) => n.id));
    setSelectedNodeIds([]);
  }, [selectedNodeIds, createGroup]);

  const selectedGroupEntry = useMemo(() => {
    if (!investigation || selectedNodeIds.length < 2) return null;
    for (const { id, traceId } of selectedNodeIds) {
      const trace = investigation.traces.find((t) => t.id === traceId);
      const group = (trace?.groups || []).find((g) => g.id === id);
      if (group) return { group, traceId };
    }
    return null;
  }, [selectedNodeIds, investigation]);

  const handleBundleEdges = useCallback(() => {
    if (!investigation || selectedEdgeIds.length < 2) return;

    const nodeAddr = new Map<string, string>();
    for (const trace of investigation.traces) {
      for (const node of trace.nodes) nodeAddr.set(node.id, node.address);
    }

    const fromBundles = new Set<string>();
    const rawEdgeIds: string[] = [];
    const consumedBundleIds: { traceId: string; bundleId: string }[] = [];
    for (const id of selectedEdgeIds) {
      let found = false;
      for (const trace of investigation.traces) {
        const bundle = (trace.edgeBundles || []).find((b) => b.id === id);
        if (bundle) {
          bundle.edgeIds.forEach((eid) => fromBundles.add(eid));
          consumedBundleIds.push({ traceId: trace.id, bundleId: bundle.id });
          found = true;
          break;
        }
      }
      if (!found) rawEdgeIds.push(id);
    }

    const uniqueEdgeIds = [...new Set([...fromBundles, ...rawEdgeIds])];

    const groups = new Map<string, { fromNodeId: string; toNodeId: string; token: string; edgeIds: string[] }>();
    for (const trace of investigation.traces) {
      for (const edge of trace.edges) {
        if (!uniqueEdgeIds.includes(edge.id)) continue;
        const token = normalizeToken(edge.token).symbol;
        const fromAddr = nodeAddr.get(edge.from) || edge.from;
        const toAddr = nodeAddr.get(edge.to) || edge.to;
        const key = `${fromAddr}::${toAddr}::${token}`;
        if (!groups.has(key)) groups.set(key, { fromNodeId: edge.from, toNodeId: edge.to, token, edgeIds: [] });
        groups.get(key)!.edgeIds.push(edge.id);
      }
    }

    for (const { traceId, bundleId } of consumedBundleIds) {
      deleteEdgeBundle(traceId, bundleId);
    }

    for (const { fromNodeId, toNodeId, token, edgeIds } of groups.values()) {
      if (edgeIds.length < 2) continue;
      let traceId = '';
      for (const t of investigation.traces) {
        if (t.edges.some((e) => e.id === edgeIds[0])) { traceId = t.id; break; }
      }
      if (!traceId) continue;
      const bundle: EdgeBundle = {
        id: crypto.randomUUID(),
        traceId,
        fromNodeId,
        toNodeId,
        token,
        collapsed: true,
        edgeIds,
      };
      addEdgeBundle(traceId, bundle);
    }
    setSelectedEdgeIds([]);
  }, [investigation, selectedEdgeIds, addEdgeBundle, deleteEdgeBundle]);

  const handleAddToGroup = useCallback(() => {
    if (!selectedGroupEntry) return;
    const { group, traceId } = selectedGroupEntry;
    const nodeIds = selectedNodeIds
      .filter(({ id }) => id !== group.id)
      .map(({ id }) => id);
    setNodeGroup(traceId, nodeIds, group.id);
    setSelectedNodeIds([]);
  }, [selectedGroupEntry, selectedNodeIds, setNodeGroup]);

  const handleExtractToTrace = useCallback(async () => {
    if (!activeInvestigationId || selectedNodeIds.length < 2) return;
    const colors = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308', '#ef4444'];
    const color = colors[(investigation?.traces.length || 0) % colors.length];
    const name = `Trace ${(investigation?.traces.length || 0) + 1}`;
    try {
      const created = await apiClient.createTrace(activeInvestigationId, { name, color });
      const newTrace: Trace = {
        id: created.id,
        name: created.name,
        criteria: { type: 'wallet-group' },
        visible: true,
        collapsed: false,
        color,
        nodes: [],
        edges: [],
        position: { x: 0, y: 0 },
      };
      extractToTrace(selectedNodeIds.map((n) => n.id), newTrace);
      setSelectedNodeIds([]);
    } catch (err) {
      console.error('Failed to extract to trace:', err);
    }
  }, [activeInvestigationId, selectedNodeIds, investigation?.traces.length, extractToTrace]);

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
            { label: 'Delete Trace', onClick: () => { apiClient.deleteTrace(trace.id).catch(console.error); deleteTrace(trace.id); }, danger: true }
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
        setSelectedEdgeIds([]);
      },
      onMultiSelect: (nodes) => {
        setSelectedNodeIds(nodes);
        setSelectedItem(null);
        setSelectedEdgeIds([]);
      },
      onMultiSelectEdges: (edgeIds) => {
        setSelectedEdgeIds(edgeIds);
        setSelectedNodeIds([]);
        setSelectedItem(null);
      },
      onNodeDrag: updateNodePosition,
      onGroupDrag: (groupId, newPos) => {
        if (!investigation) return;
        for (const trace of investigation.traces) {
          const group = (trace.groups || []).find((g) => g.id === groupId);
          if (!group) continue;
          const members = trace.nodes.filter((n) => n.groupId === groupId);
          if (members.length === 0) break;
          const oldCx = members.reduce((s, n) => s + n.position.x, 0) / members.length;
          const oldCy = members.reduce((s, n) => s + n.position.y, 0) / members.length;
          const dx = newPos.x - oldCx;
          const dy = newPos.y - oldCy;
          members.forEach((n) => updateNodePosition(n.id, { x: n.position.x + dx, y: n.position.y + dy }));
          break;
        }
      },
      onResizeNode: (nodeId, traceId, size) => {
        const isGroup = investigation?.traces.some(t => (t.groups || []).some(g => g.id === nodeId));
        if (isGroup) updateGroup(traceId, nodeId, { size });
        else updateWallet(traceId, nodeId, { size });
      },
      onContextMenu: handleContextMenu,
      onDoubleClickBackground: handleCreateWalletAtPosition,
    }),
    [updateNodePosition, updateWallet, updateGroup, investigation, handleContextMenu, handleCreateWalletAtPosition]
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
      <div className={`relative flex-shrink-0 transition-all duration-200 ${sidebarOpen ? 'w-60' : 'w-0'} overflow-hidden h-full`}>
        <InvestigationsSidebar
          caseId={caseId}
          activeInvestigationId={activeInvestigationId}
          onSelectInvestigation={handleSelectInvestigation}
          onEditInvestigation={setEditingInvestigation}
          refreshTrigger={sidebarRefresh}
          traces={investigation?.traces}
          selectedTraceId={selectedTraceId}
          onAddTrace={handleAddTrace}
          onSelectTrace={handleSelectTrace}
          onToggleVisibility={toggleTraceVisibility}
          onToggleCollapsed={toggleTraceCollapsed}
          scriptRuns={scriptRuns}
          selectedScriptRunId={selectedItem?.type === 'scriptRun' ? selectedItem.data?.id : undefined}
          onSelectScriptRun={handleSelectScriptRun}
          productions={productions}
          selectedProductionId={selectedProduction?.id}
          onSelectProduction={(p) => setSelectedProduction(p)}
          onAddProduction={async () => {
            const type = window.prompt('Production type (report, chart, chronology):', 'report');
            if (!type || !['report', 'chart', 'chronology'].includes(type)) return;
            const name = window.prompt('Production name:');
            if (!name?.trim()) return;
            const defaultData = type === 'report' ? { content: '' }
              : type === 'chronology' ? { title: name.trim(), entries: [] }
              : { chartType: 'bar', labels: [], datasets: [] };
            try {
              const prod = await apiClient.createProduction(caseId, { name: name.trim(), type, data: defaultData });
              setProductions((prev) => [...prev, prod]);
              setSelectedProduction(prod);
            } catch (err) {
              console.error('Failed to create production:', err);
            }
          }}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {investigation ? (
          <>
            <Header
              investigation={investigation}
              onAddAddress={handleAddWallet}
              onAddTransaction={handleAddTransaction}
              onUndo={undo}
              canUndo={canUndo}
              onRefresh={() => activeInvestigationId && loadInvestigationFromApi(activeInvestigationId)}
              onExport={(format) => graphRef.current?.exportImage(format, investigation?.name || 'graph')}
              rightContent={<UserMenu />}
            />
            <div className="flex-1 bg-gray-900 relative overflow-hidden">
                <button
                  onClick={() => setSidebarOpen((v) => !v)}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-4 h-10 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-r flex items-center justify-center transition-colors"
                  title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                >
                  {sidebarOpen ? <FaChevronLeft size={8} /> : <FaChevronRight size={8} />}
                </button>
                <button
                  onClick={() => setChatOpen((v) => !v)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-30 w-4 h-10 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-l flex items-center justify-center transition-colors"
                  title={chatOpen ? 'Collapse chat' : 'Expand chat'}
                >
                  {chatOpen ? <FaChevronRight size={8} /> : <FaChevronLeft size={8} />}
                </button>
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-400">Loading...</p>
                  </div>
                ) : selectedProduction ? (
                  <ProductionViewer
                    production={selectedProduction}
                    onUpdate={(updated) => {
                      setSelectedProduction(updated);
                      setProductions((prev) => prev.map((p) => p.id === updated.id ? updated : p));
                    }}
                  />
                ) : (
                  <GraphCanvas
                    ref={graphRef}
                    investigation={investigation}
                    callbacks={cytoscapeCallbacks}
                  />
                )}

                {selectedNodeIds.length >= 2 && (
                  <div className="absolute bottom-4 left-4 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl max-h-[60vh] flex flex-col z-20">
                    <BatchEditPanel
                      count={selectedNodeIds.length}
                      onRename={handleBatchRename}
                      onRecolor={handleBatchRecolor}
                      onDelete={handleBatchDelete}
                      onDeselect={() => setSelectedNodeIds([])}
                      onExtractToTrace={handleExtractToTrace}
                      onGroupNodes={
                        !selectedGroupEntry && selectedNodeIds.every((n) => n.traceId === selectedNodeIds[0].traceId)
                          ? handleGroupNodes
                          : undefined
                      }
                      onAddToGroup={
                        selectedGroupEntry
                          ? { groupName: selectedGroupEntry.group.name, onConfirm: handleAddToGroup }
                          : undefined
                      }
                    />
                  </div>
                )}

                {selectedEdgeIds.length >= 2 && (
                  <div className="absolute bottom-4 left-4 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-20">
                    <EdgeBatchPanel
                      count={selectedEdgeIds.length}
                      onBundle={handleBundleEdges}
                      onDeselect={() => setSelectedEdgeIds([])}
                    />
                  </div>
                )}

                {selectedItem && selectedNodeIds.length < 2 && selectedEdgeIds.length < 2 && (
                  <FloatingPanel
                    title={`${selectedItem.type === 'wallet' ? 'Address' : selectedItem.type === 'scriptRun' ? 'Script' : selectedItem.type} Details`}
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
                        apiClient.deleteTrace(traceId).catch(console.error);
                        deleteTrace(traceId);
                        setSelectedItem(null);
                      }}
                      onUpdateGroup={updateGroup}
                      onDeleteGroup={(traceId, groupId) => {
                        deleteGroup(traceId, groupId);
                        setSelectedItem(null);
                      }}
                      onSetNodeGroup={setNodeGroup}
                      onToggleEdgeBundle={toggleEdgeBundle}
                      onUpdateEdgeBundle={updateEdgeBundle}
                      onDeleteEdgeBundle={(traceId, bundleId) => {
                        deleteEdgeBundle(traceId, bundleId);
                        setSelectedItem(null);
                      }}
                      onFetchHistory={handleFetchHistory}
                      onRerunScript={async (scriptRunId) => {
                        await apiClient.rerunScript(scriptRunId);
                        if (activeInvestigationId) {
                          const runs = await apiClient.listScriptRuns(activeInvestigationId);
                          setScriptRuns(runs);
                        }
                      }}
                      onArcEdge={(edgeId, delta) => graphRef.current?.setEdgeArc(edgeId, delta)}
                    />
                  </FloatingPanel>
                )}

                {editingInvestigation && (
                  <FloatingPanel
                    title="Investigation"
                    onClose={() => setEditingInvestigation(null)}
                    className="absolute top-4 left-4"
                  >
                    <InvestigationForm
                      investigation={editingInvestigation}
                      traces={investigation?.id === editingInvestigation.id ? (investigation.traces as any) : undefined}
                      onSave={async (updates) => {
                        await apiClient.updateInvestigation(editingInvestigation.id, updates);
                        setEditingInvestigation(null);
                        setSidebarRefresh((n) => n + 1);
                      }}
                      onDelete={async () => {
                        await apiClient.deleteInvestigation(editingInvestigation.id);
                        setEditingInvestigation(null);
                        setActiveInvestigationId(null);
                        setSidebarRefresh((n) => n + 1);
                      }}
                      onCancel={() => setEditingInvestigation(null)}
                    />
                  </FloatingPanel>
                )}

                {fetchModalWallet && investigation && (
                  <FetchModal
                    initialAddress={fetchModalWallet.address}
                    initialChain={fetchModalWallet.chain}
                    traces={investigation.traces}
                    existingTxKeys={new Set(
                      investigation.traces.flatMap((t) =>
                        t.edges.map((e) => `${e.txHash}-${e.from}-${e.to}`)
                      )
                    )}
                    onAdd={handleAddStagedToTrace}
                    onClose={() => setFetchModalWallet(null)}
                  />
                )}

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

      <div
        className={`relative flex-shrink-0 overflow-hidden h-full ${chatOpen ? '' : 'w-0'}`}
        style={chatOpen ? { width: chatWidth } : undefined}
      >
        {chatOpen && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              chatDragRef.current = { startX: e.clientX, startW: chatWidth };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
        )}
        <AIChat
          activeCaseId={caseId}
          activeInvestigationId={activeInvestigationId}
          onGraphUpdated={() => {
            if (activeInvestigationId) loadInvestigationFromApi(activeInvestigationId);
          }}
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

export default function InvestigationsPage() {
  return (
    <Suspense fallback={null}>
      <InvestigationsWorkspace />
    </Suspense>
  );
}
