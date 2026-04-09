import { Eye, EyeSlash } from '@phosphor-icons/react';
import { Trace } from '../types/investigation';

interface TraceListProps {
  traces: Trace[];
  selectedTraceId?: string;
  onSelectTrace: (trace: Trace) => void;
  onToggleVisibility: (traceId: string) => void;
  onToggleCollapsed: (traceId: string) => void;
  onAddTrace: () => void;
}

export function TraceList({
  traces,
  selectedTraceId,
  onSelectTrace,
  onToggleVisibility,
  onToggleCollapsed,
  onAddTrace,
}: TraceListProps) {
  return (
    <div className="border-b border-gray-700">
      <div className="flex items-center justify-between px-4 py-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase">Traces</h3>
        <button
          onClick={onAddTrace}
          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded text-sm"
          title="Add Trace"
        >
          +
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {traces.map((trace) => (
          <div
            key={trace.id}
            onClick={() => onSelectTrace(trace)}
            className={`flex items-center gap-2 px-4 py-1.5 cursor-pointer hover:bg-gray-700 text-sm ${
              selectedTraceId === trace.id ? 'bg-gray-700' : ''
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: trace.color || '#3b82f6' }}
            />
            <span className="flex-1 truncate">{trace.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(trace.id);
              }}
              className={`flex items-center px-1 ${trace.visible ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-400'}`}
              title={trace.visible ? 'Hide' : 'Show'}
            >
              {trace.visible ? <Eye size={14} /> : <EyeSlash size={14} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapsed(trace.id);
              }}
              className="text-xs text-gray-400 hover:text-white px-1"
              title={trace.collapsed ? 'Expand' : 'Collapse'}
            >
              {trace.collapsed ? '>' : 'v'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
