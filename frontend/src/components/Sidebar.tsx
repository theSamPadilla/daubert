'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient, type User, type Case, type Investigation, type ScriptRun } from '@/lib/api-client';
import type { Trace } from '@/types/investigation';
import { ScriptsPanel } from './ScriptsPanel';

interface CaseWithInvestigations extends Case {
  investigations?: Investigation[];
  expanded?: boolean;
}

interface SidebarProps {
  activeInvestigationId: string | null;
  onSelectInvestigation: (inv: Investigation) => void;
  traces?: Trace[];
  selectedTraceId?: string;
  onAddTrace?: () => void;
  onSelectTrace?: (trace: Trace) => void;
  onToggleVisibility?: (traceId: string) => void;
  onToggleCollapsed?: (traceId: string) => void;
  scriptRuns?: ScriptRun[];
  selectedScriptRunId?: string;
  onSelectScriptRun?: (run: ScriptRun) => void;
}

export function Sidebar({
  activeInvestigationId,
  onSelectInvestigation,
  traces,
  selectedTraceId,
  onAddTrace,
  onSelectTrace,
  onToggleVisibility,
  onToggleCollapsed,
  scriptRuns,
  selectedScriptRunId,
  onSelectScriptRun,
}: SidebarProps) {
  const [user, setUser] = useState<User | null>(null);
  const [cases, setCases] = useState<CaseWithInvestigations[]>([]);
  const [newCaseName, setNewCaseName] = useState('');
  const [addingInvToCaseId, setAddingInvToCaseId] = useState<string | null>(null);
  const [newInvName, setNewInvName] = useState('');

  const loadCases = useCallback(async () => {
    try {
      const data = await apiClient.listCases();
      // Load investigations for each case
      const withInvs = await Promise.all(
        data.map(async (c) => {
          const full = await apiClient.getCase(c.id);
          return { ...full, expanded: false } as CaseWithInvestigations;
        })
      );
      setCases((prev) => {
        // Preserve expanded state
        const expandedIds = new Set(prev.filter((c) => c.expanded).map((c) => c.id));
        return withInvs.map((c) => ({ ...c, expanded: expandedIds.has(c.id) }));
      });
    } catch (err) {
      console.error('Failed to load cases:', err);
    }
  }, []);

  useEffect(() => {
    apiClient.getMe().then(setUser).catch(console.error);
    loadCases();
  }, [loadCases]);

  // Auto-expand the case containing the active investigation
  useEffect(() => {
    if (!activeInvestigationId) return;
    setCases((prev) =>
      prev.map((c) => {
        const hasActive = c.investigations?.some((inv) => inv.id === activeInvestigationId);
        return hasActive ? { ...c, expanded: true } : c;
      })
    );
  }, [activeInvestigationId]);

  const toggleCase = (caseId: string) => {
    setCases((prev) =>
      prev.map((c) => (c.id === caseId ? { ...c, expanded: !c.expanded } : c))
    );
  };

  const handleCreateCase = async () => {
    if (!newCaseName.trim()) return;
    try {
      await apiClient.createCase({ name: newCaseName.trim() });
      setNewCaseName('');
      loadCases();
    } catch (err) {
      console.error('Failed to create case:', err);
    }
  };

  const handleDeleteCase = async (id: string) => {
    if (!confirm('Delete this case and all its investigations?')) return;
    try {
      await apiClient.deleteCase(id);
      loadCases();
    } catch (err) {
      console.error('Failed to delete case:', err);
    }
  };

  const handleCreateInvestigation = async (caseId: string) => {
    if (!newInvName.trim()) return;
    try {
      const inv = await apiClient.createInvestigation(caseId, { name: newInvName.trim() });
      setNewInvName('');
      setAddingInvToCaseId(null);
      await loadCases();
      onSelectInvestigation(inv);
    } catch (err) {
      console.error('Failed to create investigation:', err);
    }
  };

  const handleDeleteInvestigation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this investigation and all its traces?')) return;
    try {
      await apiClient.deleteInvestigation(id);
      loadCases();
    } catch (err) {
      console.error('Failed to delete investigation:', err);
    }
  };

  return (
    <div className="w-60 bg-gray-800 border-r border-gray-700 flex flex-col h-full overflow-hidden">
      {/* User */}
      <div className="p-3 border-b border-gray-700">
        <p className="text-sm font-semibold truncate">{user?.name || 'Loading...'}</p>
        <p className="text-xs text-gray-500 truncate">{user?.email}</p>
      </div>

      {/* New case input */}
      <div className="p-2 border-b border-gray-700">
        <div className="flex gap-1">
          <input
            type="text"
            value={newCaseName}
            onChange={(e) => setNewCaseName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateCase()}
            placeholder="New case..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs min-w-0"
          />
          <button
            onClick={handleCreateCase}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs shrink-0 transition-colors"
          >
            +
          </button>
        </div>
      </div>

      {/* Case tree */}
      <div className="flex-1 overflow-y-auto">
        {cases.map((c) => (
          <div key={c.id}>
            {/* Case row */}
            <div className="flex items-center group">
              <button
                onClick={() => toggleCase(c.id)}
                className="flex-1 flex items-center gap-1.5 px-3 py-1.5 hover:bg-gray-700 text-left text-sm transition-colors"
              >
                <span className="text-gray-500 text-xs w-4 shrink-0">
                  {c.expanded ? '▼' : '▶'}
                </span>
                <span className="truncate">{c.name}</span>
              </button>
              <button
                onClick={() => setAddingInvToCaseId(addingInvToCaseId === c.id ? null : c.id)}
                className="px-1.5 text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 text-xs transition-opacity"
                title="Add investigation"
              >
                +
              </button>
              <button
                onClick={() => handleDeleteCase(c.id)}
                className="px-1.5 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition-opacity mr-1"
                title="Delete case"
              >
                ×
              </button>
            </div>

            {/* New investigation input */}
            {addingInvToCaseId === c.id && (
              <div className="pl-7 pr-2 py-1">
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={newInvName}
                    onChange={(e) => setNewInvName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateInvestigation(c.id);
                      if (e.key === 'Escape') { setAddingInvToCaseId(null); setNewInvName(''); }
                    }}
                    placeholder="Investigation name..."
                    className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-xs min-w-0"
                    autoFocus
                  />
                  <button
                    onClick={() => handleCreateInvestigation(c.id)}
                    className="px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-xs shrink-0 transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* Investigation list */}
            {c.expanded && c.investigations?.map((inv) => (
              <div
                key={inv.id}
                onClick={() => onSelectInvestigation(inv)}
                className={`flex items-center group pl-7 pr-2 py-1 cursor-pointer text-sm transition-colors ${
                  activeInvestigationId === inv.id
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'hover:bg-gray-700 text-gray-300'
                }`}
              >
                <span className="truncate flex-1">{inv.name}</span>
                <button
                  onClick={(e) => handleDeleteInvestigation(inv.id, e)}
                  className="px-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))}

        {cases.length === 0 && (
          <p className="text-gray-500 text-xs p-3">No cases yet.</p>
        )}
      </div>

      {/* Traces section — shown when an investigation is active */}
      {activeInvestigationId && traces && (
        <div className="border-t border-gray-700 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase">Traces</h3>
            {onAddTrace && (
              <button
                onClick={onAddTrace}
                className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded text-sm"
                title="Add Trace"
              >
                +
              </button>
            )}
          </div>
          <div className="overflow-y-auto max-h-48">
            {traces.map((trace) => (
              <div
                key={trace.id}
                onClick={() => onSelectTrace?.(trace)}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-700 text-sm ${
                  selectedTraceId === trace.id ? 'bg-gray-700' : ''
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: trace.color || '#3b82f6' }}
                />
                <span className="flex-1 truncate text-xs">{trace.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleVisibility?.(trace.id); }}
                  className={`text-xs px-0.5 ${trace.visible ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-400'}`}
                  title={trace.visible ? 'Hide' : 'Show'}
                >
                  {trace.visible ? 'V' : 'H'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleCollapsed?.(trace.id); }}
                  className="text-xs text-gray-400 hover:text-white px-0.5"
                  title={trace.collapsed ? 'Expand' : 'Collapse'}
                >
                  {trace.collapsed ? '›' : '⌄'}
                </button>
              </div>
            ))}
            {traces.length === 0 && (
              <p className="text-gray-500 text-xs px-3 pb-2">No traces yet.</p>
            )}
          </div>
        </div>
      )}

      {activeInvestigationId && scriptRuns && onSelectScriptRun && (
        <ScriptsPanel
          scriptRuns={scriptRuns}
          selectedScriptRunId={selectedScriptRunId}
          onSelectScriptRun={onSelectScriptRun}
        />
      )}
    </div>
  );
}
