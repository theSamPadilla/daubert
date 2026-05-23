/**
 * Brand-aligned palette for Chart.js. Hex values mirror the CSS tokens in
 * globals.css; we duplicate them here as JS literals because Chart.js
 * canvas rendering cannot read CSS custom properties.
 *
 * This palette is authoritative: applyBrandColors() overrides any
 * backgroundColor/borderColor the caller supplied. The backend prompt
 * (backend/src/prompts/investigator.ts) no longer dictates colors.
 */

export const BRAND_PALETTE = {
  ink: '#E6EAF2',
  inkMuted: '#9AA3B2',
  inkFaint: '#5B6473',
  line: '#2A364E',
  brand: '#4F6FD8',
  accent: '#2DD4D2',
} as const;

// Ordered series colors. Index 0 is the primary (accent teal — distinct from
// the brand navy used for chrome). Subsequent indices alternate hues with
// enough separation to remain legible on a dark canvas.
export const BRAND_SERIES_COLORS = [
  '#2DD4D2', // accent (teal)
  '#4F6FD8', // brand (navy)
  '#A78BFA', // violet
  '#F472B6', // pink
  '#34D399', // emerald
  '#FBBF24', // amber (last resort)
] as const;

/**
 * Assign brand palette colors to Chart.js datasets, overriding any
 * caller-supplied backgroundColor/borderColor.
 */
export function applyBrandColors<T extends { backgroundColor?: unknown; borderColor?: unknown }>(
  datasets: T[],
): T[] {
  return datasets.map((ds, i) => {
    const color = BRAND_SERIES_COLORS[i % BRAND_SERIES_COLORS.length];
    return {
      ...ds,
      backgroundColor: color,
      borderColor: color,
    };
  });
}

const FONT_SANS = "'Inter', ui-sans-serif, system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Base Chart.js options block with brand-aligned axes, gridlines, and
 * legend text. Spread this into per-chart options to inherit the look.
 */
export const BRAND_CHART_OPTIONS = {
  plugins: {
    legend: {
      labels: {
        color: BRAND_PALETTE.inkMuted,
        font: { family: FONT_SANS, size: 11 },
      },
    },
  },
  scales: {
    x: {
      ticks: {
        color: BRAND_PALETTE.inkFaint,
        font: { family: FONT_MONO, size: 10 },
      },
      grid: { color: BRAND_PALETTE.line },
    },
    y: {
      ticks: {
        color: BRAND_PALETTE.inkFaint,
        font: { family: FONT_MONO, size: 10 },
      },
      grid: { color: BRAND_PALETTE.line },
    },
  },
} as const;
