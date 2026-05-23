import type { Trace } from '@/types/investigation';

export function TraceDetails({ trace, onEdit }: { trace: Trace; onEdit: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-ink-muted uppercase">Trace</h4>
        <button onClick={onEdit} className="text-xs text-brand hover:text-brand">Edit</button>
      </div>
      <p className="text-sm font-semibold">{trace.name}</p>
      <div>
        <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Type</h4>
        <p className="text-sm text-ink-muted capitalize">{trace.criteria.type}</p>
      </div>
      {trace.criteria.timeRange && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Time Range</h4>
          <p className="text-xs text-ink-muted">
            {new Date(trace.criteria.timeRange.start).toLocaleDateString()}
          </p>
          <p className="text-xs text-ink-faint">to</p>
          <p className="text-xs text-ink-muted">
            {new Date(trace.criteria.timeRange.end).toLocaleDateString()}
          </p>
        </div>
      )}
      <div>
        <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Stats</h4>
        <p className="text-sm text-ink-muted">{trace.nodes.length} addresses</p>
        <p className="text-sm text-ink-muted">{trace.edges.length} transactions</p>
      </div>
    </div>
  );
}
