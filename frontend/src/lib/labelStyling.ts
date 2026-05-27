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
  'position:absolute;transform:translate(-50%, -50%);pointer-events:auto;' +
  // width:max-content with max-width:240px gives an explicit shrink-to-fit
  // (capped at 240px). The implicit shrink-to-fit on absolute-positioned
  // wrappers works the same in normal browser layout, but SVG <foreignObject>
  // (used by html2canvas's foreignObjectRendering) re-flows the wrapper
  // independently of its computed dimensions, sometimes producing a wrapper
  // that's sized for one line of text while the inner text wraps to multiple.
  // Stating width:max-content explicitly removes the ambiguity.
  'width:max-content;max-width:240px;' +
  'background:' + DEFAULT_LABEL_BG + ';color:' + DEFAULT_LABEL_COLOR + ';' +
  'border:1px solid #374151;border-radius:6px;' +
  'padding:6px 8px;font-size:11px;line-height:1.35;cursor:move;user-select:none;' +
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
