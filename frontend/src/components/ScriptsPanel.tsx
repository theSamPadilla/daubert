'use client';

import { useState } from 'react';
import { FaChevronRight, FaChevronDown } from 'react-icons/fa6';
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
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-line-strong flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full px-3 py-2 hover:bg-surface-raised/40 transition-colors text-left"
        title={expanded ? 'Collapse scripts' : 'Expand scripts'}
      >
        <span className="text-ink-faint">
          {expanded ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
        </span>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider flex-1">Scripts</h3>
        <span className="text-[10px] text-ink-faint">{scriptRuns.length}</span>
      </button>
      {expanded && (
        <>
          <div className="overflow-y-auto max-h-48">
            {scriptRuns.map((run) => (
              <div
                key={run.id}
                onClick={() => onSelectScriptRun(run)}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-surface-raised text-sm transition-colors ${
                  selectedScriptRunId === run.id ? 'bg-surface-raised' : ''
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[run.status] || STATUS_DOT.error}`}
                />
                <span className="flex-1 truncate text-xs text-ink-muted">{run.name}</span>
                <span className="text-[10px] text-ink-faint shrink-0">{timeAgo(run.createdAt)}</span>
              </div>
            ))}
            {scriptRuns.length === 0 && (
              <p className="text-ink-faint text-xs px-3 pb-2">
                No scripts yet. Ask the AI to query blockchain APIs.
              </p>
            )}
          </div>
          <div className="h-2" />
        </>
      )}
    </div>
  );
}
