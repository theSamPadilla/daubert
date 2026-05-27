import { forwardRef, useImperativeHandle, useState, useMemo, useEffect, useCallback } from 'react';
import { Investigation, TraceLabel, LabelAnchor, TransactionEdge, EdgeBundle } from '../../types/investigation';
import { useCytoscape, CytoscapeCallbacks, LabelControls } from '../../hooks/useCytoscape';
import { LabelEditPopover } from './LabelEditPopover';
import { resolveLabelRenderedPosition, contextFromCy } from '@/lib/labelGeometry';
import type { ExportTheme } from '@/lib/exportTheme';

export interface GraphCanvasHandle {
  unselectAll: () => void;
  exportImage: (format: 'png' | 'pdf', filename?: string, theme?: ExportTheme, orientation?: 'portrait' | 'landscape') => Promise<void>;
  exportPngDataUrl: (theme?: ExportTheme) => Promise<string>;
  setEdgeArc: (edgeId: string, delta: number | null) => void;
  /** Open the label edit popover for the given label. Called by page.tsx from the label right-click menu. */
  requestEditLabel: (traceId: string, labelId: string) => void;
}

/** Callbacks for label CRUD, forwarded from the parent (page.tsx) which owns useInvestigation. */
export interface LabelCallbacks {
  addLabel: (traceId: string, label: TraceLabel) => void;
  updateLabel: (traceId: string, labelId: string, patch: Partial<Pick<TraceLabel, 'text' | 'color' | 'fontSize'>>) => void;
  deleteLabel: (traceId: string, labelId: string) => void;
  moveLabel: (traceId: string, labelId: string, anchor: LabelAnchor) => void;
}

interface GraphCanvasProps {
  investigation: Investigation | null;
  selectedNodeIds: { id: string; traceId: string }[];
  selectedEdgeIds: string[];
  callbacks: CytoscapeCallbacks;
  labelCallbacks?: LabelCallbacks;
  /**
   * Called when the user right-clicks a label overlay div.
   * page.tsx uses this to build a context menu with Edit/Delete items.
   */
  onLabelContextMenu?: (traceId: string, labelId: string, x: number, y: number) => void;
}

/**
 * Determine which trace id to use when placing a free-floating label.
 *
 * Resolution order:
 * 1. The most recently focused trace (passed in as `recentTraceId`).
 * 2. The first visible trace in the investigation.
 *
 * Free labels must belong to some trace because TraceLabel lives on Trace.labels.
 * This heuristic keeps the UX frictionless — users rarely care which trace owns
 * a free label as long as it appears on the canvas.
 */
function resolveActiveTraceId(
  investigation: Investigation | null,
  recentTraceId: string | null,
): string | null {
  if (!investigation) return null;
  const visibleTraces = investigation.traces.filter((t) => t.visible);
  if (recentTraceId && visibleTraces.some((t) => t.id === recentTraceId)) return recentTraceId;
  return visibleTraces[0]?.id ?? investigation.traces[0]?.id ?? null;
}

/**
 * Build the appropriate LabelAnchor for an edge context-menu "Attach label" action.
 *
 * Rule (from plan §Task 12 + architectural call-out #15):
 * - Individual transaction edges carry a `txHash` field. Use `txEdge` anchor so the label
 *   survives bundling and aggregation (resolved via txHash at render time).
 * - Bundles, synthetic aggregated edges, and any edge without a real txHash use the UUID
 *   `edge` anchor. These are fragile (id regenerates on re-bundle), but are the only option.
 */
function buildEdgeAnchor(edge: TransactionEdge | EdgeBundle | { id: string; txHash?: string }): LabelAnchor {
  if ('txHash' in edge && edge.txHash && edge.txHash !== 'aggregated') {
    return { type: 'txEdge', txHash: edge.txHash, t: 0.5, perpOffset: 12 };
  }
  return { type: 'edge', anchorId: edge.id, t: 0.5, perpOffset: 12 };
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  ({ investigation, selectedNodeIds, selectedEdgeIds, callbacks, labelCallbacks, onLabelContextMenu }, ref) => {
    // Label editing state: which label is currently open in the edit popover.
    const [editingLabel, setEditingLabel] = useState<{ traceId: string; labelId: string } | null>(null);
    // Label selection state: which label is visually selected (outlined) on the canvas.
    const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);

    // Flatten labels from visible traces into a single array for useCytoscapeOverlays.
    // Exclude hidden traces so free-floating labels don't linger when their owner trace is toggled off.
    // Tethered labels on hidden traces are already invisible (anchor lookup returns null), but
    // filtering here is the more correct approach and avoids shipping them to the overlay at all.
    const flatLabels = useMemo(() => {
      if (!investigation) return [];
      return investigation.traces
        .filter((t) => t.visible)
        .flatMap((t) => (t.labels ?? []).map((label) => ({ traceId: t.id, label })));
    }, [investigation]);

    // Wire label controls for the overlay hook.
    const labelControls: LabelControls | undefined = labelCallbacks
      ? {
          labels: flatLabels,
          onLabelMove: labelCallbacks.moveLabel,
          onLabelEdit: (traceId, labelId) => setEditingLabel({ traceId, labelId }),
          onLabelSelect: setSelectedLabelId,
          selectedLabelId,
          onLabelContextMenu,
        }
      : undefined;


    // Augment the external callbacks with an onBackgroundTap handler that clears
    // selectedLabelId. This is additive — label-click calls unselectAllCytoscape
    // directly (not through onBackgroundTap) so the cross-clear loop is avoided.
    const augmentedCallbacks = useMemo<CytoscapeCallbacks>(() => ({
      ...callbacks,
      onBackgroundTap: () => {
        setSelectedLabelId(null);
        callbacks.onBackgroundTap?.();
      },
    }), [callbacks]);

    const { containerRef, cy, unselectAll, exportImage, exportPngDataUrl, setEdgeArc } = useCytoscape(
      investigation,
      selectedNodeIds,
      selectedEdgeIds,
      augmentedCallbacks,
      labelControls,
    );

    useImperativeHandle(ref, () => ({
      unselectAll,
      exportImage,
      exportPngDataUrl,
      setEdgeArc,
      // Allow page.tsx to open the edit popover for a specific label (e.g. from label right-click menu).
      // Architectural note: editingLabel state stays in GraphCanvas because popover-position resolution
      // depends on `cy`, which lives here. page.tsx calls this via graphRef.current.requestEditLabel().
      requestEditLabel: (traceId: string, labelId: string) => setEditingLabel({ traceId, labelId }),
    }), [unselectAll, exportImage, exportPngDataUrl, setEdgeArc]);

    // Selection cross-clear: when the user selects a Cytoscape node/edge, deselect any label.
    // Wrap callbacks.onSelectionChange to intercept — but since callbacks is passed in,
    // this is handled by the caller (page.tsx) via the augmented callbacks. Instead, we
    // observe selectedNodeIds/selectedEdgeIds changes here for the same effect.
    useEffect(() => {
      if (selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) {
        setSelectedLabelId(null);
      }
    }, [selectedNodeIds, selectedEdgeIds]);

    // Delete/Backspace keyboard shortcut: remove the selected label.
    // Guard: skip if the event target is an input or textarea (user is typing).
    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        if (!selectedLabelId || !labelCallbacks) return;
        const entry = flatLabels.find((fl) => fl.label.id === selectedLabelId);
        if (!entry) return;
        labelCallbacks.deleteLabel(entry.traceId, selectedLabelId);
        setSelectedLabelId(null);
      },
      [selectedLabelId, flatLabels, labelCallbacks],
    );

    useEffect(() => {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    // Resolve position for the edit popover: use the label's current rendered position.
    const editPopoverPosition = useMemo(() => {
      if (!editingLabel || !cy) return null;
      const entry = flatLabels.find(
        (fl) => fl.label.id === editingLabel.labelId && fl.traceId === editingLabel.traceId,
      );
      if (!entry) return null;
      const pos = resolveLabelRenderedPosition(entry.label.anchor, contextFromCy(cy));
      return pos;
    }, [editingLabel, flatLabels, cy]);

    // Find the current label being edited (full TraceLabel for initializer).
    const editingLabelData = useMemo(() => {
      if (!editingLabel) return null;
      const entry = flatLabels.find(
        (fl) => fl.label.id === editingLabel.labelId && fl.traceId === editingLabel.traceId,
      );
      return entry?.label ?? null;
    }, [editingLabel, flatLabels]);

    return (
      <div className="relative w-full h-full">
        <div ref={containerRef} className="w-full h-full" />
        {editingLabel && editPopoverPosition && labelCallbacks && editingLabelData && (
          <LabelEditPopover
            initialLabel={editingLabelData}
            position={editPopoverPosition}
            onSave={(patch) => {
              labelCallbacks.updateLabel(editingLabel.traceId, editingLabel.labelId, patch);
              setEditingLabel(null);
            }}
            onCancel={() => setEditingLabel(null)}
          />
        )}
      </div>
    );
  },
);

GraphCanvas.displayName = 'GraphCanvas';

// Re-export helpers so page.tsx can build context menu items without importing
// from deeper internal paths.
export { buildEdgeAnchor, resolveActiveTraceId };
