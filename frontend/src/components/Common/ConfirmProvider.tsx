'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

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
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus the confirm button on mount so Enter triggers it.
    confirmRef.current?.focus();
  }, []);

  const destructive = options.destructive ?? false;
  const confirmLabel = options.confirmLabel ?? (destructive ? 'Delete' : 'Confirm');
  const cancelLabel = options.cancelLabel ?? 'Cancel';

  const confirmClass = destructive
    ? 'bg-red-600 hover:bg-red-500 text-white'
    : 'bg-brand hover:bg-brand/90 text-white';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] px-4"
      onClick={(e) => {
        // Backdrop click = cancel (safe default — never confirms accidentally).
        if (e.target === e.currentTarget && !working) onCancel();
      }}
    >
      <div className="bg-surface-panel rounded-lg p-6 w-full max-w-md border border-line-strong shadow-xl space-y-4">
        <h3 className="text-base font-semibold text-white">{options.title}</h3>
        {options.message && (
          <div className="text-sm text-ink-muted leading-relaxed">{options.message}</div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="px-3 py-1.5 rounded bg-surface-raised hover:bg-surface-raised/80 text-sm text-ink-muted transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={working}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50 ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
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
