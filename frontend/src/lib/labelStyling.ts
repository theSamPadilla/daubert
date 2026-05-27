import type { TraceLabel } from '@/types/investigation';

export const FONT_SIZE_PX: Record<string, string> = { sm: '10px', md: '11px', lg: '14px' };

export const SHAPE_BORDER_RADIUS: Record<string, string> = {
  rectangle: '0',
  rounded: '6px',
  pill: '999px',
  ellipse: '50%',
};

export const DEFAULT_LABEL_BG = 'rgba(17,24,39,0.92)';
export const DEFAULT_LABEL_COLOR = '#f3f4f6';

/**
 * Base wrapper cssText, applied once on element creation. Position-specific
 * styles (left/top) are applied by the caller per-render.
 */
export const LABEL_WRAPPER_BASE_CSS =
  'position:absolute;transform:translate(-50%, -50%);pointer-events:auto;max-width:240px;' +
  'background:' + DEFAULT_LABEL_BG + ';color:' + DEFAULT_LABEL_COLOR + ';' +
  'border:1px solid #374151;border-radius:6px;' +
  // line-height:1.2 matches html2canvas's internal baseline-probe container
  // (html2canvas.js:6589 measures the alphabetic baseline in a probe with
  // line-height:normal ≈ 1.2 and then applies that offset to text rendered in
  // our line-box). Using anything higher (e.g. 1.35) causes the rasterizer
  // to place glyphs below their proper baseline — text drifts toward the
  // bottom of the wrapper in exports. 1.2 keeps text centered in both live
  // and export, and is still readable for the rare multi-line label.
  'padding:6px 8px;font-size:11px;line-height:1.2;cursor:move;user-select:none;' +
  'box-shadow:0 2px 8px rgba(0,0,0,0.4);z-index:5;';

/**
 * Apply per-label visual styles (color, bg, fontSize, shape) to a wrapper element.
 * Unconditional writes — DOM style writes are cheap; the previous lastApplied* cache
 * was complexity without measurable benefit.
 */
export function applyLabelWrapperStyles(el: HTMLElement, label: TraceLabel): void {
  el.style.color = label.color ?? DEFAULT_LABEL_COLOR;
  el.style.background = label.bgColor ?? DEFAULT_LABEL_BG;
  el.style.fontSize = FONT_SIZE_PX[label.fontSize ?? 'md'] ?? '11px';
  el.style.borderRadius = SHAPE_BORDER_RADIUS[label.shape ?? 'rounded'] ?? '6px';
}
