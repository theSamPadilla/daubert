/**
 * Brand-aligned palette for Chart.js. Hex values mirror the CSS tokens in
 * globals.css; we duplicate them here as JS literals because Chart.js
 * canvas rendering cannot read CSS custom properties.
 *
 * This palette is authoritative: applyBrandColors() overrides any
 * backgroundColor/borderColor the caller supplied. The backend prompt
 * (backend/src/prompts/investigator.ts) no longer dictates colors.
 */

import type { ExportTheme } from './exportTheme';

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
 *
 * Exception: if a dataset has a `colorOverride` string (set by the human
 * via the chart edit panel), that color wins. This keeps AI-supplied
 * colors ignored while letting users pin a custom color per series.
 */
export function applyBrandColors<
  T extends { backgroundColor?: unknown; borderColor?: unknown; colorOverride?: unknown },
>(datasets: T[]): T[] {
  return datasets.map((ds, i) => {
    const override = typeof ds.colorOverride === 'string' ? ds.colorOverride : null;
    const color = override ?? BRAND_SERIES_COLORS[i % BRAND_SERIES_COLORS.length];
    return {
      ...ds,
      backgroundColor: color,
      borderColor: color,
    };
  });
}

const FONT_SANS = "'Inter', ui-sans-serif, system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const CHART_CHROME_BY_THEME: Record<ExportTheme, {
  legend: string;
  tick: string;
  grid: string;
}> = {
  dark: {
    legend: BRAND_PALETTE.inkMuted,
    tick: BRAND_PALETTE.inkFaint,
    grid: BRAND_PALETTE.line,
  },
  light: {
    legend: '#374151', // gray-700 — readable on white canvas
    tick: '#6b7280',   // gray-500 — axis tick color on white canvas
    grid: '#e5e7eb',   // border-line token (gray-200)
  },
};

/**
 * Returns Chart.js options block with brand-aligned axes, gridlines, and
 * legend text for the given theme. Spread this into per-chart options to
 * inherit the look.
 */
export function getBrandChartOptions(theme: ExportTheme = 'dark') {
  const c = CHART_CHROME_BY_THEME[theme];
  return {
    plugins: {
      legend: {
        labels: {
          color: c.legend,
          font: { family: FONT_SANS, size: 11 },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: c.tick, font: { family: FONT_MONO, size: 10 } },
        grid: { color: c.grid },
      },
      y: {
        ticks: { color: c.tick, font: { family: FONT_MONO, size: 10 } },
        grid: { color: c.grid },
      },
    },
  };
}
