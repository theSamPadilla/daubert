import { ReactNode } from 'react';

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
    <div className={`${width} bg-surface-panel border border-line-strong rounded-lg shadow-2xl max-h-[60vh] flex flex-col z-20 ${className}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-strong shrink-0">
        <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{title}</span>
        <div className="flex items-center gap-2">
          {actions}
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-sm leading-none">✕</button>
        </div>
      </div>
      <div className="overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
