import type { Trace } from '@/types/investigation';

interface TraceDetailsProps {
  trace: Trace;
  onEdit: () => void;
  onUpdate: (updates: Partial<Trace>) => void;
}

export function TraceDetails({ trace, onEdit, onUpdate }: TraceDetailsProps) {
  const hideTitle = !!trace.hideTitle;
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
      <div className="pt-2 border-t border-line-strong">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-xs font-semibold text-ink-muted uppercase">Hide title on canvas</span>
          <button
            type="button"
            role="switch"
            aria-checked={hideTitle}
            onClick={() => onUpdate({ hideTitle: !hideTitle })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              hideTitle ? 'bg-brand' : 'bg-surface-raised'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                hideTitle ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </label>
      </div>
    </div>
  );
}
