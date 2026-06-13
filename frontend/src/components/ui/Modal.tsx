'use client';

import { ReactNode, useEffect } from 'react';
import { FaXmark } from 'react-icons/fa6';
import { IconButton } from './IconButton';

type Props = {
  open?: boolean;
  title?: string;
  onClose: () => void;
  maxWidth?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Modal({
  open = true,
  title,
  onClose,
  maxWidth = 'max-w-md',
  children,
  footer,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-surface rounded-xl border border-line shadow-[0_24px_60px_-30px_rgba(11,18,32,0.25)] w-full ${maxWidth}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <span className="text-[15px] font-medium text-ink">{title}</span>
            <IconButton aria-label="Close modal" onClick={onClose}>
              <FaXmark />
            </IconButton>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 pb-5">{footer}</div>}
      </div>
    </div>
  );
}
