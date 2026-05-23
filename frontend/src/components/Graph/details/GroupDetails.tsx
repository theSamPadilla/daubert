import { useState, useMemo } from 'react';
import { FaXmark, FaChevronDown, FaChevronRight } from 'react-icons/fa6';
import { Group, Trace } from '@/types/investigation';
import { normalizeToken } from '@/utils/formatAmount';
import { GroupColorPicker } from '@/components/Common/GroupColorPicker';

function fmtFlow(amount: number): string {
  if (amount >= 1e12) return `${(amount / 1e12).toFixed(2).replace(/\.?0+$/, '')}T`;
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2).replace(/\.?0+$/, '')}K`;
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function GroupDetails({
  group,
  traces,
  onUpdate,
  onDelete,
  onSetNodeGroup,
}: {
  group: Group;
  traces: Trace[];
  onUpdate: (updates: Partial<Group>) => void;
  onDelete: () => void;
  onSetNodeGroup: (traceId: string, nodeIds: string[], groupId: string | null) => void;
}) {
  const [name, setName] = useState(group.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [view, setView] = useState<'members' | 'flows'>('members');

  const trace = traces.find((t) => t.id === group.traceId);
  const members = useMemo(
    () => trace?.nodes.filter((n) => n.groupId === group.id) || [],
    [trace, group.id]
  );
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  // Aggregate external flows for the Flows tab
  const { inflows, outflows } = useMemo(() => {
    if (!trace) return { inflows: [] as any[], outflows: [] as any[] };
    type Entry = { label: string; symbol: string; amount: number; usd: number };
    const inMap = new Map<string, Entry>();
    const outMap = new Map<string, Entry>();

    for (const edge of trace.edges) {
      const fromIn = memberIds.has(edge.from);
      const toIn = memberIds.has(edge.to);
      if (fromIn === toIn) continue;

      const tok = normalizeToken(edge.token);
      const raw = parseFloat(String(edge.amount)) || 0;
      const human = tok.decimals > 0 ? raw / Math.pow(10, tok.decimals) : raw;
      const usd = edge.usdValue || 0;

      if (!fromIn && toIn) {
        const ext = trace.nodes.find((n) => n.id === edge.from);
        const key = `${edge.from}::${tok.symbol}`;
        const existing = inMap.get(key);
        if (existing) { existing.amount += human; existing.usd += usd; }
        else inMap.set(key, { label: ext?.label || ext?.address || edge.from, symbol: tok.symbol, amount: human, usd });
      } else {
        const ext = trace.nodes.find((n) => n.id === edge.to);
        const key = `${edge.to}::${tok.symbol}`;
        const existing = outMap.get(key);
        if (existing) { existing.amount += human; existing.usd += usd; }
        else outMap.set(key, { label: ext?.label || ext?.address || edge.to, symbol: tok.symbol, amount: human, usd });
      }
    }
    return { inflows: [...inMap.values()], outflows: [...outMap.values()] };
  }, [trace, memberIds]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-ink-muted uppercase">Subgroup</h4>
        <button
          onClick={() => onUpdate({ collapsed: !group.collapsed })}
          className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors"
          title={group.collapsed ? 'Expand group in graph' : 'Collapse group in graph'}
        >
          {group.collapsed
            ? <><FaChevronRight size={9} /> Expand</>
            : <><FaChevronDown size={9} /> Collapse</>}
        </button>
      </div>

      {/* Name */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name !== group.name) onUpdate({ name: name.trim() }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full bg-surface-raised border border-line-strong rounded px-2 py-1 text-sm text-ink focus:outline-none focus:border-brand"
      />

      {/* Color */}
      <div>
        <h4 className="text-xs font-semibold text-ink-muted uppercase mb-2">Color</h4>
        <GroupColorPicker color={group.color ?? undefined} onChange={(c) => onUpdate({ color: c ?? null })} />
      </div>

      {/* Tab toggle */}
      <div className="flex gap-0.5 bg-surface-raised/50 rounded p-0.5">
        <button
          onClick={() => setView('members')}
          className={`flex-1 py-1 text-xs rounded transition-colors ${view === 'members' ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink'}`}
        >
          Members ({members.length})
        </button>
        <button
          onClick={() => setView('flows')}
          className={`flex-1 py-1 text-xs rounded transition-colors ${view === 'flows' ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink'}`}
        >
          Flows
        </button>
      </div>

      {/* Members view */}
      {view === 'members' && (
        <div className="space-y-0.5 max-h-40 overflow-y-auto [scrollbar-width:thin]">
          {members.map((n) => (
            <div key={n.id} className="flex items-center justify-between py-0.5 group/member">
              <span className="text-xs text-ink-muted truncate flex-1">{n.label || n.address}</span>
              <button
                onClick={() => onSetNodeGroup(group.traceId, [n.id], null)}
                className="text-ink-faint hover:text-red-400 opacity-0 group-hover/member:opacity-100 ml-2 shrink-0 transition-opacity"
                title="Remove from group"
              >
                <FaXmark size={10} />
              </button>
            </div>
          ))}
          {members.length === 0 && <p className="text-xs text-ink-faint">No members</p>}
        </div>
      )}

      {/* Flows view */}
      {view === 'flows' && (
        <div className="space-y-3 max-h-52 overflow-y-auto [scrollbar-width:thin]">
          {inflows.length > 0 && (
            <div>
              <h5 className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">Inflows</h5>
              <div className="space-y-1">
                {inflows.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted truncate">{f.label}</span>
                    <span className="text-xs text-emerald-300 shrink-0 font-mono">+{fmtFlow(f.amount)} {f.symbol}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {outflows.length > 0 && (
            <div>
              <h5 className="text-[10px] font-semibold text-red-400 uppercase mb-1">Outflows</h5>
              <div className="space-y-1">
                {outflows.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted truncate">{f.label}</span>
                    <span className="text-xs text-red-300 shrink-0 font-mono">-{fmtFlow(f.amount)} {f.symbol}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {inflows.length === 0 && outflows.length === 0 && (
            <p className="text-xs text-ink-faint">No external flows for this group</p>
          )}
        </div>
      )}

      {/* Dissolve */}
      <div className="pt-2 border-t border-line-strong">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-400">Dissolve group?</span>
            <button onClick={() => { onDelete(); setConfirmDelete(false); }} className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs text-white">Confirm</button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-ink-muted hover:text-ink">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="w-full px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300 rounded text-xs">
            Dissolve group
          </button>
        )}
      </div>
    </div>
  );
}
