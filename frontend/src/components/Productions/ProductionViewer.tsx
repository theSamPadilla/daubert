'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

const CHART_HEIGHT_MIN = 200;
const CHART_HEIGHT_MAX = 1200;
const CHART_HEIGHT_DEFAULT = 384;
import { FaPenToSquare, FaEye, FaDownload, FaArrowsRotate, FaTrash } from 'react-icons/fa6';
import { apiClient, type Production } from '@/lib/api-client';
import { ReportEditor } from './ReportEditor';
import { ChartViewer } from './ChartViewer';
import { ChartDatasetEditor } from './ChartDatasetEditor';
import { ChronologyTable } from './ChronologyTable';
import { ExportModal, type ExportFormat } from '../Common/ExportModal';
import { useChartSnapshot } from '@/hooks/useChartSnapshot';
import type { ExportTheme } from '@/lib/exportTheme';
import type { RenderOptions } from '@/lib/exportRenderOptions';
import type { ColumnDef } from '@/lib/chronologySchema';

const TYPE_COLORS: Record<string, string> = {
  report: 'bg-brand/10 text-brand',
  chart: 'bg-green-100 text-green-700',
  chronology: 'bg-purple-100 text-purple-700',
};

interface ProductionViewerProps {
  production: Production;
  onUpdate?: (updated: Production) => void;
  onDelete?: () => void;
}

export function ProductionViewer({ production, onUpdate, onDelete }: ProductionViewerProps) {
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(production.name);
  const [lastError, setLastError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chartDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const prevIdRef = useRef(production.id);
  if (prevIdRef.current !== production.id) {
    prevIdRef.current = production.id;
    setNameDraft(production.name);
    setEditingName(false);
  }

  const commitName = useCallback(async () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (!next || next === production.name) {
      setNameDraft(production.name);
      return;
    }
    try {
      const updated = await apiClient.updateProduction(production.id, { name: next });
      onUpdate?.(updated);
    } catch (err) {
      console.error('Failed to rename production:', err);
      setNameDraft(production.name);
    }
  }, [nameDraft, production.id, production.name, onUpdate]);

  // Chart edit panel keeps an in-progress patch; merged over production.data
  // at render time and on save (so it doesn't race with the height drag op).
  type ChartPatch = {
    datasets?: unknown[];
    labels?: string[];
    options?: Record<string, unknown>;
  };
  const [chartDraft, setChartDraft] = useState<ChartPatch | null>(null);
  const chartDraftRef = useRef<ChartPatch | null>(null);
  useEffect(() => {
    setChartDraft(null);
    chartDraftRef.current = null;
  }, [production.id]);

  const { snapshot: snapshotChart, dispose: disposeChart } = useChartSnapshot();
  useEffect(() => () => disposeChart(), [disposeChart]);

  // Chart height: persisted on production.data.height, drag-resizable.
  const storedChartHeight =
    typeof (production.data as any)?.height === 'number'
      ? (production.data as any).height as number
      : CHART_HEIGHT_DEFAULT;
  const [liveChartHeight, setLiveChartHeight] = useState<number | null>(null);
  const chartDragRef = useRef<{ startY: number; startH: number; currentH: number } | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (chartDebounceRef.current) clearTimeout(chartDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!chartDragRef.current) return;
      const next = Math.max(
        CHART_HEIGHT_MIN,
        Math.min(CHART_HEIGHT_MAX, chartDragRef.current.startH + (e.clientY - chartDragRef.current.startY)),
      );
      chartDragRef.current.currentH = next;
      setLiveChartHeight(next);
    };
    const onUp = async () => {
      if (!chartDragRef.current) return;
      const final = chartDragRef.current.currentH;
      const baseline = storedChartHeight;
      chartDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLiveChartHeight(null);
      if (final !== baseline) {
        try {
          const updated = await apiClient.updateProduction(production.id, {
            ops: [{ op: 'chart_set_height', height: final }],
          });
          onUpdate?.(updated);
        } catch (err) {
          console.error('Failed to persist chart height:', err);
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [storedChartHeight, production.id, onUpdate]);

  const startChartResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startH = liveChartHeight ?? storedChartHeight;
    chartDragRef.current = { startY: e.clientY, startH, currentH: startH };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [liveChartHeight, storedChartHeight]);

  const handleChartEdit = useCallback(
    (patch: ChartPatch) => {
      const next = { ...(chartDraftRef.current ?? {}), ...patch };
      chartDraftRef.current = next;
      setChartDraft(next);
      if (chartDebounceRef.current) clearTimeout(chartDebounceRef.current);
      chartDebounceRef.current = setTimeout(async () => {
        const draft = chartDraftRef.current;
        if (!draft) return;
        try {
          const merged = {
            ...((production.data as Record<string, unknown>) ?? {}),
            ...draft,
          };
          const updated = await apiClient.updateProduction(production.id, { data: merged });
          onUpdate?.(updated);
        } catch (err) {
          console.error('Failed to save chart edit:', err);
        }
      }, 600);
    },
    [production.id, production.data, onUpdate],
  );

  const handleReportChange = useCallback(
    (html: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const updated = await apiClient.updateProduction(production.id, {
            data: { content: html },
          });
          onUpdate?.(updated);
        } catch (err) {
          console.error('Failed to save report:', err);
        }
      }, 800);
    },
    [production.id, onUpdate],
  );

  const currentChartHeight = liveChartHeight ?? storedChartHeight;

  const handleExport = useCallback(
    async (format: ExportFormat, filename: string, theme: ExportTheme, renderOpts: RenderOptions) => {
      if (production.type === 'chart' && format === 'png') {
        const url = await snapshotChart(production.data, theme, currentChartHeight);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.png`;
        a.click();
        return;
      }
      let imageDataUrl: string | undefined;
      if (production.type === 'chart' && format === 'pdf') {
        imageDataUrl = await snapshotChart(production.data, theme, currentChartHeight);
      }
      await apiClient.exportProduction(production.id, format, filename, {
        imageDataUrl,
        fontFamily: renderOpts.fontFamily,
        fontSize: renderOpts.fontSize,
        orientation: renderOpts.orientation,
      });
    },
    [production.id, production.type, production.data, snapshotChart, currentChartHeight],
  );

  const handleEntryEdit = useCallback(
    async (index: number, entry: object) => {
      try {
        const updated = await apiClient.updateProduction(production.id, {
          ops: [{ op: 'chronology_replace', index, entry: entry as Record<string, unknown> }],
        });
        onUpdate?.(updated);
      } catch (err) {
        console.error('Failed to save entry edit:', err);
      }
    },
    [production.id, onUpdate],
  );

  const handleColumnResize = useCallback(
    async (widths: Record<string, number>) => {
      try {
        const updated = await apiClient.updateProduction(production.id, {
          ops: [{ op: 'chronology_set_column_widths', widths }],
        });
        onUpdate?.(updated);
      } catch (err) {
        console.error('Failed to save column widths:', err);
        setLastError('Failed to save column widths.');
      }
    },
    [production.id, onUpdate],
  );

  const handleColumnAdd = useCallback(
    async (column: ColumnDef, index?: number) => {
      try {
        setLastError(null);
        const updated = await apiClient.updateProduction(production.id, {
          ops: [{ op: 'chronology_add_column', column, ...(index !== undefined ? { index } : {}) }],
        });
        onUpdate?.(updated);
      } catch (err) {
        console.error('Failed to add column:', err);
        setLastError('Failed to add column.');
      }
    },
    [production.id, onUpdate],
  );

  const handleColumnRemove = useCallback(
    async (key: string) => {
      try {
        setLastError(null);
        const updated = await apiClient.updateProduction(production.id, {
          ops: [{ op: 'chronology_remove_column', key }],
        });
        onUpdate?.(updated);
      } catch (err) {
        console.error('Failed to remove column:', err);
        setLastError('Failed to remove column.');
      }
    },
    [production.id, onUpdate],
  );

  const handleColumnRename = useCallback(
    async (key: string, label: string) => {
      try {
        setLastError(null);
        const updated = await apiClient.updateProduction(production.id, {
          ops: [{ op: 'chronology_update_column', key, patch: { label } }],
        });
        onUpdate?.(updated);
      } catch (err) {
        console.error('Failed to rename column:', err);
        setLastError('Failed to rename column.');
      }
    },
    [production.id, onUpdate],
  );

  const handleRowHighlight = useCallback(
    async (indexes: number[], color: string | null) => {
      if (indexes.length === 0) return;
      try {
        const updated = await apiClient.updateProduction(production.id, {
          ops: [{ op: 'chronology_set_row_highlight', indexes, color }],
        });
        onUpdate?.(updated);
      } catch (err) {
        console.error('Failed to set row highlight:', err);
      }
    },
    [production.id, onUpdate],
  );

  const handleRowsDelete = useCallback(
    async (indexes: number[]) => {
      if (indexes.length === 0) return;
      try {
        const updated = await apiClient.updateProduction(production.id, {
          ops: [{ op: 'chronology_delete', indexes }],
        });
        onUpdate?.(updated);
      } catch (err) {
        console.error('Failed to delete rows:', err);
      }
    },
    [production.id, onUpdate],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await apiClient.getProduction(production.id);
      onUpdate?.(fresh);
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [production.id, onUpdate]);

  const previewGenerate = useCallback(
    (theme: ExportTheme) => snapshotChart(production.data, theme, currentChartHeight),
    [snapshotChart, production.data, currentChartHeight],
  );

  const data = production.data as any;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-12 px-4 border-b border-[#E5E7EB] bg-[#F7F8FB] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-baseline gap-3 shrink-0 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#5B6473] shrink-0">
            Production
          </span>
          {editingName ? (
            <input
              autoFocus
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') { setNameDraft(production.name); setEditingName(false); }
              }}
              className="text-[15px] font-semibold tracking-tight text-[#0B1220] bg-white border border-brand rounded px-2 py-0.5 min-w-0 focus:outline-none"
            />
          ) : (
            <h2
              onClick={() => { setNameDraft(production.name); setEditingName(true); }}
              title="Click to rename"
              className="text-[15px] font-semibold tracking-tight text-[#0B1220] truncate cursor-pointer hover:text-brand transition-colors"
            >
              {production.name}
            </h2>
          )}
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider shrink-0 ${TYPE_COLORS[production.type] || 'bg-[#F1F4FA] text-[#5B6473]'}`}>
            {production.type}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Reload from server"
            className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-[#5B6473]"
          >
            <FaArrowsRotate className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => setExportOpen(true)}
            disabled={refreshing}
            className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-[#5B6473]"
          >
            <FaDownload className="w-3 h-3" /> Export
          </button>
          {production.type === 'report' && (
            <button
              onClick={() => setEditing(!editing)}
              className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              {editing ? <FaEye className="w-3.5 h-3.5" /> : <FaPenToSquare className="w-3.5 h-3.5" />}
              {editing ? 'View' : 'Edit'}
            </button>
          )}
          {onDelete && (
            confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setConfirmDelete(false); onDelete(); }}
                  className="px-3 h-8 bg-red-600 hover:bg-red-500 text-white rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <FaTrash className="w-3 h-3" /> Confirm delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                title="Delete production"
                className="px-3 h-8 bg-white hover:bg-red-50 border border-[#E5E7EB] hover:border-red-300 text-[#5B6473] hover:text-red-600 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                <FaTrash className="w-3 h-3" /> Delete
              </button>
            )
          )}
        </div>
      </div>

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
        {production.type === 'report' && (
          <ReportEditor
            content={data.content || ''}
            editable={editing}
            onChange={handleReportChange}
          />
        )}
        {production.type === 'chart' && (() => {
          const mergedChartData = { ...data, ...(chartDraft ?? {}) };
          return (
            <div>
              <div style={{ height: liveChartHeight ?? storedChartHeight }}>
                <ChartViewer data={mergedChartData} />
              </div>
              <div
                className="h-4 cursor-row-resize group relative select-none flex items-center justify-center mt-1"
                onMouseDown={startChartResize}
                title="Drag to resize chart"
              >
                <div className="h-1 w-16 rounded-full bg-line-strong group-hover:bg-brand group-active:bg-brand transition-colors" />
              </div>
              <ChartDatasetEditor data={mergedChartData} onChange={handleChartEdit} />
            </div>
          );
        })()}
        {production.type === 'chronology' && (
          <>
            {lastError && (
              <div className="mb-2 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                {lastError}
              </div>
            )}
            <ChronologyTable
              data={data}
              onColumnResize={handleColumnResize}
              onColumnAdd={handleColumnAdd}
              onColumnRemove={handleColumnRemove}
              onColumnRename={handleColumnRename}
              onEntryEdit={handleEntryEdit}
              onRowHighlight={handleRowHighlight}
              onRowsDelete={handleRowsDelete}
            />
          </>
        )}
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        kind={production.type as 'chart' | 'report' | 'chronology'}
        defaultFilename={production.name}
        onExport={handleExport}
        previewGenerate={production.type === 'chart' ? previewGenerate : undefined}
      />
    </div>
  );
}
