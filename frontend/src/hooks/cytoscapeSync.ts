import type { Core } from 'cytoscape';
import type { Investigation } from '../types/investigation';
import { contrastTextColor, formatShortDate } from './cytoscapeStyle';
import { formatTokenAmount, normalizeToken, parseTimestamp } from '../utils/formatAmount';

export function syncCytoscape(cy: Core, investigation: Investigation | null): void {
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
          targetEdges.set(edge.id, { data: { id: edge.id, source: edge.from, target: edge.to, traceId: trace.id, label, date, color: edge.color || '#10b981', lineStyle: edge.lineStyle || 'solid', weight: edgeW(human) } });
        }
      });

      aggEdges.forEach((a, key) => {
        const label = `${abbr(a.human)} ${a.sym}${a.n > 1 ? ` (${a.n})` : ''}`;
        targetEdges.set(key, { data: { id: key, source: a.src, target: a.tgt, traceId: trace.id, label, date: a.date, color: a.color, lineStyle: 'solid', weight: edgeW(a.human) } });
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
        targetEdges.set(bundle.id, { data: { id: bundle.id, source: bundle.fromNodeId, target: bundle.toNodeId, traceId: trace.id, label, date: dateLabel, color, weight: edgeW(totalHuman), isBundleEdge: true } });
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
}
