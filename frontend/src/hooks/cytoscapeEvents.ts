import type { Core, EventObject } from 'cytoscape';
import type { CytoscapeCallbacks, FocusItem } from './useCytoscape';

export interface SelectionSnapshot {
  nodeIds: { id: string; traceId: string }[];
  edgeIds: string[];
}

export interface CytoscapeEventGetters {
  getSelection: () => SelectionSnapshot;
  getCallbacks: () => CytoscapeCallbacks;
  getContainerRect: () => DOMRect;
}

export function bindCytoscapeEvents(cy: Core, getters: CytoscapeEventGetters): () => void {
  // Capture each handler so we can selectively cy.off(event, handler).
  // Do NOT call cy.removeAllListeners() — useCytoscapeOverlays registers
  // cy.on('render', ...) and we'd tear that down too.

  // ── Node tap ─────────────────────────────────────────────────────────
  const onTapNode = (event: EventObject) => {
    const node = event.target;
    const nodeId = node.data('id');
    const traceId = node.data('traceId') || node.data('parent');
    const isShift = !!event.originalEvent?.shiftKey;
    const isCollapsedGroup = !!node.data('isCollapsedGroup');
    const isExpandedGroup = node.isParent() && !!node.data('isGroup');
    const isTraceCompound = node.isParent() && !node.data('isGroup');

    // Build the FocusItem from Cytoscape data attributes only — page.tsx resolves data.
    const buildFocusItem = (): FocusItem => {
      if (isTraceCompound) return { type: 'trace', id: nodeId };
      if (isCollapsedGroup || isExpandedGroup) return { type: 'group', id: nodeId, traceId };
      return { type: 'wallet', id: nodeId, traceId };
    };

    // Trace compound (not a group): always solo-focus the trace, ignore shift.
    // Trace compounds aren't selectable wallets — keep nodeIds/edgeIds empty.
    if (isTraceCompound) {
      getters.getCallbacks().onSelectionChange?.({
        nodeIds: [],
        edgeIds: [],
        focusItem: { type: 'trace', id: nodeId },
      });
      return;
    }

    const selection = getters.getSelection();

    if (isShift) {
      // Shift+click: toggle node in/out of multi-select. Multi-select clears focus panel.
      const exists = selection.nodeIds.some((n) => n.id === nodeId);
      const next = exists
        ? selection.nodeIds.filter((n) => n.id !== nodeId)
        : [...selection.nodeIds, { id: nodeId, traceId }];
      getters.getCallbacks().onSelectionChange?.({
        nodeIds: next,
        edgeIds: selection.edgeIds,
        focusItem: null,
      });
    } else {
      const isSoloSelected =
        selection.nodeIds.length === 1 &&
        selection.nodeIds[0].id === nodeId &&
        selection.edgeIds.length === 0;
      if (isSoloSelected) {
        // Click on the only-selected node deselects.
        getters.getCallbacks().onSelectionChange?.({ nodeIds: [], edgeIds: [], focusItem: null });
      } else {
        getters.getCallbacks().onSelectionChange?.({
          nodeIds: [{ id: nodeId, traceId }],
          edgeIds: [],
          focusItem: buildFocusItem(),
        });
      }
    }
  };

  // ── Edge tap ─────────────────────────────────────────────────────────
  const onTapEdge = (event: EventObject) => {
    const edge = event.target;
    const edgeId = edge.data('id');
    const isShift = !!event.originalEvent?.shiftKey;
    const traceId: string = edge.data('traceId') || '';
    const isBundle = !!edge.data('isBundleEdge');

    const buildFocusItem = (): FocusItem =>
      isBundle
        ? { type: 'edgeBundle', id: edgeId, traceId }
        : { type: 'transaction', id: edgeId, traceId };

    const selection = getters.getSelection();

    if (isShift) {
      // Shift+click: toggle edge in/out of multi-select. Multi-select clears focus panel.
      const exists = selection.edgeIds.includes(edgeId);
      const next = exists
        ? selection.edgeIds.filter((id) => id !== edgeId)
        : [...selection.edgeIds, edgeId];
      getters.getCallbacks().onSelectionChange?.({
        nodeIds: selection.nodeIds,
        edgeIds: next,
        focusItem: null,
      });
    } else {
      const isSoloSelected =
        selection.edgeIds.length === 1 &&
        selection.edgeIds[0] === edgeId &&
        selection.nodeIds.length === 0;
      if (isSoloSelected) {
        getters.getCallbacks().onSelectionChange?.({ nodeIds: [], edgeIds: [], focusItem: null });
      } else {
        getters.getCallbacks().onSelectionChange?.({
          nodeIds: [],
          edgeIds: [edgeId],
          focusItem: buildFocusItem(),
        });
      }
    }
  };

  // ── Background tap ───────────────────────────────────────────────────
  const onTapBackground = (event: EventObject) => {
    if (event.target === cy) {
      getters.getCallbacks().onSelectionChange?.({ nodeIds: [], edgeIds: [], focusItem: null });
    }
  };

  // ── Box / rubber-band selection ───────────────────────────────────────
  // Shift+drag is additive: merge box-selected nodes & edges with the current
  // React selection arrays. No heuristic clearing — mixed node+edge selections
  // are allowed and the React layer decides what to render.
  const onBoxEnd = () => {
    // Cytoscape may not have applied :selected to elements yet when boxend
    // fires. Defer one frame to let the selection state settle.
    requestAnimationFrame(() => {
    const nativelyNodes = cy.nodes(':selected').filter((n: any) => !n.isParent() || n.data('isGroup'));
    const nativelyEdges = cy.edges(':selected');
    cy.elements().unselect();
    if (nativelyNodes.length === 0 && nativelyEdges.length === 0) return;

    const selection = getters.getSelection();
    const existingNodeIds = new Set(selection.nodeIds.map((n) => n.id));
    const newNodes: { id: string; traceId: string }[] = [];
    nativelyNodes.forEach((n: any) => {
      const id = n.data('id');
      if (!existingNodeIds.has(id)) {
        newNodes.push({ id, traceId: n.data('traceId') || n.data('parent') });
      }
    });
    const nextNodeIds = [...selection.nodeIds, ...newNodes];

    const existingEdgeIds = new Set(selection.edgeIds);
    const newEdges: string[] = [];
    nativelyEdges.forEach((e: any) => {
      const id = e.data('id');
      if (!existingEdgeIds.has(id)) newEdges.push(id);
    });
    const nextEdgeIds = [...selection.edgeIds, ...newEdges];

    // Paint immediately so the user sees feedback before the React cycle
    // completes. The paint effect will re-paint from refs after render,
    // but this gives instant visual feedback.
    nextNodeIds.forEach(({ id }) => {
      const el = cy.getElementById(id);
      if (el.length) el.addClass('cy-sel');
    });
    nextEdgeIds.forEach((id) => {
      const el = cy.getElementById(id);
      if (el.length) el.addClass('cy-sel');
    });

    // Multi-select clears the focus panel.
    getters.getCallbacks().onSelectionChange?.({
      nodeIds: nextNodeIds,
      edgeIds: nextEdgeIds,
      focusItem: null,
    });
    }); // end requestAnimationFrame
  };

  // Drag handler
  const onDragFreeNode = (event: EventObject) => {
    const node = event.target;
    if (node.isParent()) {
      // Expanded compound (group/trace) dragged — children move with it but
      // don't fire their own dragfree events. Save all leaf descendants.
      node.descendants().not(':parent').forEach((child: any) => {
        const pos = child.position();
        getters.getCallbacks().onNodeDrag?.(child.data('id'), { x: pos.x, y: pos.y });
      });
      return;
    }
    if (node.data('isCollapsedGroup')) {
      // Collapsed group is a leaf placeholder — delegate to page.tsx which
      // knows the member nodes and can apply the offset to each.
      const pos = node.position();
      getters.getCallbacks().onGroupDrag?.(node.data('id'), { x: pos.x, y: pos.y });
      return;
    }
    const pos = node.position();
    getters.getCallbacks().onNodeDrag?.(node.data('id'), { x: pos.x, y: pos.y });
  };

  // Context menu handlers
  const onCxtTapNode = (event: EventObject) => {
    const node = event.target;
    const renderedPos = event.renderedPosition || event.position;
    const containerRect = getters.getContainerRect();
    getters.getCallbacks().onContextMenu?.({
      type: 'node',
      id: node.data('id'),
      x: containerRect.left + renderedPos.x,
      y: containerRect.top + renderedPos.y,
    });
  };

  const onCxtTapEdge = (event: EventObject) => {
    const edge = event.target;
    const renderedPos = event.renderedPosition || event.position;
    const containerRect = getters.getContainerRect();
    getters.getCallbacks().onContextMenu?.({
      type: 'edge',
      id: edge.data('id'),
      x: containerRect.left + renderedPos.x,
      y: containerRect.top + renderedPos.y,
    });
  };

  const onCxtTapBackground = (event: EventObject) => {
    if (event.target === cy) {
      const renderedPos = event.renderedPosition || event.position;
      const containerRect = getters.getContainerRect();
      getters.getCallbacks().onContextMenu?.({
        type: 'background',
        x: containerRect.left + renderedPos.x,
        y: containerRect.top + renderedPos.y,
      });
    }
  };

  // Double-click background for creating wallets
  const onDblTapBackground = (event: EventObject) => {
    if (event.target === cy) {
      const pos = event.position;
      getters.getCallbacks().onDoubleClickBackground?.({ x: pos.x, y: pos.y });
    }
  };

  // Edge hover highlight
  const onEdgeMouseOver = (event: EventObject) => {
    event.target.addClass('hovered');
  };
  const onEdgeMouseOut = (event: EventObject) => {
    event.target.removeClass('hovered');
  };

  cy.on('tap', 'node', onTapNode);
  cy.on('tap', 'edge', onTapEdge);
  cy.on('tap', onTapBackground);
  cy.on('boxend', onBoxEnd);
  cy.on('dragfree', 'node', onDragFreeNode);
  cy.on('cxttap', 'node', onCxtTapNode);
  cy.on('cxttap', 'edge', onCxtTapEdge);
  cy.on('cxttap', onCxtTapBackground);
  cy.on('dbltap', onDblTapBackground);
  cy.on('mouseover', 'edge', onEdgeMouseOver);
  cy.on('mouseout', 'edge', onEdgeMouseOut);

  return () => {
    cy.off('tap', 'node', onTapNode);
    cy.off('tap', 'edge', onTapEdge);
    cy.off('tap', onTapBackground);
    cy.off('boxend', onBoxEnd);
    cy.off('dragfree', 'node', onDragFreeNode);
    cy.off('cxttap', 'node', onCxtTapNode);
    cy.off('cxttap', 'edge', onCxtTapEdge);
    cy.off('cxttap', onCxtTapBackground);
    cy.off('dbltap', onDblTapBackground);
    cy.off('mouseover', 'edge', onEdgeMouseOver);
    cy.off('mouseout', 'edge', onEdgeMouseOut);
  };
}
