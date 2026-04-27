import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import { Investigation } from '../types/investigation';
import { formatTokenAmount, normalizeToken, parseTimestamp } from '../utils/formatAmount';
import { apiClient } from '@/lib/api-client';
import { CYTOSCAPE_STYLE, contrastTextColor, formatShortDate } from './cytoscapeStyle';
import { useCytoscapeOverlays } from './useCytoscapeOverlays';

export interface CytoscapeCallbacks {
  onSelectItem?: (item: any) => void;
  onMultiSelect?: (nodes: { id: string; traceId: string }[]) => void;
  onMultiSelectEdges?: (edgeIds: string[]) => void;
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

    // ── Node tap ─────────────────────────────────────────────────────────
    cy.on('tap', 'node', (event: EventObject) => {
      const node = event.target;
      const inv = investigationRef.current;
      if (!inv) return;

      const nodeId = node.data('id');
      const traceId = node.data('traceId') || node.data('parent');
      const isShift = event.originalEvent.shiftKey;
      const isCollapsedGroup = !!node.data('isCollapsedGroup');
      const isExpandedGroup = node.isParent() && !!node.data('isGroup');
      const isTraceCompound = node.isParent() && !node.data('isGroup');

      // Trace compound (not a group): always solo-select the trace, ignore shift
      if (isTraceCompound) {
        const trace = inv.traces.find((t) => t.id === nodeId);
        callbacksRef.current.onSelectItem?.({ type: 'trace', data: trace });
        return;
      }

      const fireSoloItem = () => {
        if (isCollapsedGroup || isExpandedGroup) {
          for (const trace of inv.traces) {
            const group = (trace.groups || []).find((g) => g.id === nodeId);
            if (group) { callbacksRef.current.onSelectItem?.({ type: 'group', data: group }); return; }
          }
        } else {
          const trace = inv.traces.find((t) => t.id === traceId);
          const walletNode = trace?.nodes.find((w: any) => w.id === nodeId);
          if (walletNode) callbacksRef.current.onSelectItem?.({ type: 'wallet', data: walletNode });
        }
      };

      if (isShift) {
        // Shift+click: toggle node in/out of multi-select. Edges & item stay.
        const exists = selectedNodeIdsRef.current.some((n) => n.id === nodeId);
        const next = exists
          ? selectedNodeIdsRef.current.filter((n) => n.id !== nodeId)
          : [...selectedNodeIdsRef.current, { id: nodeId, traceId }];
        callbacksRef.current.onMultiSelect?.(next);
      } else {
        const isSoloSelected =
          selectedNodeIdsRef.current.length === 1 &&
          selectedNodeIdsRef.current[0].id === nodeId &&
          selectedEdgeIdsRef.current.length === 0;
        if (isSoloSelected) {
          callbacksRef.current.onSelectItem?.(null);
        } else {
          fireSoloItem();
        }
      }
    });

    // ── Edge tap ─────────────────────────────────────────────────────────
    cy.on('tap', 'edge', (event: EventObject) => {
      const edge = event.target;
      const inv = investigationRef.current;
      const edgeId = edge.data('id');
      const isShift = event.originalEvent.shiftKey;

      const fireSoloItem = () => {
        if (edge.data('isBundleEdge')) {
          for (const trace of inv?.traces || []) {
            const bundle = (trace.edgeBundles || []).find((b) => b.id === edgeId);
            if (bundle) { callbacksRef.current.onSelectItem?.({ type: 'edgeBundle', data: bundle }); return; }
          }
        } else {
          for (const trace of inv?.traces || []) {
            const tx = trace.edges.find((e: any) => e.id === edgeId);
            if (tx) { callbacksRef.current.onSelectItem?.({ type: 'transaction', data: tx }); return; }
          }
        }
      };

      if (isShift) {
        // Shift+click: toggle edge in/out of multi-select. Nodes & item stay.
        const exists = selectedEdgeIdsRef.current.includes(edgeId);
        const next = exists
          ? selectedEdgeIdsRef.current.filter((id) => id !== edgeId)
          : [...selectedEdgeIdsRef.current, edgeId];
        callbacksRef.current.onMultiSelectEdges?.(next);
      } else {
        const isSoloSelected =
          selectedEdgeIdsRef.current.length === 1 &&
          selectedEdgeIdsRef.current[0] === edgeId &&
          selectedNodeIdsRef.current.length === 0;
        if (isSoloSelected) {
          callbacksRef.current.onSelectItem?.(null);
        } else {
          fireSoloItem();
        }
      }
    });

    // ── Background tap ───────────────────────────────────────────────────
    cy.on('tap', (event: EventObject) => {
      if (event.target === cy) {
        callbacksRef.current.onSelectItem?.(null);
      }
    });

    // ── Box / rubber-band selection ───────────────────────────────────────
    // Shift+drag is additive: merge box-selected nodes & edges with the current
    // React selection arrays. No heuristic clearing — mixed node+edge selections
    // are allowed and the React layer decides what to render.
    cy.on('boxend', () => {
      const nativelyNodes = cy.nodes(':selected').filter((n: any) => !n.isParent() || n.data('isGroup'));
      const nativelyEdges = cy.edges(':selected');
      cy.elements().unselect();
      if (nativelyNodes.length === 0 && nativelyEdges.length === 0) return;

      const existingNodeIds = new Set(selectedNodeIdsRef.current.map((n) => n.id));
      const newNodes: { id: string; traceId: string }[] = [];
      nativelyNodes.forEach((n: any) => {
        const id = n.data('id');
        if (!existingNodeIds.has(id)) {
          newNodes.push({ id, traceId: n.data('traceId') || n.data('parent') });
        }
      });
      const nextNodeIds = [...selectedNodeIdsRef.current, ...newNodes];

      const existingEdgeIds = new Set(selectedEdgeIdsRef.current);
      const newEdges: string[] = [];
      nativelyEdges.forEach((e: any) => {
        const id = e.data('id');
        if (!existingEdgeIds.has(id)) newEdges.push(id);
      });
      const nextEdgeIds = [...selectedEdgeIdsRef.current, ...newEdges];

      if (newNodes.length > 0) callbacksRef.current.onMultiSelect?.(nextNodeIds);
      if (newEdges.length > 0) callbacksRef.current.onMultiSelectEdges?.(nextEdgeIds);
    });

    // Drag handler
    cy.on('dragfree', 'node', (event: EventObject) => {
      const node = event.target;
      if (node.isParent()) {
        // Expanded compound (group/trace) dragged — children move with it but
        // don't fire their own dragfree events. Save all leaf descendants.
        node.descendants().not(':parent').forEach((child: any) => {
          const pos = child.position();
          callbacksRef.current.onNodeDrag?.(child.data('id'), { x: pos.x, y: pos.y });
        });
        return;
      }
      if (node.data('isCollapsedGroup')) {
        // Collapsed group is a leaf placeholder — delegate to page.tsx which
        // knows the member nodes and can apply the offset to each.
        const pos = node.position();
        callbacksRef.current.onGroupDrag?.(node.data('id'), { x: pos.x, y: pos.y });
        return;
      }
      const pos = node.position();
      callbacksRef.current.onNodeDrag?.(node.data('id'), { x: pos.x, y: pos.y });
    });

    // Context menu handlers
    cy.on('cxttap', 'node', (event: EventObject) => {
      const node = event.target;
      const renderedPos = event.renderedPosition || event.position;
      const containerRect = containerRef.current!.getBoundingClientRect();
      callbacksRef.current.onContextMenu?.({
        type: 'node',
        id: node.data('id'),
        x: containerRect.left + renderedPos.x,
        y: containerRect.top + renderedPos.y,
      });
    });

    cy.on('cxttap', 'edge', (event: EventObject) => {
      const edge = event.target;
      const renderedPos = event.renderedPosition || event.position;
      const containerRect = containerRef.current!.getBoundingClientRect();
      callbacksRef.current.onContextMenu?.({
        type: 'edge',
        id: edge.data('id'),
        x: containerRect.left + renderedPos.x,
        y: containerRect.top + renderedPos.y,
      });
    });

    cy.on('cxttap', (event: EventObject) => {
      if (event.target === cy) {
        const renderedPos = event.renderedPosition || event.position;
        const containerRect = containerRef.current!.getBoundingClientRect();
        callbacksRef.current.onContextMenu?.({
          type: 'background',
          x: containerRect.left + renderedPos.x,
          y: containerRect.top + renderedPos.y,
        });
      }
    });

    // Double-click background for creating wallets
    cy.on('dbltap', (event: EventObject) => {
      if (event.target === cy) {
        const pos = event.position;
        callbacksRef.current.onDoubleClickBackground?.({ x: pos.x, y: pos.y });
      }
    });

    // Edge hover highlight
    cy.on('mouseover', 'edge', (event: EventObject) => {
      event.target.addClass('hovered');
    });
    cy.on('mouseout', 'edge', (event: EventObject) => {
      event.target.removeClass('hovered');
    });

    return () => {
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

    const inv = investigation;
    if (!inv) {
      cy.elements().remove();
      return;
    }

    // Build target element maps
    const targetNodes = new Map<string, any>();
    const targetEdges = new Map<string, any>();

    // Global map: nodeId → effective display nodeId (handles collapsed groups/traces across all traces)
    const globalEffectiveId = new Map<string, string>();
    inv.traces.forEach((trace) => {
      if (!trace.visible) return;
      if (trace.collapsed) {
        trace.nodes.forEach((n) => globalEffectiveId.set(n.id, trace.id));
      } else {
        const collapsedGroupIds = new Set<string>((trace.groups || []).filter((g) => g.collapsed).map((g) => g.id));
        trace.nodes.forEach((n) => {
          globalEffectiveId.set(n.id, n.groupId && collapsedGroupIds.has(n.groupId) ? n.groupId : n.id);
        });
      }
    });

    // Build global set of edge IDs hidden by collapsed bundles (across ALL traces)
    // so cross-trace bundled edges are properly hidden regardless of which trace owns the bundle
    const globalBundledEdgeIds = new Set<string>();
    inv.traces.forEach((t) => {
      (t.edgeBundles || []).forEach((b) => {
        if (b.collapsed) b.edgeIds.forEach((id) => globalBundledEdgeIds.add(id));
      });
    });

    inv.traces.forEach((trace) => {
      if (!trace.visible) return;

      const traceColor = trace.color || '';

      if (trace.collapsed) {
        // Collapsed trace: single node with wallet count label
        targetNodes.set(trace.id, {
          data: {
            id: trace.id,
            label: `${trace.name} (${trace.nodes.length})`,
            color: traceColor || '#3b82f6',
            textColor: contrastTextColor(traceColor || '#3b82f6'),
            noColor: !traceColor,
            collapsed: true,
          },
          position: trace.position || { x: 0, y: 0 },
        });
      } else {
        // Parent node for trace — font size scales with node count
        const traceFontSize = Math.round(Math.min(Math.max(12 + Math.sqrt(trace.nodes.length) * 2.5, 12), 36));
        targetNodes.set(trace.id, {
          data: {
            id: trace.id,
            label: trace.name,
            color: traceColor || '#3b82f6',
            noColor: !traceColor,
            collapsed: false,
            fontSize: traceFontSize,
          },
          position: trace.position || { x: 0, y: 0 },
        });

        // Group nodes (compound if expanded, leaf node if collapsed)
        (trace.groups || []).forEach((group) => {
          const noColor = group.color === null;
          const groupColor = noColor ? '#6b7280' : (group.color || traceColor || '#60a5fa');
          if (group.collapsed) {
            const gMembers = trace.nodes.filter((n) => n.groupId === group.id);
            const cx = gMembers.reduce((s, n) => s + n.position.x, 0) / (gMembers.length || 1);
            const cy2 = gMembers.reduce((s, n) => s + n.position.y, 0) / (gMembers.length || 1);
            targetNodes.set(group.id, {
              data: { id: group.id, parent: trace.id, traceId: trace.id, label: group.name, displayLabel: `${group.name} (${gMembers.length})`, color: groupColor, textColor: contrastTextColor(groupColor), size: group.size || 70, isCollapsedGroup: true, noColor: noColor || undefined },
              position: { x: cx, y: cy2 },
            });
          } else {
            targetNodes.set(group.id, {
              data: { id: group.id, parent: trace.id, label: group.name, color: groupColor, isGroup: true, noColor: noColor || undefined },
            });
          }
        });

        // Wallet nodes (skip members of collapsed groups — use global map)
        trace.nodes.forEach((node) => {
          if (globalEffectiveId.get(node.id) !== node.id) return; // hidden by collapse
          const addr = node.address;
          const truncAddr = addr && addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr || '';
          const hasCustomLabel = !!(node.label && node.label !== addr && node.label !== truncAddr);
          const displayLabel = hasCustomLabel ? node.label : (truncAddr || node.label);
          const groupExists = node.groupId && (trace.groups || []).some((g) => g.id === node.groupId && !g.collapsed);
          const parentId = groupExists ? node.groupId! : trace.id;
          const nodeColor = node.color || '#60a5fa';
          const addrTypeShape = node.addressType === 'contract' ? 'roundrectangle' : (node.addressType as string) === 'exchange' ? 'diamond' : 'ellipse';
          const nodeShape = node.shape || addrTypeShape;
          targetNodes.set(node.id, {
            data: { id: node.id, parent: parentId, traceId: trace.id, label: node.label, displayLabel, hasCustomLabel, truncAddr, color: nodeColor, textColor: contrastTextColor(nodeColor), size: node.size || 60, addressType: node.addressType || 'unknown', nodeShape },
            position: node.position,
          });
        });

        // Edges — re-route & aggregate for collapsed groups, skip bundled edges
        const edgeW = (h: number) => h > 0 ? Math.min(Math.max(1.5 + Math.pow(h, 0.2) * 0.28, 1.5), 14) : 1.5;
        const abbr = (h: number) =>
          h >= 1e12 ? `${(h/1e12).toFixed(2).replace(/\.?0+$/, '')}T`
          : h >= 1e9 ? `${(h/1e9).toFixed(2).replace(/\.?0+$/, '')}B`
          : h >= 1e6 ? `${(h/1e6).toFixed(1).replace(/\.?0+$/, '')}M`
          : h >= 1e3 ? `${(h/1e3).toFixed(1).replace(/\.?0+$/, '')}K`
          : h.toLocaleString(undefined, { maximumFractionDigits: 1 });

        const aggEdges = new Map<string, { src: string; tgt: string; human: number; sym: string; color: string; date: string; n: number }>();

        trace.edges.forEach((edge) => {
          if (globalBundledEdgeIds.has(edge.id)) return; // rendered as bundle edge
          // Use global effective IDs so cross-trace collapsed groups/traces are handled
          const effFrom = globalEffectiveId.get(edge.from) ?? edge.from;
          const effTo   = globalEffectiveId.get(edge.to)   ?? edge.to;
          if (effFrom === effTo) return;
          // Skip if either endpoint isn't in a visible trace (globalEffectiveId covers all visible traces)
          if (!globalEffectiveId.has(edge.from)) return;
          if (!globalEffectiveId.has(edge.to)) return;
          const tok = normalizeToken(edge.token);
          const raw = parseFloat(String(edge.amount)) || 0;
          const human = tok.decimals > 0 ? raw / Math.pow(10, tok.decimals) : raw;
          if (effFrom !== edge.from || effTo !== edge.to) {
            const key = `${effFrom}::${effTo}::${tok.symbol}`;
            const ex = aggEdges.get(key);
            if (ex) { ex.human += human; ex.n++; }
            else aggEdges.set(key, { src: effFrom, tgt: effTo, human, sym: tok.symbol, color: edge.color || '#10b981', date: formatShortDate(edge.timestamp), n: 1 });
          } else {
            const amountLabel = `${formatTokenAmount(edge.amount, tok.decimals)} ${tok.symbol}`;
            const label = edge.label || amountLabel;
            const date = formatShortDate(edge.timestamp);
            targetEdges.set(edge.id, { data: { id: edge.id, source: edge.from, target: edge.to, label, date, color: edge.color || '#10b981', lineStyle: edge.lineStyle || 'solid', weight: edgeW(human) } });
          }
        });

        aggEdges.forEach((a, key) => {
          const label = `${abbr(a.human)} ${a.sym}${a.n > 1 ? ` (${a.n})` : ''}`;
          targetEdges.set(key, { data: { id: key, source: a.src, target: a.tgt, label, date: a.date, color: a.color, lineStyle: 'solid', weight: edgeW(a.human) } });
        });

        // Render collapsed bundles as single aggregated edges
        (trace.edgeBundles || []).forEach((bundle) => {
          if (!bundle.collapsed) return;
          const bundleEdges = bundle.edgeIds.map((id) => trace.edges.find((e) => e.id === id)).filter(Boolean) as any[];
          if (bundleEdges.length === 0) return;
          // Sum per-edge using each edge's own token decimals
          let totalHuman = 0;
          let labelSym = bundle.token;
          bundleEdges.forEach((e, i) => {
            const tok = normalizeToken(e.token);
            if (i === 0) labelSym = tok.symbol;
            const raw = parseFloat(String(e.amount)) || 0;
            totalHuman += tok.decimals > 0 ? raw / Math.pow(10, tok.decimals) : raw;
          });
          const label = `${abbr(totalHuman)} ${labelSym} (${bundleEdges.length})`;
          const color = bundle.color || bundleEdges[0].color || '#f59e0b';
          // Compute date range for the bundle sublabel
          const timestamps = bundleEdges
            .map((e: any) => parseTimestamp(e.timestamp))
            .filter((d: Date) => !isNaN(d.getTime()))
            .sort((a: Date, b: Date) => a.getTime() - b.getTime());
          let dateLabel = '';
          if (timestamps.length > 0) {
            const oldest = timestamps[0];
            const newest = timestamps[timestamps.length - 1];
            dateLabel = oldest.getTime() === newest.getTime()
              ? formatShortDate(oldest.getTime() / 1000)
              : `${formatShortDate(oldest.getTime() / 1000)} — ${formatShortDate(newest.getTime() / 1000)}`;
          }
          targetEdges.set(bundle.id, { data: { id: bundle.id, source: bundle.fromNodeId, target: bundle.toNodeId, label, date: dateLabel, color, weight: edgeW(totalHuman), isBundleEdge: true } });
        });
      }
    });

    // Remove elements not in target
    cy.nodes().forEach((ele) => {
      if (!targetNodes.has(ele.data('id'))) {
        ele.remove();
      }
    });
    cy.edges().forEach((ele) => {
      if (!targetEdges.has(ele.data('id'))) {
        ele.remove();
      }
    });

    // Add/update nodes
    targetNodes.forEach((target, id) => {
      const existing = cy.getElementById(id);
      if (existing.length > 0) {
        // Update data — but 'parent' is structural in Cytoscape and cannot be
        // changed via .data(). Use .move() to reparent, and remove+re-add if
        // the position also needs to change (e.g. after trace extraction).
        const curData = existing.data();
        if ('parent' in target.data && curData.parent !== target.data.parent) {
          // Reparent: move to new compound parent then re-add at correct position
          existing.move({ parent: (target.data as any).parent ?? null });
          if (target.position) {
            existing.position(target.position);
          }
        }
        for (const [key, val] of Object.entries(target.data)) {
          if (key === 'parent') continue; // handled above via .move()
          if (curData[key] !== val) {
            existing.data(key, val);
          }
        }
      } else {
        // Add new node
        cy.add({ group: 'nodes', ...target });
      }
    });

    // Add/update edges
    targetEdges.forEach((target, id) => {
      const existing = cy.getElementById(id);
      if (existing.length > 0) {
        const curData = existing.data();
        for (const [key, val] of Object.entries(target.data)) {
          if (curData[key] !== val) {
            existing.data(key, val);
          }
        }
      } else {
        // Guard: skip if endpoints don't exist (e.g. source in a hidden trace)
        if (!cy.getElementById(target.data.source).length || !cy.getElementById(target.data.target).length) return;
        cy.add({ group: 'edges', ...target });
      }
    });

    // Re-paint selection on freshly-added/updated elements so cy-sel survives the diff.
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
    callbacksRef.current.onSelectItem?.(null);
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
