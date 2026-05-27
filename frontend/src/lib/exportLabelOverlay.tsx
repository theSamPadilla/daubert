import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Core } from 'cytoscape';
import type { TraceLabel } from '@/types/investigation';
import { exportContextFromCy, resolveLabelRenderedPosition } from './labelGeometry';
import {
  LABEL_WRAPPER_BASE_CSS,
  applyLabelWrapperStyles,
} from '@/lib/labelStyling';
import { LabelOverlay } from '@/components/Graph/LabelOverlay';

export interface ExportLabelOverlayResult {
  overlayEl: HTMLDivElement;
  dispose: () => void;
}

/**
 * Build a hidden onscreen overlay sized to the full-extent bounding box of
 * the cy elements (+ padding on each side). Position every resolvable label
 * inside it using the synthetic export GeometryContext.
 *
 * The caller is responsible for:
 *   1. Rasterizing via html2canvas with `foreignObjectRendering: true` so the
 *      browser's own text rasterizer is used (sidesteps html2canvas's reimpl
 *      of text layout, which drifts text baselines by several pixels — see
 *      html2canvas.js:6589 and the discussion that led to this choice).
 *   2. Calling dispose() to remove the overlay element + unmount React roots.
 *
 * Why the overlay is positioned ONSCREEN (top:0; left:0; z-index:-1; opacity:0):
 * `foreignObjectRendering: true` serializes the element through an SVG
 * `<foreignObject>`. When the source element sits at extreme negative offsets
 * (e.g. left:-100000px), the resulting SVG viewBox is either zero-sized or
 * out-of-bounds and the labels disappear in the capture. Onscreen-but-hidden
 * (opacity:0 behind everything via z-index:-1) keeps the bounding rect at
 * (0, 0) so the SVG captures correctly. opacity is flipped to 1 by the
 * caller for the duration of the html2canvas call (since opacity:0 makes
 * captured pixels transparent), then back to 0; the user sees the labels for
 * ~100ms during export, which is acceptable.
 *
 * Why `flushSync` instead of `requestAnimationFrame`: `createRoot.render()` is async
 * under React 18 concurrent mode; one RAF tick is not a reliable commit barrier.
 * `flushSync` forces synchronous commit so html2canvas captures fully-rendered markdown.
 */
export function renderExportLabelOverlay(
  cy: Core,
  labels: { traceId: string; label: TraceLabel }[],
  bb: { x1: number; y1: number; x2: number; y2: number; w: number; h: number },
  padding: number,
): ExportLabelOverlayResult {
  const width = bb.w + 2 * padding;
  const height = bb.h + 2 * padding;

  const overlayEl = document.createElement('div');
  overlayEl.style.cssText =
    `position:fixed;top:0;left:0;width:${width}px;height:${height}px;` +
    `pointer-events:none;overflow:hidden;z-index:-1;opacity:0;`;
  document.body.appendChild(overlayEl);

  const ctx = exportContextFromCy(cy, bb, padding);
  const roots: Root[] = [];
  let disposed = false;

  for (const { label } of labels) {
    const pos = resolveLabelRenderedPosition(label.anchor, ctx);
    if (!pos) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'label-wrapper';
    wrapper.style.cssText = LABEL_WRAPPER_BASE_CSS;
    wrapper.style.left = `${pos.x}px`;
    wrapper.style.top = `${pos.y}px`;
    applyLabelWrapperStyles(wrapper, label);

    const markdownContainer = document.createElement('div');
    wrapper.appendChild(markdownContainer);
    overlayEl.appendChild(wrapper);

    const root = createRoot(markdownContainer);
    flushSync(() => {
      root.render(<LabelOverlay text={label.text} />);
    });
    roots.push(root);
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const root of roots) {
      root.unmount();
    }
    overlayEl.remove();
  };

  return { overlayEl, dispose };
}
