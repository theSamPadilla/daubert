'use client';

import { WalletForm } from '@/components/Forms/WalletForm';
import { TransactionForm } from '@/components/Forms/TransactionForm';
import type { Investigation, WalletNode, TransactionEdge } from '@/types/investigation';
import type { PanelMode } from '@/types/panel';

interface CreationPanelsProps {
  panelMode: PanelMode;
  investigation: Investigation;
  allWallets: { wallet: WalletNode; traceId: string }[];
  onSaveWallet: (traceId: string, data: Partial<WalletNode>) => void;
  onSaveTransaction: (traceId: string, data: Partial<TransactionEdge>) => void;
  onCancel: () => void;
  onCreateTrace: () => Promise<string | undefined>;
}

export function CreationPanels({
  panelMode,
  investigation,
  allWallets,
  onSaveWallet,
  onSaveTransaction,
  onCancel,
  onCreateTrace,
}: CreationPanelsProps) {
  if (panelMode.type === 'createWallet') {
    return (
      <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
        <div className="bg-canvas/90 backdrop-blur border border-canvas-line text-canvas-ink rounded-xl p-6 w-96 max-h-[80vh] overflow-y-auto">
          <h3 className="text-sm font-semibold text-canvas-muted uppercase mb-4">New Address</h3>
          <WalletForm
            traces={investigation.traces}
            selectedTraceId={investigation.traces[0]?.id}
            onSave={onSaveWallet}
            onCancel={onCancel}
            onCreateTrace={onCreateTrace}
            prefill={panelMode.prefill}
          />
        </div>
      </div>
    );
  }

  if (panelMode.type === 'createTransaction') {
    return (
      <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
        <div className="bg-canvas/90 backdrop-blur border border-canvas-line text-canvas-ink rounded-xl p-6 w-[480px] max-h-[80vh] overflow-y-auto">
          <h3 className="text-sm font-semibold text-canvas-muted uppercase mb-4">New Transaction</h3>
          <TransactionForm
            traces={investigation.traces}
            allWallets={allWallets}
            onSave={onSaveTransaction}
            onCancel={onCancel}
            onCreateTrace={onCreateTrace}
            prefill={panelMode.prefill}
          />
        </div>
      </div>
    );
  }

  return null;
}
