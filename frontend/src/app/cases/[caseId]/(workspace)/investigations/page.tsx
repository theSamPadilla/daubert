'use client';

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import { useInvestigationUrlSync } from '@/hooks/useInvestigationUrlSync';
import { useInvestigationLoader } from '@/hooks/useInvestigationLoader';
import { useSelectedItem } from '@/hooks/useSelectedItem';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/Graph/GraphCanvas';
import { useCaseContext } from '@/contexts/CaseContext';
import { PageHeader } from '@/components/Common/PageHeader';
import { SelectionDetailsPanel } from '@/components/Graph/SelectionDetailsPanel';
import { BatchEditPanel } from '@/components/Graph/BatchEditPanel';
import { EdgeBatchPanel } from '@/components/Graph/EdgeBatchPanel';
import { ContextMenu, ContextMenuItem } from '@/components/Graph/ContextMenu';
import { CanvasToolPill } from '@/components/Graph/CanvasToolPill';
import { CreationPanels } from '@/components/Graph/CreationPanels';
import { ExportModal } from '@/components/Common/ExportModal';
import { ErrorModal } from '@/components/Common/ErrorModal';
import { WorkspaceModals } from '@/components/Workspace/WorkspaceModals';
import { WorkspaceEmptyState } from '@/components/Workspace/WorkspaceEmptyState';
import { FaMagnifyingGlass, FaDownload } from 'react-icons/fa6';
import { QuickAddInput } from '@/components/Graph/QuickAddInput';
import { TransactionEdge, Trace } from '@/types/investigation';
import { useInvestigation } from '@/hooks/useInvestigation';
import { useEdgeBundling } from '@/hooks/useEdgeBundling';
import { useBatchNodeOps } from '@/hooks/useBatchNodeOps';
import { type Investigation as ApiInvestigation, type ScriptRun } from '@/lib/api-client';
import type { ExportTheme } from '@/lib/exportTheme';
import { resolveFocusItem } from '@/utils/focusItem';
import UserMenu from '@/components/Auth/UserMenu';
import { Loader } from '@/components/Common/Loader';
import type { PanelMode } from '@/types/panel';
import { useWalletTransactionAuthoring } from '@/hooks/useWalletTransactionAuthoring';
import { useGraphContextMenu } from '@/hooks/useGraphContextMenu';

function InvestigationsWorkspace() {
  const { caseId, activeInvestigationId, selectInvestigation, clearInvestigation } = useInvestigationUrlSync();

  const {
    investigation,
    setInvestigation,
    canUndo,
    undo,
    canRedo,
    redo,
    addTrace,
    updateTrace,
    deleteTrace,
    toggleTraceVisibility,
    toggleTraceCollapsed,
    addWallet,
    updateWallet,
    deleteWallet,
    deleteOutboundEdges,
    deleteInboundEdges,
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
    addLabel,
    updateLabel,
    deleteLabel,
    moveLabel,
  } = useInvestigation(null);

  const { selectedItem, setSelectedItem, clearSelection } = useSelectedItem(investigation);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const graphRef = useRef<GraphCanvasHandle>(null);
  const previewGenerate = useCallback(async (theme: ExportTheme) => {
    if (!graphRef.current) throw new Error('Graph not ready');
    return graphRef.current.exportPngDataUrl(theme);
  }, []); // graphRef.current is a ref, not a dep
  const [editingInvestigation, setEditingInvestigation] = useState<ApiInvestigation | null>(null);
  const [deletingInvestigation, setDeletingInvestigation] = useState<ApiInvestigation | null>(null);
  const [fetchModalWallet, setFetchModalWallet] = useState<{ address: string; chain: string } | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<{ id: string; traceId: string }[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>({ type: 'none' });
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [stagedItems, setStagedItems] = useState<TransactionEdge[]>([]);
  const { updateSidebar, reloadInvestigations, viewerRole } = useCaseContext();
  const canMutate = viewerRole === 'owner' || viewerRole === 'editor';

  const { loading, scriptRuns, reloadCurrent, refreshScriptRuns } = useInvestigationLoader({
    activeInvestigationId,
    investigation,
    setInvestigation,
    onBeforeLoad: () => {
      setSelectedItem(null);
      setStagedItems([]);
    },
  });

  const allWallets = useMemo(() => {
    if (!investigation) return [];
    return investigation.traces.flatMap((t) =>
      t.nodes.map((wallet) => ({ wallet, traceId: t.id }))
    );
  }, [investigation]);

  const handleSelectTrace = useCallback((trace: Trace) => {
    setSelectedItem({ type: 'trace', data: trace });
  }, []);

  const handleSelectScriptRun = useCallback((run: ScriptRun) => {
    setSelectedItem({ type: 'scriptRun', data: run });
  }, []);

  const selectedTraceId = selectedItem?.type === 'trace' ? selectedItem.data?.id : undefined;
  const selectedScriptRunId = selectedItem?.type === 'scriptRun' ? selectedItem.data?.id : undefined;

  const handleFetchHistory = useCallback((address: string, chain: string) => {
    setFetchModalWallet({ address, chain });
  }, []);

  const {
    handleAddTrace,
    handleCreateWalletAtPosition,
    handleContextMenu,
    handleLabelContextMenu,
    cytoscapeCallbacks,
  } = useGraphContextMenu({
    investigation, activeInvestigationId, graphRef,
    addTrace, updateNodePosition, updateWallet, updateGroup,
    deleteWallet, deleteTransaction, toggleTraceVisibility, toggleTraceCollapsed,
    addLabel, deleteLabel,
    setSelectedItem, setSelectedNodeIds, setSelectedEdgeIds, setPanelMode,
    // Viewers see no context menu — mutation items would always 403
    setContextMenu: canMutate ? setContextMenu : () => {},
    onFetchHistory: handleFetchHistory,
    resolveFocusItem,
  });

  // Push data to the shared sidebar via CaseContext.
  // Every value referenced in the effect body must be in the deps array — without
  // them, the effect runs every render, and updateSidebar always creates a new
  // sidebar object, which re-renders the provider and re-runs this effect (loop).
  useEffect(() => {
    updateSidebar({
      activeInvestigationId,
      traces: investigation?.traces,
      selectedTraceId,
      onAddTrace: handleAddTrace,
      onSelectTrace: handleSelectTrace,
      onToggleVisibility: toggleTraceVisibility,
      onToggleCollapsed: toggleTraceCollapsed,
      scriptRuns,
      selectedScriptRunId,
      onSelectScriptRun: handleSelectScriptRun,
      onEditInvestigation: setEditingInvestigation,
    });
  }, [
    updateSidebar,
    activeInvestigationId,
    investigation?.traces,
    selectedTraceId,
    handleAddTrace,
    handleSelectTrace,
    toggleTraceVisibility,
    toggleTraceCollapsed,
    scriptRuns,
    selectedScriptRunId,
    handleSelectScriptRun,
  ]);

  const {
    handleSaveNewWallet,
    handleSaveNewTransaction,
    handleAddStagedToTrace,
  } = useWalletTransactionAuthoring({
    investigation, allWallets, panelMode, setPanelMode, setSelectedItem,
    setStagedItems, addWallet, updateWallet, addTransaction,
  });

  const {
    handleBatchRename,
    handleBatchRecolor,
    handleBatchDelete,
    handleGroupNodes,
    selectedGroupEntry,
    handleAddToGroup,
    handleExtractToTrace,
  } = useBatchNodeOps({
    investigation,
    activeInvestigationId,
    selectedNodeIds,
    setSelectedNodeIds,
    updateWallet,
    deleteWallet,
    createGroup,
    setNodeGroup,
    extractToTrace,
  });

  const {
    handleBundleEdges,
    handleBundleAllOutbound,
    handleBundleAllInbound,
    handleDeleteAllOutbound,
    handleDeleteAllInbound,
  } = useEdgeBundling({
    investigation,
    selectedEdgeIds,
    setSelectedEdgeIds,
    addEdgeBundle,
    deleteEdgeBundle,
    updateTransaction,
    deleteOutboundEdges,
    deleteInboundEdges,
  });

  return (
    <>
      {investigation ? (
        <>
          <PageHeader
            eyebrow="Investigation"
            title={investigation.name || 'Daubert'}
            actions={
              <button
                onClick={() => setExportModalOpen(true)}
                className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                <FaDownload size={11} /> Export
              </button>
            }
            rightContent={<UserMenu />}
          />
          <div className="flex-1 bg-surface relative overflow-hidden">
            {investigation && (
              <CanvasToolPill
                onRefresh={reloadCurrent}
                onUndo={canMutate ? undo : () => {}}
                canUndo={canMutate && canUndo}
                onRedo={canMutate ? redo : () => {}}
                canRedo={canMutate && canRedo}
              />
            )}
            {investigation && (
              <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
                {investigation.traces.length > 0 && (
                  <button
                    onClick={() => setSearchOpen(true)}
                    title="Find transactions between wallets"
                    className="bg-surface-panel/90 border border-line-strong rounded-full shadow-lg flex items-center gap-1.5 px-3 py-1.5 text-ink-muted hover:text-ink hover:bg-surface-raised transition-colors text-xs"
                  >
                    <FaMagnifyingGlass size={11} />
                    Search
                  </button>
                )}
                {canMutate && (
                  <QuickAddInput
                    investigationId={investigation.id}
                    onResolveAddress={(prefill) => setPanelMode({ type: 'createWallet', prefill })}
                    onResolveTransaction={(prefill) => setPanelMode({ type: 'createTransaction', prefill })}
                  />
                )}
              </div>
            )}
            {loading ? (
              <Loader inline />
            ) : (
              <GraphCanvas
                ref={graphRef}
                investigation={investigation}
                selectedNodeIds={selectedNodeIds}
                selectedEdgeIds={selectedEdgeIds}
                callbacks={cytoscapeCallbacks}
                labelCallbacks={{ addLabel, updateLabel, deleteLabel, moveLabel }}
                onLabelContextMenu={handleLabelContextMenu}
              />
            )}

            {canMutate && (selectedNodeIds.length >= 2 || selectedEdgeIds.length >= 2) && (
              <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-20">
                {selectedNodeIds.length >= 2 && (
                  <div className="w-80 bg-surface-panel border border-line-strong rounded-lg shadow-2xl max-h-[60vh] flex flex-col">
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
                  <div className="w-80 bg-surface-panel border border-line-strong rounded-lg shadow-2xl">
                    <EdgeBatchPanel
                      count={selectedEdgeIds.length}
                      onBundle={handleBundleEdges}
                      onDeselect={() => setSelectedEdgeIds([])}
                    />
                  </div>
                )}
              </div>
            )}

            {selectedItem && selectedNodeIds.length < 2 && selectedEdgeIds.length < 2 && (
              <SelectionDetailsPanel
                selectedItem={selectedItem}
                setSelectedItem={setSelectedItem}
                investigation={investigation}
                allWallets={allWallets}
                graphRef={graphRef}
                activeInvestigationId={activeInvestigationId}
                updateWallet={canMutate ? updateWallet : () => {}}
                deleteWallet={canMutate ? deleteWallet : () => {}}
                updateTransaction={canMutate ? updateTransaction : () => {}}
                deleteTransaction={canMutate ? deleteTransaction : () => {}}
                updateTrace={canMutate ? updateTrace : () => {}}
                deleteTrace={canMutate ? deleteTrace : () => {}}
                updateGroup={canMutate ? updateGroup : () => {}}
                deleteGroup={canMutate ? deleteGroup : () => {}}
                setNodeGroup={canMutate ? setNodeGroup : () => {}}
                toggleEdgeBundle={canMutate ? toggleEdgeBundle : () => {}}
                updateEdgeBundle={canMutate ? updateEdgeBundle : () => {}}
                deleteEdgeBundle={canMutate ? deleteEdgeBundle : () => {}}
                onFetchHistory={handleFetchHistory}
                onBundleAllOutbound={canMutate ? handleBundleAllOutbound : () => {}}
                onDeleteAllOutbound={canMutate ? handleDeleteAllOutbound : () => {}}
                onBundleAllInbound={canMutate ? handleBundleAllInbound : () => {}}
                onDeleteAllInbound={canMutate ? handleDeleteAllInbound : () => {}}
                onRefreshScriptRuns={refreshScriptRuns}
                canMutate={canMutate}
              />
            )}

            <WorkspaceModals
              caseId={caseId}
              investigation={investigation}
              editingInvestigation={editingInvestigation}
              setEditingInvestigation={setEditingInvestigation}
              deletingInvestigation={deletingInvestigation}
              setDeletingInvestigation={setDeletingInvestigation}
              activeInvestigationId={activeInvestigationId}
              clearInvestigation={clearInvestigation}
              reloadInvestigations={reloadInvestigations}
              selectInvestigation={selectInvestigation}
              searchOpen={searchOpen}
              setSearchOpen={setSearchOpen}
              selectedTraceId={selectedTraceId}
              fetchModalWallet={fetchModalWallet}
              setFetchModalWallet={setFetchModalWallet}
              onAddStagedToTrace={handleAddStagedToTrace}
              stagedItems={stagedItems}
              setStagedItems={setStagedItems}
            />
          </div>
        </>
      ) : (
        <WorkspaceEmptyState />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {canMutate && investigation && (
        <CreationPanels
          panelMode={panelMode}
          investigation={investigation}
          allWallets={allWallets}
          onSaveWallet={handleSaveNewWallet}
          onSaveTransaction={handleSaveNewTransaction}
          onCancel={() => setPanelMode({ type: 'none' })}
          onCreateTrace={handleAddTrace}
        />
      )}

      <ExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        kind="graph"
        defaultFilename={investigation?.name ?? 'graph'}
        previewGenerate={previewGenerate}
        onExport={async (format, filename, theme, renderOpts) => {
          if (format !== 'png' && format !== 'pdf') return;
          try {
            await graphRef.current?.exportImage(format, filename, theme, renderOpts.orientation);
          } catch (err) {
            setExportError(err instanceof Error ? err.message : 'Export failed');
          }
        }}
      />

      <ErrorModal
        open={!!exportError}
        title="Export Failed"
        message={exportError ?? ''}
        onClose={() => setExportError(null)}
      />
    </>
  );
}

export default function InvestigationsPage() {
  return (
    <Suspense fallback={null}>
      <InvestigationsWorkspace />
    </Suspense>
  );
}
