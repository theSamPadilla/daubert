'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { FaPenToSquare, FaEye, FaDownload, FaSpinner, FaArrowsRotate } from 'react-icons/fa6';
import { apiClient, type Production } from '@/lib/api-client';
import { ReportEditor } from './ReportEditor';
import { ChartViewer } from './ChartViewer';
import { ChronologyTable } from './ChronologyTable';

const TYPE_COLORS: Record<string, string> = {
  report: 'bg-blue-900/50 text-blue-300',
  chart: 'bg-green-900/50 text-green-300',
  chronology: 'bg-purple-900/50 text-purple-300',
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">{production.name}</h2>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[production.type] || 'bg-gray-700 text-gray-300'}`}>
            {production.type}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing || exportingFormat !== null}
            title="Reload from server"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-gray-700"
          >
            <FaArrowsRotate className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => handleExport('pdf')}
            disabled={exportingFormat !== null || refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-gray-700"
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-gray-700"
          >
            {exportingFormat === 'html' ? (
              <FaSpinner className="w-3 h-3 animate-spin" />
            ) : (
              <FaDownload className="w-3 h-3" />
            )}
            {exportingFormat === 'html' ? 'Generating…' : 'HTML'}
          </button>
          {production.type === 'report' && (
            <button
              onClick={() => setEditing(!editing)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300"
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
        {production.type === 'chart' && <ChartViewer data={data} />}
        {production.type === 'chronology' && (
          <ChronologyTable data={data} onColumnResize={handleColumnResize} />
        )}
      </div>
    </div>
  );
}
