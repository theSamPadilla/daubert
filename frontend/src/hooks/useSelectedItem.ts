'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Investigation, WalletNode, TransactionEdge } from '@/types/investigation';

/**
 * Selected item state for the right-side details panel. Re-derives the cached
 * `selectedItem` whenever `investigation` mutates, so that the panel doesn't
 * hold a stale snapshot after an edit.
 *
 * NOTE: the re-derive effect intentionally depends ONLY on `investigation`.
 * Including `selectedItem` would create a setState loop because we setState
 * inside the effect.
 */
export function useSelectedItem(investigation: Investigation | null) {
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  useEffect(() => {
    if (!selectedItem || !investigation) return;
    const { type, data } = selectedItem;
    if (type === 'wallet' && data) {
      for (const trace of investigation.traces) {
        const found = trace.nodes.find((n: WalletNode) => n.id === data.id);
        if (found) { setSelectedItem({ type: 'wallet', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'transaction' && data) {
      for (const trace of investigation.traces) {
        const found = trace.edges.find((e: TransactionEdge) => e.id === data.id);
        if (found) { setSelectedItem({ type: 'transaction', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'trace' && data) {
      const found = investigation.traces.find((t) => t.id === data.id);
      if (found) setSelectedItem({ type: 'trace', data: found });
      else setSelectedItem(null);
    } else if (type === 'group' && data) {
      for (const trace of investigation.traces) {
        const found = (trace.groups || []).find((g) => g.id === data.id);
        if (found) { setSelectedItem({ type: 'group', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'edgeBundle' && data) {
      for (const trace of investigation.traces) {
        const found = (trace.edgeBundles || []).find((b) => b.id === data.id);
        if (found) { setSelectedItem({ type: 'edgeBundle', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'aggregatedEdge' && data) {
      const trace = investigation.traces.find((t) => t.id === data.traceId);
      if (!trace) { setSelectedItem(null); return; }
      const remaining = data.edges.filter((e: TransactionEdge) =>
        trace.edges.some((te) => te.id === e.id)
      );
      if (remaining.length === 0) { setSelectedItem(null); return; }
      setSelectedItem({ type: 'aggregatedEdge', data: { ...data, edges: remaining } });
    }
  }, [investigation]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSelection = useCallback(() => setSelectedItem(null), []);

  return { selectedItem, setSelectedItem, clearSelection };
}
