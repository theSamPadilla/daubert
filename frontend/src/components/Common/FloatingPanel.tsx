import { ReactNode } from 'react';
import { FaXmark } from 'react-icons/fa6';

interface FloatingPanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  width?: string;
}

export function FloatingPanel({ title, onClose, children, actions, className = '', width = 'w-80' }: FloatingPanelProps) {
  return (
    <div className={`${width} bg-canvas/90 backdrop-blur border border-canvas-line rounded-xl text-canvas-ink shadow-2xl max-h-[60vh] flex flex-col z-30 ${className}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-canvas-line shrink-0">
        <span className="text-xs font-semibold text-canvas-muted uppercase tracking-wider">{title}</span>
        <div className="flex items-center gap-2">
          {actions}
          <button
            onClick={onClose}
            className="text-canvas-muted hover:text-canvas-ink transition-colors leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            aria-label="Close panel"
          >
            <FaXmark size={14} />
          </button>
        </div>
      </div>
      <div className="overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
