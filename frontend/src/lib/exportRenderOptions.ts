// Mirror of backend/src/modules/export/render-options.ts. Keep both in sync.
// Curated set — needed because the export pipeline blocks network requests
// (no Google Fonts), so only Chromium-bundled fonts work in the final PDF.

export const FONT_FAMILIES = ['helvetica', 'arial', 'times', 'georgia', 'courier'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_SIZES = [9, 10, 11, 12, 14] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const ORIENTATIONS = ['portrait', 'landscape'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const FONT_LABELS: Record<FontFamily, { label: string; preview: string }> = {
  helvetica: { label: 'Helvetica', preview: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  arial:     { label: 'Arial',     preview: "Arial, 'Helvetica Neue', Helvetica, sans-serif" },
  times:     { label: 'Times New Roman', preview: "'Times New Roman', Times, serif" },
  georgia:   { label: 'Georgia',   preview: "Georgia, 'Times New Roman', serif" },
  courier:   { label: 'Courier New', preview: "'Courier New', Courier, monospace" },
};

export const DEFAULT_FONT_FAMILY: FontFamily = 'helvetica';
export const DEFAULT_FONT_SIZE: FontSize = 11;
export const DEFAULT_ORIENTATION: Orientation = 'portrait';

export interface RenderOptions {
  fontFamily?: FontFamily;
  fontSize?: FontSize;
  orientation?: Orientation;
}
