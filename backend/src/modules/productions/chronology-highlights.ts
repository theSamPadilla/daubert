// Single source of truth for chronology row highlight colors.
// Mirrored in frontend/src/components/Productions/chronologyHighlights.ts —
// keep both files in sync.
//
// Each color is a (bg, fg) pair so the same hex renders legibly on both the
// dark in-app table and the light PDF/HTML export. `null` clears the highlight.

export const HIGHLIGHT_NAMES = ['yellow', 'gray', 'red', 'green', 'blue'] as const;
export type HighlightColor = (typeof HIGHLIGHT_NAMES)[number];

export const HIGHLIGHT_COLORS: Record<HighlightColor, { bg: string; fg: string }> = {
  yellow: { bg: '#FEF3C7', fg: '#713F12' },
  gray:   { bg: '#E5E7EB', fg: '#374151' },
  red:    { bg: '#FECACA', fg: '#7F1D1D' },
  green:  { bg: '#BBF7D0', fg: '#14532D' },
  blue:   { bg: '#BFDBFE', fg: '#1E3A8A' },
};

export function isHighlightColor(v: unknown): v is HighlightColor {
  return typeof v === 'string' && (HIGHLIGHT_NAMES as readonly string[]).includes(v);
}
