'use client';

import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
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
  onEditInvestigation: (inv: Investigation) => void;
  refreshTrigger?: number;
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
  onEditInvestigation,
  refreshTrigger,
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

  useEffect(() => {
    if (refreshTrigger) loadCases();
  }, [refreshTrigger, loadCases]);

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
                className="flex-1 flex items-center gap-1.5 px-3 py-1.5 hover:bg-gray-700 text-left text-sm font-medium transition-colors"
              >
                <span className="text-gray-500 text-xs w-3 shrink-0">
                  {c.expanded ? '▾' : '▸'}
                </span>
                <span className="truncate text-gray-200">{c.name}</span>
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

            {/* Expanded case contents */}
            {c.expanded && (
              <div className="ml-3 border-l border-gray-700">
                {/* New investigation input */}
                {addingInvToCaseId === c.id && (
                  <div className="pl-3 pr-2 py-1">
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
                {c.investigations?.map((inv) => {
                  const isActive = activeInvestigationId === inv.id;
                  return (
                    <div key={inv.id}>
                      {/* Investigation row */}
                      <div
                        onClick={() => onSelectInvestigation(inv)}
                        className={`flex items-center group pl-3 pr-2 py-1.5 cursor-pointer text-sm transition-colors ${
                          isActive
                            ? 'bg-blue-600/20 text-blue-300'
                            : 'hover:bg-gray-700/60 text-gray-300'
                        }`}
                      >
                        <span className="truncate flex-1 text-xs font-medium">{inv.name}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditInvestigation(inv); }}
                          className="px-0.5 text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 text-xs transition-opacity"
                          title="Edit investigation"
                        >
                          ✎
                        </button>
                      </div>

                      {/* Traces — nested under active investigation */}
                      {isActive && traces && (
                        <div className="ml-3 border-l border-gray-700/70">
                          {traces.map((trace) => (
                            <div
                              key={trace.id}
                              onClick={() => onSelectTrace?.(trace)}
                              className={`flex items-center gap-1.5 pl-3 pr-2 py-1 cursor-pointer transition-colors ${
                                selectedTraceId === trace.id
                                  ? 'bg-gray-700 text-white'
                                  : 'hover:bg-gray-700/50 text-gray-400 hover:text-gray-200'
                              }`}
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: trace.color || '#3b82f6' }}
                              />
                              <span className="flex-1 truncate text-xs">{trace.name}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleVisibility?.(trace.id); }}
                                className={`flex items-center ${trace.visible ? 'text-gray-500 hover:text-white' : 'text-gray-700 hover:text-gray-400'}`}
                                title={trace.visible ? 'Hide' : 'Show'}
                              >
                                {trace.visible ? <Eye size={12} /> : <EyeSlash size={12} />}
                              </button>
                            </div>
                          ))}
                          {/* Add trace row */}
                          {onAddTrace && (
                            <button
                              onClick={onAddTrace}
                              className="flex items-center gap-1.5 pl-3 pr-2 py-1 w-full text-left text-gray-600 hover:text-gray-400 transition-colors"
                            >
                              <span className="text-xs">+</span>
                              <span className="text-xs">Add trace</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {(!c.investigations || c.investigations.length === 0) && (
                  <p className="text-gray-600 text-xs pl-3 py-1">No investigations.</p>
                )}
              </div>
            )}
          </div>
        ))}

        {cases.length === 0 && (
          <p className="text-gray-500 text-xs p-3">No cases yet.</p>
        )}
      </div>

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
