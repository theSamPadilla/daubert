import { useEffect, useRef, useState } from 'react';

interface ConfirmDeleteModalProps {
  title: string;
  // What the user must type to enable the confirm button (e.g. the investigation name).
  expectedText: string;
  // Optional descriptive blurb shown above the input.
  message?: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDeleteModal({
  title,
  expectedText,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) {
  const [value, setValue] = useState('');
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !working) onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel, working]);

  const matches = value === expectedText;

  const handleConfirm = async () => {
    if (!matches || working) return;
    setWorking(true);
    try {
      await onConfirm();
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-[440px] border border-gray-700 shadow-xl">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-3">
          {title}
        </h3>
        {message && (
          <div className="text-sm text-gray-400 mb-4 leading-relaxed">{message}</div>
        )}
        <p className="text-xs text-gray-400 mb-2">
          Type <span className="font-mono text-gray-200">{expectedText}</span> to confirm.
        </p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleConfirm();
            }
          }}
          disabled={working}
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
          placeholder={expectedText}
          autoComplete="off"
          spellCheck={false}
        />

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!matches || working}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm transition-colors"
          >
            {working ? 'Deleting…' : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm ml-auto transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
