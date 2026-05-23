'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

const CHART_HEIGHT_MIN = 200;
const CHART_HEIGHT_MAX = 1200;
const CHART_HEIGHT_DEFAULT = 384;
import { FaPenToSquare, FaEye, FaDownload, FaSpinner, FaArrowsRotate } from 'react-icons/fa6';
import { apiClient, type Production } from '@/lib/api-client';
import { ReportEditor } from './ReportEditor';
import { ChartViewer } from './ChartViewer';
import { ChronologyTable } from './ChronologyTable';
import { ExportModal } from './ExportModal';

const TYPE_COLORS: Record<string, string> = {
  report: 'bg-brand/10 text-brand',
  chart: 'bg-green-100 text-green-700',
  chronology: 'bg-purple-100 text-purple-700',
};

interface ProductionViewerProps {
  production: Production;
  onUpdate?: (updated: Production) => void;
}

export function ProductionViewer({ production, onUpdate }: ProductionViewerProps) {
  const [editing, setEditing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'html' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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

  const handleExport = useCallback(
    async (format: 'pdf' | 'html') => {
      setExportError(null);
      setExportingFormat(format);
      let imageDataUrl: string | undefined;
      if (production.type === 'chart') {
        const canvas = contentRef.current?.querySelector('[data-chart-export] canvas, canvas') as HTMLCanvasElement | null;
        if (canvas) {
          imageDataUrl = canvas.toDataURL('image/png');
        }
      }
      try {
        await apiClient.exportProduction(production.id, format, production.name, imageDataUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Export failed';
        setExportError(msg);
      } finally {
        setExportingFormat(null);
      }
    },
    [production.id, production.type, production.name],
  );

  const handleChartModalExport = useCallback(
    async (format: 'png' | 'pdf') => {
      setExportError(null);
      const canvas = contentRef.current?.querySelector('[data-chart-export] canvas, canvas') as HTMLCanvasElement | null;
      if (!canvas) {
        setExportError('Chart canvas not found');
        return;
      }
      const imageDataUrl = canvas.toDataURL('image/png');
      const safeName = (production.name || 'chart').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'chart';

      if (format === 'png') {
        const a = document.createElement('a');
        a.href = imageDataUrl;
        a.download = `${safeName}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }

      setExportingFormat('pdf');
      try {
        await apiClient.exportProduction(production.id, 'pdf', production.name, imageDataUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Export failed';
        setExportError(msg);
      } finally {
        setExportingFormat(null);
      }
    },
    [production.id, production.name],
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
    async (widths: { source?: number; date?: number; description?: number; details?: number }) => {
      try {
        const updated = await apiClient.updateProduction(production.id, {
          ops: [{ op: 'chronology_set_column_widths', widths }],
        });
        onUpdate?.(updated);
      } catch (err) {
        console.error('Failed to save column widths:', err);
      }
    },
    [production.id, onUpdate],
  );

  const handleRefresh = useCallback(async () => {
    setExportError(null);
    setRefreshing(true);
    try {
      const fresh = await apiClient.getProduction(production.id);
      onUpdate?.(fresh);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Refresh failed';
      setExportError(msg);
    } finally {
      setRefreshing(false);
    }
  }, [production.id, onUpdate]);

  const data = production.data as any;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-12 px-4 border-b border-[#E5E7EB] bg-[#F7F8FB] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-baseline gap-3 shrink-0 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#5B6473] shrink-0">
            Production
          </span>
          <h2 className="text-[15px] font-semibold tracking-tight text-[#0B1220] truncate">
            {production.name}
          </h2>
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider shrink-0 ${TYPE_COLORS[production.type] || 'bg-[#F1F4FA] text-[#5B6473]'}`}>
            {production.type}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRefresh}
            disabled={refreshing || exportingFormat !== null}
            title="Reload from server"
            className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-[#5B6473]"
          >
            <FaArrowsRotate className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {production.type === 'chart' ? (
            <button
              onClick={() => setExportModalOpen(true)}
              disabled={exportingFormat !== null || refreshing}
              className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-[#5B6473]"
            >
              {exportingFormat === 'pdf' ? (
                <FaSpinner className="w-3 h-3 animate-spin" />
              ) : (
                <FaDownload className="w-3 h-3" />
              )}
              {exportingFormat === 'pdf' ? 'Generating…' : 'Export'}
            </button>
          ) : (
            <>
              <button
                onClick={() => handleExport('pdf')}
                disabled={exportingFormat !== null || refreshing}
                className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-[#5B6473]"
              >
                {exportingFormat === 'pdf' ? (
                  <FaSpinner className="w-3 h-3 animate-spin" />
                ) : (
                  <FaDownload className="w-3 h-3" />
                )}
                {exportingFormat === 'pdf' ? 'Generating…' : 'PDF'}
              </button>
              <button
                onClick={() => handleExport('html')}
                disabled={exportingFormat !== null || refreshing}
                className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-[#5B6473]"
              >
                {exportingFormat === 'html' ? (
                  <FaSpinner className="w-3 h-3 animate-spin" />
                ) : (
                  <FaDownload className="w-3 h-3" />
                )}
                {exportingFormat === 'html' ? 'Generating…' : 'HTML'}
              </button>
            </>
          )}
          {production.type === 'report' && (
            <button
              onClick={() => setEditing(!editing)}
              className="px-3 h-8 bg-white hover:bg-[#F1F4FA] border border-[#E5E7EB] hover:border-[#CFD4DD] text-[#5B6473] hover:text-[#0B1220] rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              {editing ? <FaEye className="w-3.5 h-3.5" /> : <FaPenToSquare className="w-3.5 h-3.5" />}
              {editing ? 'View' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {/* Export error */}
      {exportError && (
        <div className="mx-4 mt-2 p-2 rounded bg-red-900/50 text-red-300 text-sm flex items-center justify-between">
          <span>Export failed: {exportError}</span>
          <button onClick={() => setExportError(null)} className="text-red-400 hover:text-red-200 ml-2">dismiss</button>
        </div>
      )}

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
        {production.type === 'report' && (
          <ReportEditor
            content={data.content || ''}
            editable={editing}
            onChange={handleReportChange}
          />
        )}
        {production.type === 'chart' && (
          <div>
            <div style={{ height: liveChartHeight ?? storedChartHeight }}>
              <ChartViewer data={data} />
            </div>
            <div
              className="h-4 cursor-row-resize group relative select-none flex items-center justify-center mt-1"
              onMouseDown={startChartResize}
              title="Drag to resize chart"
            >
              <div className="h-1 w-16 rounded-full bg-line-strong group-hover:bg-brand group-active:bg-brand transition-colors" />
            </div>
          </div>
        )}
        {production.type === 'chronology' && (
          <ChronologyTable
            data={data}
            onColumnResize={handleColumnResize}
            onEntryEdit={handleEntryEdit}
          />
        )}
      </div>

      {production.type === 'chart' && (
        <ExportModal
          open={exportModalOpen}
          onClose={() => setExportModalOpen(false)}
          onExport={handleChartModalExport}
          title="Export Chart"
        />
      )}
    </div>
  );
}
