import { useEffect } from 'react';
import type { Core } from 'cytoscape';

type OnResizeNode = (nodeId: string, traceId: string, size: number) => void;

// DOM overlays layered on top of the Cytoscape canvas:
//   - address sublabels (small truncated address under custom-labeled wallet nodes)
//   - edge date sublabels (small date pill at the midpoint of every edge)
//   - near-vertical edge orientation class (keeps labels horizontal when steep)
//   - resize handle (yellow square at bottom-right of the single selected wallet/group)
//
// All overlays are positioned via the `render` event Cytoscape fires whenever
// the viewport or any element moves. They live in a single absolute-positioned
// div appended next to the Cytoscape canvas.
export function useCytoscapeOverlays(
  cy: Core | null,
  container: HTMLDivElement | null,
  onResizeNode: OnResizeNode
) {
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

    const onRender = () => {
      updateEdgeOrientations();
      updateSublabels();
      updateEdgeSublabels();
      updateResizeHandle();
    };
    cy.on('render', onRender);

    return () => {
      cy.off('render', onRender);
      resizeHandleEl.removeEventListener('mousedown', onMouseDown);
      overlayEl.remove();
      sublabelEls.clear();
      edgeSublabelEls.clear();
    };
  }, [cy, container, onResizeNode]);
}
