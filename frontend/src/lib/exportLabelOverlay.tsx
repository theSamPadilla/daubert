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
 * Build a hidden off-screen overlay sized to the full-extent bounding box of
 * the cy elements (+ padding on each side). Position every resolvable label
 * inside it using the synthetic export GeometryContext.
 *
 * The caller is responsible for:
 *   1. Rasterizing via html2canvas (use scale = 2 * devicePixelRatio to match cy.png).
 *   2. Calling dispose() to remove the overlay element + unmount React roots.
 *
 * Why `position: absolute; left: -100000px` (not `fixed`): html2canvas's iframe-cloning
 * path has documented issues with `position: fixed` elements at extreme offsets
 * (html2canvas#2493, #2658). Absolute positioning at a large negative offset is the
 * safe pattern.
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
    `position:absolute;left:-100000px;top:0;width:${width}px;height:${height}px;` +
    `pointer-events:none;overflow:hidden;`;
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
