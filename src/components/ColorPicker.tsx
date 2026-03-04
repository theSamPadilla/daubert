import { useRef } from 'react';

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
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: color,
            borderColor: value === color ? '#fff' : 'transparent',
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-6 h-6 rounded-full border-2 border-dashed border-gray-500 hover:border-gray-400 flex items-center justify-center text-gray-400 text-xs"
        style={
          !PRESETS.includes(value) ? { backgroundColor: value, borderColor: '#fff', borderStyle: 'solid' } : undefined
        }
      >
        {PRESETS.includes(value) && '+'}
      </button>
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
    </div>
  );
}
