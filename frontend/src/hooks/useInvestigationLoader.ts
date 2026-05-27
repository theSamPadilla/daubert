'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { apiClient, type ScriptRun } from '@/lib/api-client';
import type { Investigation } from '@/types/investigation';
import { normalizeInvestigation } from '@/utils/normalizeInvestigation';
import { useCaseContext } from '@/contexts/CaseContext';

interface UseInvestigationLoaderArgs {
  activeInvestigationId: string | null;
  investigation: Investigation | null;
  setInvestigation: (inv: Investigation | null) => void;
  /** Called before loading begins — used by the page to clear selectedItem / staged items. */
  onBeforeLoad?: () => void;
}

/**
 * Owns the network lifecycle of an investigation:
 *   - Load on activeInvestigationId change
 *   - Poll script runs every 10s
 *   - Debounced trace auto-save (1s after the last in-memory mutation)
 *   - Subscribe to `onGraphUpdated` from CaseContext so the agent's writes
 *     trigger a reload here
 */
export function useInvestigationLoader({
  activeInvestigationId,
  investigation,
  setInvestigation,
  onBeforeLoad,
}: UseInvestigationLoaderArgs) {
  const [loading, setLoading] = useState(false);
  const [scriptRuns, setScriptRuns] = useState<ScriptRun[]>([]);
  const { setOnGraphUpdated } = useCaseContext();

  // Mirror onBeforeLoad into a ref so we don't have to depend on it inside
  // loadInvestigation. If we did, every parent render that passes a fresh
  // arrow would change loadInvestigation's identity → re-fire the load effect
  // → infinite fetch loop. Same pattern as useCytoscape.ts:46-55.
  const onBeforeLoadRef = useRef(onBeforeLoad);
  onBeforeLoadRef.current = onBeforeLoad;

  const loadInvestigation = useCallback(async (id: string) => {
    setLoading(true);
    onBeforeLoadRef.current?.();
    try {
      const inv = await apiClient.getInvestigation(id);
      setInvestigation(normalizeInvestigation(inv));
    } catch (err) {
      console.error('Failed to load investigation:', err);
    } finally {
      setLoading(false);
    }
  }, [setInvestigation]);

  // Load on id change
  useEffect(() => {
    if (activeInvestigationId) {
      loadInvestigation(activeInvestigationId);
      apiClient.listScriptRuns(activeInvestigationId).then(setScriptRuns).catch(console.error);
    } else {
      setInvestigation(null);
      setScriptRuns([]);
    }
  }, [activeInvestigationId, loadInvestigation, setInvestigation]);

  // Poll script runs every 10s
  useEffect(() => {
    if (!activeInvestigationId) return;
    const interval = setInterval(() => {
      apiClient.listScriptRuns(activeInvestigationId).then(setScriptRuns).catch(console.error);
    }, 10_000);
    return () => clearInterval(interval);
  }, [activeInvestigationId]);

  // Subscribe to graph-updated events from the agent
  useEffect(() => {
    setOnGraphUpdated(() => {
      if (activeInvestigationId) loadInvestigation(activeInvestigationId);
    });
    return () => setOnGraphUpdated(undefined);
  }, [activeInvestigationId, loadInvestigation, setOnGraphUpdated]);

  // Debounced trace auto-save. The useMemo({ current: null }) pattern gives
  // a stable ref-like object without using useRef in the deps array.
  const saveTimeoutRef = useMemo(() => ({ current: null as ReturnType<typeof setTimeout> | null }), []);
  useEffect(() => {
    if (!investigation || loading) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        for (const trace of investigation.traces) {
          const traceData = {
            criteria: trace.criteria,
            nodes: trace.nodes,
            edges: trace.edges,
            groups: trace.groups || [],
            edgeBundles: trace.edgeBundles || [],
            position: trace.position,
            hideTitle: trace.hideTitle ?? false,
            labels: trace.labels || [],
          };
          await apiClient.updateTrace(trace.id, {
            name: trace.name,
            color: trace.color || null,
            visible: trace.visible,
            collapsed: trace.collapsed,
            data: traceData,
          });
        }
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, 1000);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [investigation, loading, saveTimeoutRef]);

  const reloadCurrent = useCallback(() => {
    if (activeInvestigationId) loadInvestigation(activeInvestigationId);
  }, [activeInvestigationId, loadInvestigation]);

  const refreshScriptRuns = useCallback(async () => {
    if (!activeInvestigationId) return;
    const runs = await apiClient.listScriptRuns(activeInvestigationId);
    setScriptRuns(runs);
  }, [activeInvestigationId]);

  return { loading, scriptRuns, reloadCurrent, refreshScriptRuns };
}
