'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { FaPenToSquare, FaEye } from 'react-icons/fa6';
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {production.type === 'report' && (
          <ReportEditor
            content={data.content || ''}
            editable={editing}
            onChange={handleReportChange}
          />
        )}
        {production.type === 'chart' && <ChartViewer data={data} />}
        {production.type === 'chronology' && <ChronologyTable data={data} />}
      </div>
    </div>
  );
}
