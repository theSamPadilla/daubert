// Render-time options shared by single-production and exhibit exports.
// Curated to fonts bundled with Chromium since Puppeteer blocks network
// requests (no Google Fonts). Mirrored in frontend/src/lib/exportRenderOptions.ts.

export const FONT_FAMILIES = ['helvetica', 'arial', 'times', 'georgia', 'courier'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_SIZES = [9, 10, 11, 12, 14] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const ORIENTATIONS = ['portrait', 'landscape'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

const FONT_CSS: Record<FontFamily, string> = {
  helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  arial:     "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  times:     "'Times New Roman', Times, serif",
  georgia:   "Georgia, 'Times New Roman', serif",
  courier:   "'Courier New', Courier, monospace",
};

export interface RenderOptions {
  fontFamily?: FontFamily;
  fontSize?: FontSize;
}

export const DEFAULT_RENDER_OPTIONS: Required<RenderOptions> = {
  fontFamily: 'helvetica',
  fontSize: 11,
};

export function isFontFamily(v: unknown): v is FontFamily {
  return typeof v === 'string' && (FONT_FAMILIES as readonly string[]).includes(v);
}

export function isFontSize(v: unknown): v is FontSize {
  return typeof v === 'number' && (FONT_SIZES as readonly number[]).includes(v);
}

export function isOrientation(v: unknown): v is Orientation {
  return typeof v === 'string' && (ORIENTATIONS as readonly string[]).includes(v);
}

/**
 * Returns a CSS block to append AFTER BASE_STYLES — the body selector with
 * same specificity wins via cascade. Always returns a value (uses defaults
 * when opts is undefined) so the output is deterministic.
 */
export function buildFontOverrideCss(opts?: RenderOptions): string {
  const ff = opts?.fontFamily ?? DEFAULT_RENDER_OPTIONS.fontFamily;
  const fs = opts?.fontSize ?? DEFAULT_RENDER_OPTIONS.fontSize;
  return ` body { font-family: ${FONT_CSS[ff]}; font-size: ${fs}pt; } `;
}
