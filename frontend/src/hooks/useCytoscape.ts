import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape, { Core } from 'cytoscape';
import { Investigation } from '../types/investigation';
import { apiClient } from '@/lib/api-client';
import { CYTOSCAPE_STYLE } from './cytoscapeStyle';
import { useCytoscapeOverlays } from './useCytoscapeOverlays';
import { bindCytoscapeEvents } from './cytoscapeEvents';
import { syncCytoscape } from './cytoscapeSync';

export type FocusItem =
  | { type: 'wallet'; id: string; traceId: string }
  | { type: 'group'; id: string; traceId: string }
  | { type: 'trace'; id: string }
  | { type: 'transaction'; id: string; traceId: string }
  | { type: 'edgeBundle'; id: string; traceId: string }
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
  onContextMenu?: (event: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number }) => void;
  onDoubleClickBackground?: (position: { x: number; y: number }) => void;
}

export function useCytoscape(
  investigation: Investigation | null,
  selectedNodeIds: { id: string; traceId: string }[],
  selectedEdgeIds: string[],
  callbacks: CytoscapeCallbacks = {}
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

  useCytoscapeOverlays(cy, containerRef.current, onResizeNode);

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

  const exportImage = useCallback(async (format: 'png' | 'pdf', filename = 'graph') => {
    const cy = cyRef.current;
    if (!cy) return;
    const dataUrl = cy.png({ full: true, scale: 2, bg: '#ffffff' });
    if (format === 'png') {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${filename}.png`;
      a.click();
    } else {
      try {
        await apiClient.exportGraph(filename, dataUrl);
      } catch (err) {
        alert(`PDF export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }, []);

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

  return { containerRef, unselectAll, exportImage, setEdgeArc };
}
