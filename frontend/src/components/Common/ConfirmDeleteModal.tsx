import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Input } from '@/components/ui';

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
    <Modal
      open
      title={title}
      onClose={working ? () => {} : onCancel}
      maxWidth="max-w-[440px]"
      footer={
        <div className="flex gap-2">
          <Button
            variant="danger"
            size="sm"
            onClick={handleConfirm}
            disabled={!matches || working}
          >
            {working ? 'Deleting…' : confirmLabel}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={working}
            className="ml-auto"
          >
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {message && (
          <div className="text-sm text-ink-muted leading-relaxed">{message}</div>
        )}
        <p className="text-xs text-ink-muted">
          Type <span className="font-mono text-ink">{expectedText}</span> to confirm.
        </p>
        <Input
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
          placeholder={expectedText}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </Modal>
  );
}
