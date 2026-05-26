import { EdgeBundle, Trace, TransactionEdge } from '@/types/investigation';
import { normalizeToken } from '@/utils/formatAmount';
import { MultiTxDetails } from '../MultiTxDetails';

interface EdgeBundleDetailsProps {
  bundle: EdgeBundle;
  traces: Trace[];
  onToggle: () => void;
  onDelete: () => void;
  onUpdate?: (updates: Partial<EdgeBundle>) => void;
  onArcEdge?: (delta: number | null) => void;
}

export function EdgeBundleDetails({ bundle, traces, onToggle, onDelete, onUpdate, onArcEdge }: EdgeBundleDetailsProps) {
  const trace = traces.find((t) => t.id === bundle.traceId);
  const fromNode = trace?.nodes.find((n) => n.id === bundle.fromNodeId);
  const toNode = trace?.nodes.find((n) => n.id === bundle.toNodeId);
  const bundleEdges = bundle.edgeIds
    .map((id) => trace?.edges.find((e) => e.id === id))
    .filter(Boolean) as TransactionEdge[];

  const fromLabel = fromNode?.label || bundle.fromNodeId.slice(0, 8) + '…';
  const toLabel = toNode?.label || bundle.toNodeId.slice(0, 8) + '…';
  const staticTitle = `${fromLabel} → ${toLabel}`;

  // Derive the display token from actual edges (bundle.token may be stale/wrong)
  const displayToken = bundleEdges.length > 0 ? normalizeToken(bundleEdges[0].token).symbol : bundle.token;

  return (
    <MultiTxDetails
      key={bundle.id}
      edges={bundleEdges}
      staticTitle={staticTitle}
      editableLabel={onUpdate ? {
        value: bundle.label || '',
        onChange: (next) => onUpdate({ label: next || undefined }),
      } : undefined}
      headerKind="bundle"
      tokenChip={displayToken}
      onColorChange={onUpdate ? (c) => onUpdate({ color: c }) : undefined}
      color={bundle.color}
      onWidthChange={onUpdate ? (w) => onUpdate({ width: w }) : undefined}
      width={bundle.width}
      onArcEdge={onArcEdge && bundle.collapsed ? onArcEdge : undefined}
      actions={
        <div className="flex gap-2 pt-1">
          <button
            onClick={onToggle}
            className="flex-1 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 rounded text-xs font-medium transition-colors"
          >
            {bundle.collapsed ? 'Expand bundle' : 'Collapse bundle'}
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-xs transition-colors"
          >
            Unbundle
          </button>
        </div>
      }
    />
  );
}
