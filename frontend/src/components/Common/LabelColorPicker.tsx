/**
 * LabelColorPicker — compact swatch button that opens a preset palette popover.
 * Used in the label editor toolbar. Supports a "none" option to clear the color.
 */
import { useEffect, useRef, useState } from 'react';

export const LABEL_PRESET_COLORS = [
  '#3b82f6', '#06b6d4', '#10b981', '#22c55e',
  '#ef4444', '#f97316', '#eab308', '#f59e0b',
  '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#14b8a6', '#6366f1', '#84cc16', '#fb7185',
  '#94a3b8', '#6b7280', '#78716c', '#ffffff',
];

interface LabelColorPickerProps {
  /** Current color (hex). Empty string = no explicit selection (renders fallback). */
  color: string;
  onChange: (c: string) => void;
  /** Visual fallback for the trigger swatch when `color` is empty. Treated as a non-custom default. */
  fallback?: string;
}

export function LabelColorPicker({ color, onChange, fallback }: LabelColorPickerProps) {
  const [open, setOpen] = useState(false);
  const customRef = useRef<HTMLInputElement>(null);
  const swatchBg = color || fallback || '#9ca3af';
  const isCustom = !!color && !LABEL_PRESET_COLORS.includes(color) && color !== fallback;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-5 h-5 rounded-full border-2 border-canvas-line hover:border-canvas-muted transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        style={{ backgroundColor: swatchBg }}
        title="Label color"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-20" onMouseDown={() => setOpen(false)} />
          <div
            className="absolute right-0 top-6 z-30 bg-canvas border border-canvas-line rounded-xl p-2 shadow-2xl"
            style={{ width: '130px' }}
          >
            {/* "No color" option */}
            <button
              type="button"
              onClick={() => onChange('')}
              className={`w-full text-left text-xs mb-2 px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${color === '' ? 'text-canvas-ink' : 'text-canvas-muted hover:text-canvas-ink'}`}
            >
              No color
            </button>
            <div className="grid grid-cols-4 gap-1.5">
              {LABEL_PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange(c)}
                  className="w-6 h-6 rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  style={{
                    backgroundColor: c,
                    borderColor: c === color ? 'white' : 'transparent',
                  }}
                />
              ))}
              <button
                type="button"
                onClick={() => customRef.current?.click()}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  isCustom
                    ? 'border-white text-transparent'
                    : 'border-dashed border-canvas-line hover:border-canvas-muted text-canvas-muted hover:text-canvas-ink'
                }`}
                style={isCustom ? { backgroundColor: color } : undefined}
                title="Custom color"
              >
                +
              </button>
            </div>
            <input
              ref={customRef}
              type="color"
              value={color || '#3b82f6'}
              onChange={(e) => onChange(e.target.value)}
              className="sr-only"
            />
          </div>
        </>
      )}
    </div>
  );
}
