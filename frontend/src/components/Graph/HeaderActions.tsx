'use client';

import { useState } from 'react';
import { FaPenToSquare, FaTrash } from 'react-icons/fa6';
import { LabelColorPicker } from '@/components/Common/LabelColorPicker';
import type { WalletNode, TransactionEdge } from '@/types/investigation';

export function EditDeleteActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <button onClick={onEdit} title="Edit" className="text-ink-faint hover:text-ink-muted transition-colors">
        <FaPenToSquare size={13} />
      </button>
      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <button onClick={() => { onDelete(); setConfirmDelete(false); }}
            className="text-[10px] px-1.5 py-0.5 bg-red-600 hover:bg-red-500 rounded text-white">
            Delete
          </button>
          <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-ink-muted hover:text-white">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirmDelete(true)} title="Delete" className="text-ink-faint hover:text-red-400 transition-colors">
          <FaTrash size={13} />
        </button>
      )}
    </div>
  );
}

export function TransactionHeaderActions({ transaction, onEdit, onDelete, onColorChange }: {
  transaction: TransactionEdge;
  onEdit: () => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <LabelColorPicker color={transaction.color || '#10b981'} onChange={onColorChange} />
      <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

export function WalletHeaderActions({ wallet, onEdit, onDelete, onColorChange }: {
  wallet: WalletNode;
  onEdit: () => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <LabelColorPicker color={wallet.color || '#60a5fa'} onChange={onColorChange} />
      <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}
