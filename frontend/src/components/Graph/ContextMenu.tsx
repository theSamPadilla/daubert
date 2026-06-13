import { ReactNode, useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Renders a visual divider above this item. */
  separator?: boolean;
  /** Optional icon rendered to the left of the label. */
  icon?: ReactNode;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 20,
  };

  return (
    <div ref={menuRef} style={style} className="bg-canvas/90 backdrop-blur border border-canvas-line rounded-xl text-canvas-ink shadow-lg py-1 min-w-[160px]">
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && <div className="border-t border-canvas-line my-1" />}
          <button
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-canvas-fill flex items-center gap-2 ${
              item.danger ? 'text-red-400 hover:text-red-300' : 'text-canvas-ink'
            }`}
          >
            {item.icon && (
              <span className={`text-xs shrink-0 ${item.danger ? 'text-red-400' : 'text-canvas-muted'}`}>
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
