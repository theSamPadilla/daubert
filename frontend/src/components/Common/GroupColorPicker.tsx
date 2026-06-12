import { useRef } from 'react';

const GROUP_COLORS = [
  // Vivid
  '#3b82f6','#10b981','#f97316','#8b5cf6','#ec4899','#06b6d4','#eab308','#ef4444',
  // Neutrals
  '#6b7280','#9ca3af','#d1d5db','#475569','#78716c','#a8a29e',
];

export function GroupColorPicker({ color, onChange }: { color?: string; onChange: (c: string | undefined) => void }) {
  const customRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex gap-2 flex-wrap items-center">
      {/* None swatch */}
      <button
        onClick={() => onChange(undefined)}
        title="No color"
        className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 relative overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${!color ? 'border-white' : 'border-canvas-line hover:border-canvas-muted'}`}
        style={{ backgroundColor: 'var(--canvas-fill)' }}
      >
        <span className="absolute inset-0 flex items-center justify-center text-canvas-muted text-[10px] font-bold">∅</span>
      </button>
      {GROUP_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${color === c ? 'border-white' : 'border-transparent'}`}
          style={{ backgroundColor: c }}
        />
      ))}
      <button
        onClick={() => customRef.current?.click()}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
          color && !GROUP_COLORS.includes(color)
            ? 'border-white text-transparent'
            : 'border-dashed border-canvas-line hover:border-canvas-muted text-canvas-muted hover:text-canvas-ink'
        }`}
        style={color && !GROUP_COLORS.includes(color) ? { backgroundColor: color } : undefined}
        title="Custom color"
      >
        +
      </button>
      <input
        ref={customRef}
        type="color"
        value={color || '#3b82f6'}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
    </div>
  );
}
