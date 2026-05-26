// Mirror of backend/src/modules/productions/chronology-highlights.ts.
// Keep both files in sync.

export const HIGHLIGHT_NAMES = ['yellow', 'amber', 'red', 'green', 'blue'] as const;
export type HighlightColor = (typeof HIGHLIGHT_NAMES)[number];

export const HIGHLIGHT_COLORS: Record<HighlightColor, { bg: string; fg: string; label: string }> = {
  yellow: { bg: '#FEF3C7', fg: '#713F12', label: 'Note' },
  amber:  { bg: '#FED7AA', fg: '#7C2D12', label: 'Review' },
  red:    { bg: '#FECACA', fg: '#7F1D1D', label: 'Alert' },
  green:  { bg: '#BBF7D0', fg: '#14532D', label: 'Verified' },
  blue:   { bg: '#BFDBFE', fg: '#1E3A8A', label: 'Info' },
};

export function isHighlightColor(v: unknown): v is HighlightColor {
  return typeof v === 'string' && (HIGHLIGHT_NAMES as readonly string[]).includes(v);
}
