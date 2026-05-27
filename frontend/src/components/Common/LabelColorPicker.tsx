/**
 * LabelColorPicker — compact swatch button that opens a preset palette popover.
 * Used in the label editor toolbar. Supports a "none" option to clear the color.
 */
import { useRef, useState } from 'react';

export const LABEL_PRESET_COLORS = [
  '#3b82f6', '#06b6d4', '#10b981', '#22c55e',
  '#ef4444', '#f97316', '#eab308', '#f59e0b',
  '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#14b8a6', '#6366f1', '#84cc16', '#fb7185',
  '#94a3b8', '#6b7280', '#78716c', '#ffffff',
];

interface LabelColorPickerProps {
  /** Current color (hex). Empty string = no color (use default). */
  color: string;
  onChange: (c: string) => void;
}

export function LabelColorPicker({ color, onChange }: LabelColorPickerProps) {
  const [open, setOpen] = useState(false);
  const customRef = useRef<HTMLInputElement>(null);
  const swatchBg = color || '#9ca3af';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-5 h-5 rounded-full border-2 border-line-strong hover:border-gray-400 transition-colors shrink-0"
        style={{ backgroundColor: swatchBg }}
        title="Label color"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div
            className="absolute right-0 top-6 z-50 bg-surface border border-line-strong rounded-lg p-2 shadow-2xl"
            style={{ width: '130px' }}
          >
            {/* "No color" option */}
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left text-xs text-ink-muted hover:text-white mb-2 px-1"
            >
              No color
            </button>
            <div className="grid grid-cols-4 gap-1.5">
              {LABEL_PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { onChange(c); setOpen(false); }}
                  className="w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: c === color ? '#fff' : 'transparent',
                  }}
                />
              ))}
              <button
                type="button"
                onClick={() => customRef.current?.click()}
                className="w-6 h-6 rounded-full border-2 border-dashed border-line-strong hover:border-gray-400 flex items-center justify-center text-ink-muted hover:text-white text-xs transition-colors"
                title="Custom color"
              >
                +
              </button>
            </div>
            <input
              ref={customRef}
              type="color"
              value={color || '#3b82f6'}
              onChange={(e) => { onChange(e.target.value); setOpen(false); }}
              className="sr-only"
            />
          </div>
        </>
      )}
    </div>
  );
}
