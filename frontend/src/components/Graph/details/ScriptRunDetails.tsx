import { useState } from 'react';
import type { ScriptRun } from '@/lib/api-client';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  success: { label: 'Success', cls: 'bg-emerald-500/20 text-emerald-300' },
  error: { label: 'Error', cls: 'bg-red-500/20 text-red-300' },
  timeout: { label: 'Timeout', cls: 'bg-amber-500/20 text-amber-300' },
};

export function ScriptRunDetails({
  scriptRun,
  onRerun,
}: {
  scriptRun: ScriptRun;
  onRerun?: () => Promise<void>;
}) {
  const [showCode, setShowCode] = useState(true);
  const [running, setRunning] = useState(false);
  const badge = STATUS_BADGE[scriptRun.status] || STATUS_BADGE.error;

  const handleRerun = async () => {
    if (!onRerun) return;
    setRunning(true);
    try {
      await onRerun();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-xs font-semibold text-ink-muted uppercase">Script</h4>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        <span className="text-[10px] text-ink-faint ml-auto">
          {scriptRun.durationMs}ms
        </span>
        {onRerun && (
          <button
            onClick={handleRerun}
            disabled={running}
            className="px-2 py-0.5 bg-indigo-600/20 hover:bg-indigo-600/40 disabled:opacity-40 text-indigo-300 hover:text-indigo-200 rounded text-[10px] transition-colors"
          >
            {running ? 'Running…' : '▶ Re-run'}
          </button>
        )}
      </div>

      <p className="text-sm font-semibold">{scriptRun.name}</p>

      <div className="text-[10px] text-ink-faint">
        {new Date(scriptRun.createdAt).toLocaleString()}
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 border-b border-line-strong">
        <button
          onClick={() => setShowCode(true)}
          className={`px-2 py-1 text-xs transition-colors ${
            showCode
              ? 'text-brand border-b border-brand -mb-px'
              : 'text-ink-faint hover:text-ink-muted'
          }`}
        >
          Code
        </button>
        <button
          onClick={() => setShowCode(false)}
          className={`px-2 py-1 text-xs transition-colors ${
            !showCode
              ? 'text-brand border-b border-brand -mb-px'
              : 'text-ink-faint hover:text-ink-muted'
          }`}
        >
          Output
        </button>
      </div>

      {showCode ? (
        <pre className="text-[11px] font-mono text-ink-muted bg-surface rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all [scrollbar-width:thin]">
          {scriptRun.code}
        </pre>
      ) : (
        <pre className={`text-[11px] font-mono rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all [scrollbar-width:thin] ${
          scriptRun.status === 'error' || scriptRun.status === 'timeout'
            ? 'text-red-300 bg-red-950/30'
            : 'text-ink-muted bg-surface'
        }`}>
          {scriptRun.output || '(no output)'}
        </pre>
      )}
    </div>
  );
}
