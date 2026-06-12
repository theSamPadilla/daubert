'use client';

import { FaTriangleExclamation } from 'react-icons/fa6';
import { Modal, Button } from '@/components/ui';

interface Props {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
}

export function ErrorModal({ open, title = 'Something went wrong', message, onClose }: Props) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      maxWidth="max-w-[480px]"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose} autoFocus>
            Dismiss
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-redline shrink-0">
          <FaTriangleExclamation size={18} />
        </span>
        <div className="text-sm text-ink-muted leading-relaxed whitespace-pre-wrap break-words">
          {message}
        </div>
      </div>
    </Modal>
  );
}
