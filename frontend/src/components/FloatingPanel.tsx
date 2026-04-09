import { ReactNode } from 'react';

interface FloatingPanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function FloatingPanel({ title, onClose, children, actions, className = '' }: FloatingPanelProps) {
  return (
    <div className={`w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl max-h-[60vh] flex flex-col z-20 ${className}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
        <div className="flex items-center gap-2">
          {actions}
          <button onClick={onClose} className="text-gray-500 hover:text-white text-sm leading-none">✕</button>
        </div>
      </div>
      <div className="overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
