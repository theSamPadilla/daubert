'use client';

import { type ScriptRun } from '@/lib/api-client';

const STATUS_DOT: Record<string, string> = {
  success: 'bg-emerald-400',
  error: 'bg-red-400',
  timeout: 'bg-amber-400',
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface ScriptsPanelProps {
  scriptRuns: ScriptRun[];
  selectedScriptRunId?: string;
  onSelectScriptRun: (run: ScriptRun) => void;
}

export function ScriptsPanel({
  scriptRuns,
  selectedScriptRunId,
  onSelectScriptRun,
}: ScriptsPanelProps) {
  return (
    <div className="border-t border-gray-700 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase">Scripts</h3>
        <span className="text-[10px] text-gray-500">{scriptRuns.length}</span>
      </div>
      <div className="overflow-y-auto max-h-48">
        {scriptRuns.map((run) => (
          <div
            key={run.id}
            onClick={() => onSelectScriptRun(run)}
            className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-700 text-sm transition-colors ${
              selectedScriptRunId === run.id ? 'bg-gray-700' : ''
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[run.status] || STATUS_DOT.error}`}
            />
            <span className="flex-1 truncate text-xs text-gray-300">{run.name}</span>
            <span className="text-[10px] text-gray-500 shrink-0">{timeAgo(run.createdAt)}</span>
          </div>
        ))}
        {scriptRuns.length === 0 && (
          <p className="text-gray-500 text-xs px-3 pb-2">
            No scripts yet. Ask the AI to query blockchain APIs.
          </p>
        )}
      </div>
    </div>
  );
}
