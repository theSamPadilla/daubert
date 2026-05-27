import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Core } from 'cytoscape';
import type { TraceLabel, LabelAnchor } from '@/types/investigation';
import {
  contextFromCy,
  resolveLabelRenderedPosition,
  projectPointOntoEdge,
  modelDeltaFromRenderedDelta,
} from '@/lib/labelGeometry';
import { renderLabelMarkdownInto } from '@/components/Graph/LabelOverlay';
import {
  LABEL_WRAPPER_BASE_CSS,
  applyLabelWrapperStyles,
} from '@/lib/labelStyling';

type OnResizeNode = (nodeId: string, traceId: string, size: number) => void;

// DOM overlays layered on top of the Cytoscape canvas:
//   - address sublabels (small truncated address under custom-labeled wallet nodes)
//   - edge date sublabels (small date pill at the midpoint of every edge)
//   - near-vertical edge orientation class (keeps labels horizontal when steep)
//   - resize handle (yellow square at bottom-right of the single selected wallet/group)
//   - annotation labels (user-created markdown labels anchored to the graph)
//
// All overlays are positioned via the `render` event Cytoscape fires whenever
// the viewport or any element moves. They live in a single absolute-positioned
// div appended next to the Cytoscape canvas.
export function useCytoscapeOverlays(
  cy: Core | null,
  container: HTMLDivElement | null,
  onResizeNode: OnResizeNode,
  labels: { traceId: string; label: TraceLabel }[] = [],
  onLabelMove: (traceId: string, labelId: string, anchor: LabelAnchor) => void = () => {},
  onLabelEdit: (traceId: string, labelId: string) => void = () => {},
  onLabelSelect: (labelId: string | null) => void = () => {},
  selectedLabelId: string | null = null,
  unselectAllCytoscape: () => void = () => {},
  onLabelContextMenu: (traceId: string, labelId: string, x: number, y: number) => void = () => {},
): void {
  // Mirror into refs so the main effect's dep array stays minimal.
  // Changing prop identity (e.g. labels array on every reducer dispatch) must NOT
  // tear down and recreate the overlay layer — that would break mid-drag state.
  // This is the same callbacksRef pattern from useCytoscape.ts:46-55.
  const labelsRef = useRef(labels);
  const selectedLabelIdRef = useRef(selectedLabelId);
  const onLabelMoveRef = useRef(onLabelMove);
  const onLabelEditRef = useRef(onLabelEdit);
  const onLabelSelectRef = useRef(onLabelSelect);
  const unselectAllRef = useRef(unselectAllCytoscape);
  const onLabelContextMenuRef = useRef(onLabelContextMenu);
  // Ref to the overlay render pipeline so prop-change effects can trigger a redraw.
  // Cytoscape's 'render' event only fires on canvas repaints (pan/zoom/element moves),
  // so React-driven changes to labels never reach the DOM overlay without this nudge.
  const runOverlayRenderRef = useRef<() => void>(() => {});

  labelsRef.current = labels;
  selectedLabelIdRef.current = selectedLabelId;
  onLabelMoveRef.current = onLabelMove;
  onLabelEditRef.current = onLabelEdit;
  onLabelSelectRef.current = onLabelSelect;
  unselectAllRef.current = unselectAllCytoscape;
  onLabelContextMenuRef.current = onLabelContextMenu;

  useEffect(() => {
    if (!cy || !container) return;

    const overlayEl = document.createElement('div');
    overlayEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    container.parentElement?.appendChild(overlayEl);

    const sublabelEls = new Map<string, HTMLDivElement>();
    const edgeSublabelEls = new Map<string, HTMLDivElement>();

    const updateSublabels = () => {
      const activeIds = new Set<string>();
      cy.nodes().forEach((n) => {
        if (n.isParent() || !n.data('hasCustomLabel')) return;
        const id = n.data('id');
        activeIds.add(id);
        const pos = n.renderedPosition();
        const h = n.renderedOuterHeight();

        let el = sublabelEls.get(id);
        if (!el) {
          el = document.createElement('div');
          el.style.cssText =
            'position:absolute;font-size:8px;color:#9ca3af;white-space:nowrap;pointer-events:none;transform:translateX(-50%);font-family:ui-monospace,SFMono-Regular,monospace;';
          overlayEl.appendChild(el);
          sublabelEls.set(id, el);
        }
        el.textContent = n.data('truncAddr');
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y + h / 2 + 2}px`;
        el.style.display = '';
      });
      sublabelEls.forEach((el, id) => {
        if (!activeIds.has(id)) el.style.display = 'none';
      });
    };

    const updateEdgeSublabels = () => {
      const activeIds = new Set<string>();
      cy.edges().forEach((e) => {
        const date = e.data('date');
        if (!date) return;
        const id = e.data('id');
        activeIds.add(id);

        const srcPos = e.source().renderedPosition();
        const tgtPos = e.target().renderedPosition();
        const midX = (srcPos.x + tgtPos.x) / 2;
        const midY = (srcPos.y + tgtPos.y) / 2;
        const dx = tgtPos.x - srcPos.x;
        const dy = tgtPos.y - srcPos.y;
        const rawAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        // Match Cytoscape autorotate: flip angles that would render upside-down
        const angleDeg = rawAngle > 90 ? rawAngle - 180 : rawAngle < -90 ? rawAngle + 180 : rawAngle;
        const absAngle = Math.abs(rawAngle);
        const isNearVertical = absAngle > 65 && absAngle < 115;

        let el = edgeSublabelEls.get(id);
        if (!el) {
          el = document.createElement('div');
          el.style.cssText =
            'position:absolute;font-size:8px;color:#6b7280;white-space:nowrap;pointer-events:none;' +
            'background:#111827;padding:1px 3px;border-radius:3px;';
          overlayEl.appendChild(el);
          edgeSublabelEls.set(id, el);
        }
        el.textContent = date;
        el.style.left = `${midX}px`;
        el.style.top  = `${midY}px`;
        // 8px below the amount in the rotated frame; stay horizontal when near-vertical
        el.style.transform = isNearVertical
          ? `translate(-50%, -50%) translateY(8px)`
          : `translate(-50%, -50%) rotate(${angleDeg}deg) translateY(8px)`;
        el.style.display = '';
      });
      edgeSublabelEls.forEach((el, id) => {
        if (!activeIds.has(id)) el.style.display = 'none';
      });
    };

    const updateEdgeOrientations = () => {
      cy.edges().forEach((e) => {
        const src = e.source().renderedPosition();
        const tgt = e.target().renderedPosition();
        if (!src || !tgt) return;
        const absAngle = Math.abs(Math.atan2(tgt.y - src.y, tgt.x - src.x) * 180 / Math.PI);
        const isNearVertical = absAngle > 65 && absAngle < 115;
        if (isNearVertical) e.addClass('near-vertical');
        else e.removeClass('near-vertical');
      });
    };

    const resizeHandleEl = document.createElement('div');
    resizeHandleEl.style.cssText =
      'position:absolute;width:10px;height:10px;background:#facc15;border:1.5px solid #fff;' +
      'border-radius:2px;cursor:se-resize;display:none;pointer-events:auto;z-index:10;' +
      'box-shadow:0 1px 3px rgba(0,0,0,0.5);';
    overlayEl.appendChild(resizeHandleEl);

    const updateResizeHandle = () => {
      const selected = cy.nodes('.cy-sel').filter((n: any) => !n.isParent());
      if (selected.length !== 1) { resizeHandleEl.style.display = 'none'; return; }
      const node = selected[0];
      const pos = node.renderedPosition();
      const w = node.renderedOuterWidth();
      const h = node.renderedOuterHeight();
      resizeHandleEl.style.left = `${pos.x + w / 2 - 5}px`;
      resizeHandleEl.style.top  = `${pos.y + h / 2 - 5}px`;
      resizeHandleEl.style.display = '';
    };

    const onMouseDown = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const selected = cy.nodes('.cy-sel').filter((n: any) => !n.isParent());
      if (selected.length !== 1) return;
      const node = selected[0];
      const nodeId = node.data('id');
      const traceId = node.data('traceId') || node.data('parent');
      const containerRect = container.getBoundingClientRect();

      const onMove = (ev: MouseEvent) => {
        const n = cy.getElementById(nodeId);
        const center = n.renderedPosition();
        const mx = ev.clientX - containerRect.left;
        const my = ev.clientY - containerRect.top;
        const radius = Math.max(Math.abs(mx - center.x), Math.abs(my - center.y));
        // Convert rendered radius back to model size, clamp to sensible range
        const newSize = Math.round(Math.min(Math.max((radius * 2) / cy.zoom(), 20), 300));
        n.data('size', newSize);
        updateResizeHandle();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const finalSize = cy.getElementById(nodeId).data('size') as number;
        onResizeNode(nodeId, traceId, finalSize);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    resizeHandleEl.addEventListener('mousedown', onMouseDown);

    // ── Annotation label overlay ──────────────────────────────────────────────

    interface LabelEntry {
      wrapper: HTMLDivElement;
      // Child div owned by the React root. Drag handlers attach to wrapper (parent),
      // so React re-renders of markdownContainer cannot clobber the drag event listeners.
      markdownContainer: HTMLDivElement;
      cleanup: () => void;
      lastRenderedText: string;
    }
    const labelEls = new Map<string, LabelEntry>();

    /** Find the current anchor + traceId for a label by id, from the live ref. */
    const findLabel = (labelId: string): { anchor: LabelAnchor; traceId: string } | null => {
      for (const { traceId, label } of labelsRef.current) {
        if (label.id === labelId) return { anchor: label.anchor, traceId };
      }
      return null;
    };

    /**
     * Convert a rendered drag delta into a new LabelAnchor.
     *
     * edge/txEdge: when t clamps at an endpoint, freeze perpOffset at its
     * pre-drag value to prevent the label silently teleporting perpendicular
     * to the edge. The pre-drag perpOffset is captured in mousedown.
     */
    const computeDraggedAnchor = (
      anchor: LabelAnchor,
      dxRendered: number,
      dyRendered: number,
      preDragPerpOffset: number | null,
    ): LabelAnchor => {
      const zoom = cy.zoom();
      switch (anchor.type) {
        case 'free': {
          const { dx, dy } = modelDeltaFromRenderedDelta({ dx: dxRendered, dy: dyRendered }, zoom);
          return { ...anchor, x: anchor.x + dx, y: anchor.y + dy };
        }
        case 'node': {
          const { dx, dy } = modelDeltaFromRenderedDelta({ dx: dxRendered, dy: dyRendered }, zoom);
          return { ...anchor, dx: anchor.dx + dx, dy: anchor.dy + dy };
        }
        case 'edge':
        case 'txEdge': {
          const ctx = contextFromCy(cy);
          const e = anchor.type === 'txEdge'
            ? ctx.getEdgeByTxHash?.(anchor.txHash)
            : ctx.getEdge?.(anchor.anchorId);
          if (!e) return anchor; // no resolved edge — keep anchor unchanged
          const s = e.source().renderedPosition();
          const t = e.target().renderedPosition();
          // Compute the label's current rendered position, then apply the drag delta.
          const currentPos = resolveLabelRenderedPosition(anchor, ctx);
          if (!currentPos) return anchor;
          const newRenderedPos = { x: currentPos.x + dxRendered, y: currentPos.y + dyRendered };
          const { t: newT, perpOffset: newPerpOffset } = projectPointOntoEdge(newRenderedPos, s, t);
          // When t clamps at an endpoint (0 or 1), tRaw was outside [0,1] meaning the
          // "closest point" on the edge is the endpoint itself. Recomputing perpOffset from
          // there would silently teleport the label perpendicular to the edge. Freeze instead.
          const tClamped = newT === 0 || newT === 1;
          const finalPerpOffset = tClamped && preDragPerpOffset !== null
            ? preDragPerpOffset
            : newPerpOffset / zoom; // convert to model coords
          return { ...anchor, t: newT, perpOffset: finalPerpOffset };
        }
      }
    };

    /** Attach drag + click handlers to a label wrapper div. */
    const attachLabelInteractions = (wrapper: HTMLDivElement, labelId: string, traceId: string) => {
      let dragStart: { x: number; y: number } | null = null;
      let startAnchor: LabelAnchor | null = null; // anchor captured at mousedown — total-delta semantics
      let didDrag = false;
      // Capture pre-drag perpOffset for edge/txEdge anchors so we can freeze it
      // when t clamps at an endpoint during drag (prevents silent teleport).
      let preDragPerpOffset: number | null = null;

      wrapper.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        dragStart = { x: e.clientX, y: e.clientY };
        didDrag = false;

        // Capture anchor once at mousedown. Each mousemove computes the TOTAL delta
        // from dragStart applied to startAnchor — no dependency on React state propagation.
        const current = findLabel(labelId);
        if (!current) {
          startAnchor = null;
          preDragPerpOffset = null;
        } else {
          startAnchor = current.anchor;
          if (current.anchor.type === 'edge' || current.anchor.type === 'txEdge') {
            preDragPerpOffset = current.anchor.perpOffset;
          } else {
            preDragPerpOffset = null;
          }
        }

        const onMove = (ev: MouseEvent) => {
          if (!dragStart || !startAnchor) return;
          // Total delta from mousedown — not incremental. dragStart never resets.
          const dxRendered = ev.clientX - dragStart.x;
          const dyRendered = ev.clientY - dragStart.y;
          if (Math.hypot(dxRendered, dyRendered) > 3) didDrag = true;
          if (!didDrag) return;

          const nextAnchor = computeDraggedAnchor(startAnchor, dxRendered, dyRendered, preDragPerpOffset);
          onLabelMoveRef.current(traceId, labelId, nextAnchor);
          // DO NOT reset dragStart — total-delta semantics require the original mousedown position.
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (!didDrag) {
            // Single click (not drag) = select this label AND open the editor.
            // Also clear Cytoscape's selection so the DetailsPanel and .cy-sel painted
            // state don't show a stale wallet/edge selection.
            onLabelSelectRef.current(labelId);
            unselectAllRef.current();
            onLabelEditRef.current(traceId, labelId);
          }
          dragStart = null;
          startAnchor = null;
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      // dblclick handler removed — single-click now opens the editor directly.
      // Keeping dblclick would fire the editor open twice (once via mouseup, once here).

      wrapper.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onLabelContextMenuRef.current(traceId, labelId, e.clientX, e.clientY);
      });
    };

    const updateLabels = () => {
      const activeIds = new Set<string>();
      const ctx = contextFromCy(cy);

      for (const { traceId, label } of labelsRef.current) {
        activeIds.add(label.id);
        const pos = resolveLabelRenderedPosition(label.anchor, ctx);

        if (!pos) {
          // Anchor element is gone (e.g. tethered to a bundled edge that just got aggregated).
          const existing = labelEls.get(label.id);
          if (existing) existing.wrapper.style.display = 'none';
          continue;
        }

        let entry = labelEls.get(label.id);
        if (!entry) {
          const wrapper = document.createElement('div');
          wrapper.className = 'label-wrapper';
          wrapper.style.cssText = LABEL_WRAPPER_BASE_CSS;

          // markdownContainer is a child div owned by the React root.
          // The wrapper stays under direct DOM control for drag handling — this split
          // prevents React from clobbering the drag-listener DOM during re-renders.
          const markdownContainer = document.createElement('div');
          wrapper.appendChild(markdownContainer);
          overlayEl.appendChild(wrapper);

          const root = createRoot(markdownContainer);
          const cleanup = () => { root.unmount(); wrapper.remove(); };
          const newEntry: LabelEntry = {
            wrapper,
            markdownContainer,
            cleanup,
            lastRenderedText: '\0',
          };
          labelEls.set(label.id, newEntry);
          entry = newEntry;

          attachLabelInteractions(wrapper, label.id, traceId);
        }

        // Position updates: direct DOM, no React re-render.
        entry.wrapper.style.left = `${pos.x}px`;
        entry.wrapper.style.top = `${pos.y}px`;
        entry.wrapper.style.display = '';
        // Selection highlight: toggle class so CSS can style the selected label.
        entry.wrapper.classList.toggle('label-selected', selectedLabelIdRef.current === label.id);

        // Color + bgColor + fontSize + shape: direct style mutation on the wrapper.
        // Applied at wrapper level so color cascades into rendered markdown text.
        applyLabelWrapperStyles(entry.wrapper, label);

        // Markdown re-render: gated on text change. The `render` event fires on every pan/zoom;
        // re-rendering the React tree every time would burn CPU for no visible change.
        if (entry.lastRenderedText !== label.text) {
          renderLabelMarkdownInto(entry.markdownContainer, label.text);
          entry.lastRenderedText = label.text;
        }
      }

      // Tear down labels that no longer exist in the trace data.
      // Must unmount the React root — not just remove the wrapper — to avoid memory leaks.
      labelEls.forEach((entry, id) => {
        if (!activeIds.has(id)) {
          entry.cleanup();
          labelEls.delete(id);
        }
      });
    };

    // ── Render chain ─────────────────────────────────────────────────────────

    const onRender = () => {
      updateEdgeOrientations();
      updateSublabels();
      updateEdgeSublabels();
      updateResizeHandle();
      updateLabels();
    };
    cy.on('render', onRender);
    runOverlayRenderRef.current = onRender;

    return () => {
      cy.off('render', onRender);
      resizeHandleEl.removeEventListener('mousedown', onMouseDown);
      overlayEl.remove();
      sublabelEls.clear();
      edgeSublabelEls.clear();
      // Unmount any live React roots before clearing the map.
      labelEls.forEach((entry) => entry.cleanup());
      labelEls.clear();
      runOverlayRenderRef.current = () => {};
    };
  }, [cy, container, onResizeNode]);

  // Cytoscape only fires 'render' on canvas repaints. Label add/edit/select
  // changes React state but doesn't move any Cytoscape element, so without this
  // the new/updated label wouldn't appear until the user pans, zooms, or clicks.
  useEffect(() => {
    runOverlayRenderRef.current();
  }, [labels, selectedLabelId]);

}
