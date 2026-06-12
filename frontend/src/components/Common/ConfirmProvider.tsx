'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Modal, Button } from '@/components/ui';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [working, setWorking] = useState(false);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    if (!pending || working) return;
    pending.resolve(ok);
    setPending(null);
  }, [pending, working]);

  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          options={pending.options}
          working={working}
          onConfirm={async () => {
            // Resolve right away; callers handle their own loading state.
            pending.resolve(true);
            setPending(null);
          }}
          onCancel={() => close(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  options,
  working,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions;
  working: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {

  const destructive = options.destructive ?? false;
  const confirmLabel = options.confirmLabel ?? (destructive ? 'Delete' : 'Confirm');
  const cancelLabel = options.cancelLabel ?? 'Cancel';

  return (
    <Modal
      open
      title={options.title}
      onClose={working ? () => {} : onCancel}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={working}
          >
            {cancelLabel}
          </Button>
          <Button
            autoFocus
            variant={destructive ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            disabled={working}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {options.message && (
        <div className="text-sm text-ink-muted leading-relaxed">{options.message}</div>
      )}
    </Modal>
  );
}

/**
 * Drop-in replacement for `window.confirm` that renders a styled modal.
 * Returns a promise resolving to `true` if the user confirmed, `false` otherwise.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return ctx;
}
