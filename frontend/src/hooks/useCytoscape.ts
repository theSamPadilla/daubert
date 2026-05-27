import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape, { Core } from 'cytoscape';
import { Investigation, TraceLabel, LabelAnchor } from '../types/investigation';
import { apiClient } from '@/lib/api-client';
import { CYTOSCAPE_STYLE } from './cytoscapeStyle';
import { useCytoscapeOverlays } from './useCytoscapeOverlays';
import type { OverlayHandle } from './useCytoscapeOverlays';
import { bindCytoscapeEvents } from './cytoscapeEvents';
import { syncCytoscape } from './cytoscapeSync';
import { EXPORT_THEMES, type ExportTheme } from '@/lib/exportTheme';
import html2canvas from 'html2canvas';

export type FocusItem =
  | { type: 'wallet'; id: string; traceId: string }
  | { type: 'group'; id: string; traceId: string }
  | { type: 'trace'; id: string }
  | { type: 'transaction'; id: string; traceId: string }
  | { type: 'edgeBundle'; id: string; traceId: string }
  | { type: 'aggregatedEdge'; id: string; traceId: string; edgeIds: string[] }
  | null;

export type SelectionPayload = {
  nodeIds: { id: string; traceId: string }[];
  edgeIds: string[];
  focusItem: FocusItem;
};

export interface CytoscapeCallbacks {
  onSelectionChange?: (payload: SelectionPayload) => void;
  onNodeDrag?: (nodeId: string, position: { x: number; y: number }) => void;
  onGroupDrag?: (groupId: string, newPos: { x: number; y: number }) => void;
  onResizeNode?: (nodeId: string, traceId: string, size: number) => void;
  onContextMenu?: (event: {
    type: 'node' | 'edge' | 'background';
    id?: string;
    x: number;
    y: number;
    /** Model-space coordinates — only present on background context menu events. */
    modelPosition?: { x: number; y: number };
  }) => void;
  /** Fired when the user taps the empty canvas background (not a node or edge). */
  onBackgroundTap?: () => void;
}

/** Label-related controls threaded from GraphCanvas down to useCytoscapeOverlays. */
export interface LabelControls {
  labels: { traceId: string; label: TraceLabel }[];
  onLabelMove: (traceId: string, labelId: string, anchor: LabelAnchor) => void;
  onLabelEdit: (traceId: string, labelId: string) => void;
  onLabelSelect: (labelId: string | null) => void;
  selectedLabelId: string | null;
  /** Fired when the user right-clicks a label overlay div. */
  onLabelContextMenu?: (traceId: string, labelId: string, x: number, y: number) => void;
}

export function useCytoscape(
  investigation: Investigation | null,
  selectedNodeIds: { id: string; traceId: string }[],
  selectedEdgeIds: string[],
  callbacks: CytoscapeCallbacks = {},
  labelControls?: LabelControls,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  // State mirror of cyRef so child hooks (e.g. useCytoscapeOverlays) re-run
  // once Cytoscape is initialized. Refs alone don't trigger re-evaluation.
  const [cy, setCy] = useState<Core | null>(null);
  const callbacksRef = useRef(callbacks);
  const investigationRef = useRef(investigation);
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const selectedEdgeIdsRef = useRef(selectedEdgeIds);

  // Keep refs updated
  callbacksRef.current = callbacks;
  investigationRef.current = investigation;
  selectedNodeIdsRef.current = selectedNodeIds;
  selectedEdgeIdsRef.current = selectedEdgeIds;

  // Init effect — runs once
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: CYTOSCAPE_STYLE,
      layout: { name: 'preset' },
      selectionType: 'additive',
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.3,
    });

    cyRef.current = cy;
    setCy(cy);

    const unbind = bindCytoscapeEvents(cy, {
      getSelection: () => ({
        nodeIds: selectedNodeIdsRef.current,
        edgeIds: selectedEdgeIdsRef.current,
      }),
      getCallbacks: () => callbacksRef.current,
      getContainerRect: () => containerRef.current!.getBoundingClientRect(),
    });

    return () => {
      unbind();
      cy.destroy();
      cyRef.current = null;
      setCy(null);
    };
  }, []); // Only init once

  // Stable wrapper so the overlays effect doesn't tear down every render when
  // the parent's callbacks object changes identity.
  const onResizeNode = useCallback((nodeId: string, traceId: string, size: number) => {
    callbacksRef.current.onResizeNode?.(nodeId, traceId, size);
  }, []);

  // Stable unselectAll passed into useCytoscapeOverlays so label clicks can clear Cytoscape
  // selection. Uses the same ref-delegation pattern as onResizeNode — stable identity regardless
  // of callbacks object churn, and avoids a temporal dependency since unselectAll is declared
  // later in the function body.
  const unselectAllForOverlays = useCallback(() => {
    callbacksRef.current.onSelectionChange?.({ nodeIds: [], edgeIds: [], focusItem: null });
  }, []);

  const overlayHandle: OverlayHandle = useCytoscapeOverlays(
    cy,
    containerRef.current,
    onResizeNode,
    labelControls?.labels,
    labelControls?.onLabelMove,
    labelControls?.onLabelEdit,
    labelControls?.onLabelSelect,
    labelControls?.selectedLabelId,
    unselectAllForOverlays,
    labelControls?.onLabelContextMenu,
  );
  // Mirror overlayHandle into a ref so exportPngDataUrl (stable useCallback) can
  // access the latest overlay element without being re-created on every render.
  const overlayHandleRef = useRef<OverlayHandle>(overlayHandle);
  overlayHandleRef.current = overlayHandle;

  // Selection paint: React state is the source of truth for cy-sel.
  // Reads from refs so the function identity is stable; effect deps below
  // drive when it actually runs.
  const paintSelection = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements('.cy-sel').removeClass('cy-sel');
    selectedNodeIdsRef.current.forEach(({ id }) => {
      const n = cy.getElementById(id);
      if (n.length) n.addClass('cy-sel');
    });
    selectedEdgeIdsRef.current.forEach((id) => {
      const e = cy.getElementById(id);
      if (e.length) e.addClass('cy-sel');
    });
  }, []);

  // Sync effect — diffs investigation data into Cytoscape
  const syncToCytoscape = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    syncCytoscape(cy, investigation);
    paintSelection();
  }, [investigation, paintSelection]);

  useEffect(() => {
    syncToCytoscape();
  }, [syncToCytoscape]);

  useEffect(() => {
    paintSelection();
  }, [selectedNodeIds, selectedEdgeIds, paintSelection]);

  // Fit on first load
  const hasInitialFit = useRef(false);
  useEffect(() => {
    const cy = cyRef.current;
    if (cy && investigation && !hasInitialFit.current) {
      // Small delay to let elements render
      const timer = setTimeout(() => {
        if (!cy.destroyed() && cy.elements().length > 0) {
          cy.fit(undefined, 50);
          hasInitialFit.current = true;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [investigation]);

  const unselectAll = useCallback(() => {
    callbacksRef.current.onSelectionChange?.({ nodeIds: [], edgeIds: [], focusItem: null });
  }, []);

  const exportPngDataUrl = useCallback(async (theme: ExportTheme = 'dark'): Promise<string> => {
    const cy = cyRef.current;
    if (!cy) throw new Error('Cytoscape not initialized');
    const palette = EXPORT_THEMES[theme];

    // Cytoscape's PNG capture only sees the canvas, not the HTML overlays
    // layered on top of it (edge date pills, node truncated-address sublabels —
    // see useCytoscapeOverlays.ts). Temporarily merge that overlay text into
    // the cytoscape labels (which natively support multi-line via \n) so the
    // exported image is WYSIWYG. Also bump font size uniformly on every edge
    // and every non-parent node so the exported PNG has consistent typography
    // and survives scale-down. Restore originals after the snapshot.
    const savedEdgeLabels = new Map<string, string>();
    const savedNodeLabels = new Map<string, string>();
    const styledEdgeIds: string[] = [];
    const styledNodeIds: string[] = [];
    const styledParentIds: string[] = [];
    cy.batch(() => {
      cy.edges().forEach((e) => {
        const date = e.data('date');
        if (date) {
          const orig = (e.data('label') as string | undefined) ?? '';
          savedEdgeLabels.set(e.id(), orig);
          e.data('label', orig ? `${orig}\n${date}` : date);
        }
        e.style({
          'font-size': '14px',
          'font-weight': 'normal',
          'line-height': 1.5,
          'text-background-padding': '5px',
          'text-margin-y': -14,
          'color': palette.edgeLabelColor,
          'text-background-color': palette.edgeLabelBgColor,
        });
        styledEdgeIds.push(e.id());
      });
      cy.nodes().forEach((n) => {
        if (n.isParent()) return;
        const addr = n.data('truncAddr');
        const hasCustomLabel = n.data('hasCustomLabel');
        if (addr && hasCustomLabel) {
          const orig = (n.data('label') as string | undefined) ?? '';
          savedNodeLabels.set(n.id(), orig);
          n.data('label', orig ? `${orig}\n${addr}` : addr);
        }
        n.style({
          'font-size': '14px',
          'line-height': 1.5,
        });
        styledNodeIds.push(n.id());
      });
      cy.nodes(':parent').forEach((p) => {
        // Respect traces with no color set — the stylesheet renders these
        // transparent (`:parent[?noColor]` → opacity 0). Skipping them here
        // preserves that intent in exports.
        if (p.data('noColor')) return;
        p.style({
          'background-opacity': palette.parentBackgroundOpacity,
          'border-opacity': palette.parentBorderOpacity,
        });
        styledParentIds.push(p.id());
      });
    });

    let dataUrl: string;
    try {
      dataUrl = cy.png({ full: true, scale: 2, bg: palette.pngBackground });
    } finally {
      cy.batch(() => {
        savedEdgeLabels.forEach((orig, id) => {
          cy.getElementById(id).data('label', orig);
        });
        savedNodeLabels.forEach((orig, id) => {
          cy.getElementById(id).data('label', orig);
        });
        styledEdgeIds.forEach((id) => {
          cy.getElementById(id).removeStyle(
            'font-size font-weight line-height text-background-padding text-margin-y color text-background-color'
          );
        });
        styledNodeIds.forEach((id) => {
          cy.getElementById(id).removeStyle('font-size line-height');
        });
        styledParentIds.forEach((id) => {
          cy.getElementById(id).removeStyle('background-opacity border-opacity');
        });
      });
    }

    // ── html2canvas composite: rasterize annotation labels onto the Cytoscape PNG ──
    // Only composite if there are user-authored labels and an overlay element.
    const overlayEl = overlayHandleRef.current.getOverlayElement();
    const hasLabels = (investigationRef.current?.traces ?? []).some(
      (t) => (t.labels?.length ?? 0) > 0,
    );
    if (overlayEl && hasLabels) {
      // Identify non-label overlay children (resize handle, address sublabels, edge date pills).
      // Label wrappers carry the 'label-wrapper' class (added in useCytoscapeOverlays.ts).
      // Everything else must be hidden during rasterization so it doesn't appear in the export.
      const childrenToHide: HTMLElement[] = Array.from(overlayEl.children).filter(
        (c) => !(c as HTMLElement).classList.contains('label-wrapper'),
      ) as HTMLElement[];
      const savedDisplays = childrenToHide.map((c) => c.style.display);
      childrenToHide.forEach((c) => { c.style.display = 'none'; });

      let overlayCanvas: HTMLCanvasElement;
      try {
        overlayCanvas = await html2canvas(overlayEl, {
          backgroundColor: null, // transparent — labels have their own bg
          scale: 2,              // matches cy.png({ scale: 2 })
          logging: false,
          useCORS: true,
        });
      } finally {
        childrenToHide.forEach((c, i) => { c.style.display = savedDisplays[i]; });
      }

      // Load the Cytoscape PNG (full extent, scale 2) as an image.
      const baseImg = new Image();
      await new Promise<void>((resolve, reject) => {
        baseImg.onload = () => resolve();
        baseImg.onerror = () => reject(new Error('Failed to load base PNG'));
        baseImg.src = dataUrl;
      });

      // Create a composite canvas matching the full-extent PNG.
      const composite = document.createElement('canvas');
      composite.width = baseImg.width;
      composite.height = baseImg.height;
      const ctx = composite.getContext('2d')!;

      // Draw the Cytoscape full-extent PNG as the base layer.
      ctx.drawImage(baseImg, 0, 0);

      // Compute where the overlay (viewport-sized, screen coords) maps inside the
      // full-extent image. cy.png({ full: true, scale: 2 }) origins at bb.x1 - padding.
      // The visible viewport's top-left in model coords is (-pan.x / zoom, -pan.y / zoom).
      // Subtracting the full-extent origin gives the pixel offset in the full-extent image.
      const bb = cy.elements().boundingBox();
      const padding = 50; // matches cy.fit() padding used in the existing code
      const pan = cy.pan();
      const zoom = cy.zoom();
      const visTopLeftModel = { x: -pan.x / zoom, y: -pan.y / zoom };
      const overlayDestX = (visTopLeftModel.x - (bb.x1 - padding)) * 2;
      const overlayDestY = (visTopLeftModel.y - (bb.y1 - padding)) * 2;
      // The full-extent PNG is rendered at 2 px/model unit (scale: 2, full: true —
      // viewport zoom is ignored). The html2canvas overlay capture, however, is in
      // SCREEN pixels: containerRect.width screen px = containerRect.width / zoom
      // model units. So the destination region in the full PNG must be
      // (containerRect.width / zoom) * 2 pixels — otherwise labels are shifted
      // and scaled by a factor of 1/zoom (visible at any zoom != 1).
      const containerRect = containerRef.current!.getBoundingClientRect();
      const overlayDestW = (containerRect.width / zoom) * 2;
      const overlayDestH = (containerRect.height / zoom) * 2;

      ctx.drawImage(overlayCanvas, overlayDestX, overlayDestY, overlayDestW, overlayDestH);
      dataUrl = composite.toDataURL('image/png');
    }

    return dataUrl;
  }, []);

  const exportImage = useCallback(
    async (
      format: 'png' | 'pdf',
      filename = 'graph',
      theme: ExportTheme = 'dark',
      orientation?: 'portrait' | 'landscape',
    ) => {
      const dataUrl = await exportPngDataUrl(theme);

      if (format === 'png') {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${filename}.png`;
        a.click();
      } else {
        await apiClient.exportGraph(filename, filename, dataUrl, { orientation });
      }
    },
    [exportPngDataUrl],
  );

  const setEdgeArc = useCallback((edgeId: string, delta: number | null) => {
    const cy = cyRef.current;
    if (!cy) return;
    const edge = cy.getElementById(edgeId);
    if (!edge || edge.length === 0) return;
    if (delta === null) {
      // Reset: remove arc, fall back to auto bezier fanning
      edge.removeData('arcOffset');
      edge.removeData('hasArc');
    } else {
      const next = ((edge.data('arcOffset') as number) || 0) + delta;
      edge.data('arcOffset', next);
      edge.data('hasArc', true);
    }
  }, []);

  return { containerRef, cy, unselectAll, exportImage, exportPngDataUrl, setEdgeArc };
}
