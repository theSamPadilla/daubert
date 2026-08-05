'use client';

import { FloatingPanel } from '@/components/Common/FloatingPanel';
import { InvestigationForm } from '@/components/Forms/InvestigationForm';
import { ConfirmDeleteModal } from '@/components/Common/ConfirmDeleteModal';
import { FetchModal } from '@/components/Workspace/FetchModal';
import { StagingPanel } from '@/components/Graph/StagingPanel';
import { SearchPanel } from '@/components/AdvancedSearch/SearchPanel';
import { apiClient, type Investigation as ApiInvestigation } from '@/lib/api-client';
import type { Investigation, TransactionEdge } from '@/types/investigation';
import { edgeIdentityKey } from '../../generated/shared/edge-identity';

interface WorkspaceModalsProps {
  caseId: string;
  investigation: Investigation;

  editingInvestigation: ApiInvestigation | null;
  setEditingInvestigation: (i: ApiInvestigation | null) => void;

  deletingInvestigation: ApiInvestigation | null;
  setDeletingInvestigation: (i: ApiInvestigation | null) => void;

  activeInvestigationId: string | null;
  clearInvestigation: () => void;
  reloadInvestigations: () => void;
  /** Used by the "duplicate" flow to navigate to the new investigation. Thread the same callback that the sidebar uses, NOT a raw router — this keeps URL-sync logic in one place (useInvestigationUrlSync). */
  selectInvestigation: (id: string) => void;

  searchOpen: boolean;
  setSearchOpen: (b: boolean) => void;
  selectedTraceId?: string;

  fetchModalWallet: { address: string; chain: string } | null;
  setFetchModalWallet: (w: { address: string; chain: string } | null) => void;
  onAddStagedToTrace: (traceId: string, selected: TransactionEdge[]) => void;

  stagedItems: TransactionEdge[];
  setStagedItems: (items: TransactionEdge[]) => void;
}

export function WorkspaceModals(props: WorkspaceModalsProps) {
  const {
    caseId, investigation,
    editingInvestigation, setEditingInvestigation,
    deletingInvestigation, setDeletingInvestigation,
    activeInvestigationId, clearInvestigation, reloadInvestigations, selectInvestigation,
    searchOpen, setSearchOpen, selectedTraceId,
    fetchModalWallet, setFetchModalWallet, onAddStagedToTrace,
    stagedItems, setStagedItems,
  } = props;

  return (
    <>
      {editingInvestigation && (
        <FloatingPanel
          title="Investigation"
          onClose={() => setEditingInvestigation(null)}
          className="absolute top-4 left-4"
        >
          <InvestigationForm
            investigation={editingInvestigation}
            traces={investigation.id === editingInvestigation.id ? (investigation.traces as any) : undefined}
            onSave={async (updates) => {
              await apiClient.updateInvestigation(editingInvestigation.id, updates);
              setEditingInvestigation(null);
              reloadInvestigations();
            }}
            onDelete={() => {
              setDeletingInvestigation(editingInvestigation);
              setEditingInvestigation(null);
            }}
            onDuplicate={async () => {
              const copy = await apiClient.duplicateInvestigation(editingInvestigation.id);
              setEditingInvestigation(null);
              reloadInvestigations();
              selectInvestigation(copy.id);
            }}
            onCancel={() => setEditingInvestigation(null)}
          />
        </FloatingPanel>
      )}

      {deletingInvestigation && (
        <ConfirmDeleteModal
          title="Delete investigation"
          expectedText={deletingInvestigation.name}
          message={
            <>
              This will permanently delete <span className="text-ink font-medium">{deletingInvestigation.name}</span> and all of its traces, nodes, edges, and scripts. This cannot be undone.
            </>
          }
          onConfirm={async () => {
            const id = deletingInvestigation.id;
            await apiClient.deleteInvestigation(id);
            setDeletingInvestigation(null);
            if (activeInvestigationId === id) clearInvestigation();
            reloadInvestigations();
          }}
          onCancel={() => setDeletingInvestigation(null)}
        />
      )}

      {investigation.traces.length > 0 && (
        <SearchPanel
          investigation={investigation}
          selectedTraceId={selectedTraceId}
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {fetchModalWallet && (
        <FetchModal
          initialAddress={fetchModalWallet.address}
          initialChain={fetchModalWallet.chain}
          traces={investigation.traces}
          existingTxKeys={new Set(
            (() => {
              // Edges reference node UUIDs after import, not raw addresses — resolve
              // through a nodeId -> address map before computing the dedup key (fall
              // back to the raw value for edges that predate import normalization).
              const nodeAddressById = new Map<string, string>();
              investigation.traces.forEach((t) =>
                t.nodes.forEach((n) => nodeAddressById.set(n.id, n.address))
              );
              return investigation.traces.flatMap((t) =>
                t.edges.map((e) => {
                  const fromAddr = nodeAddressById.get(e.from) ?? e.from;
                  const toAddr = nodeAddressById.get(e.to) ?? e.to;
                  return edgeIdentityKey(e, fromAddr, toAddr);
                })
              );
            })()
          )}
          onAdd={onAddStagedToTrace}
          onClose={() => setFetchModalWallet(null)}
        />
      )}

      {stagedItems.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <StagingPanel
            items={stagedItems}
            traces={investigation.traces}
            onAddToTrace={onAddStagedToTrace}
            onClear={() => setStagedItems([])}
          />
        </div>
      )}
    </>
  );
}
