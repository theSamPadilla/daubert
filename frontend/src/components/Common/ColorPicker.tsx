import { useRef } from 'react';
import { FaXmark } from 'react-icons/fa6';

const PRESETS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#ef4444', // red
  '#f97316', // orange
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#eab308', // yellow
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  allowNone?: boolean;
}

export function ColorPicker({ value, onChange, allowNone }: ColorPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {allowNone && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center bg-canvas-fill focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          style={{ borderColor: value === '' ? 'white' : 'transparent' }}
          title="No color"
        >
          <FaXmark size={10} className="text-canvas-muted" />
        </button>
      )}
      {PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          style={{
            backgroundColor: color,
            borderColor: value === color ? 'white' : 'transparent',
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-6 h-6 rounded-full border-2 border-dashed border-canvas-line hover:border-canvas-muted flex items-center justify-center text-canvas-muted text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        style={
          value && !PRESETS.includes(value) ? { backgroundColor: value, borderColor: 'white', borderStyle: 'solid' } : undefined
        }
      >
        {(!value || PRESETS.includes(value)) && '+'}
      </button>
      <input
        ref={inputRef}
        type="color"
        value={value || '#3b82f6'}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
    </div>
  );
}
