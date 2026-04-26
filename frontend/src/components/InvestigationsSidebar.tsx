'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { FaPen, FaChevronRight, FaChevronDown, FaArrowLeft } from 'react-icons/fa6';
import { useRouter } from 'next/navigation';
import { apiClient, type Case, type Investigation, type ScriptRun, type Production } from '@/lib/api-client';
import type { Trace } from '@/types/investigation';
import { ScriptsPanel } from './ScriptsPanel';

interface InvestigationsSidebarProps {
  caseId: string;
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
  productions?: Production[];
  selectedProductionId?: string;
  onSelectProduction?: (production: Production) => void;
  onAddProduction?: () => void;
}

export function InvestigationsSidebar({
  caseId,
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
  productions,
  selectedProductionId,
  onSelectProduction,
  onAddProduction,
}: InvestigationsSidebarProps) {
  const router = useRouter();
  const [caseName, setCaseName] = useState('');
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [collapsedInvs, setCollapsedInvs] = useState<Set<string>>(new Set());
  const [addingInv, setAddingInv] = useState(false);
  const [newInvName, setNewInvName] = useState('');

  const toggleInv = (invId: string) => {
    setCollapsedInvs((prev) => {
      const next = new Set(prev);
      if (next.has(invId)) next.delete(invId);
      else next.add(invId);
      return next;
    });
  };

  const loadInvestigations = useCallback(async () => {
    try {
      const c = await apiClient.getCase(caseId);
      setCaseName(c.name);
      setInvestigations(c.investigations || []);
    } catch (err) {
      console.error('Failed to load case:', err);
    }
  }, [caseId]);

  useEffect(() => {
    loadInvestigations();
  }, [loadInvestigations]);

  useEffect(() => {
    if (refreshTrigger) loadInvestigations();
  }, [refreshTrigger, loadInvestigations]);

  const handleCreateInvestigation = async () => {
    if (!newInvName.trim()) return;
    try {
      const inv = await apiClient.createInvestigation(caseId, { name: newInvName.trim() });
      setNewInvName('');
      setAddingInv(false);
      await loadInvestigations();
      onSelectInvestigation(inv);
    } catch (err) {
      console.error('Failed to create investigation:', err);
    }
  };

  return (
    <div className="w-60 bg-gray-800 border-r border-gray-700 flex flex-col h-full overflow-hidden">
      {/* Case header with back button */}
      <div className="p-3 border-b border-gray-700 flex items-center gap-2">
        <button
          onClick={() => router.push('/')}
          className="text-gray-400 hover:text-white transition-colors"
          title="Back to cases"
        >
          <FaArrowLeft size={12} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{caseName || 'Loading...'}</p>
        </div>
      </div>

      {/* Investigation header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-gray-700">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Investigations</span>
        <button
          onClick={() => setAddingInv(!addingInv)}
          className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
          title="Add investigation"
        >
          +
        </button>
      </div>

      {/* New investigation input */}
      {addingInv && (
        <div className="px-2 py-1 border-b border-gray-700">
          <div className="flex gap-1">
            <input
              type="text"
              value={newInvName}
              onChange={(e) => setNewInvName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateInvestigation();
                if (e.key === 'Escape') { setAddingInv(false); setNewInvName(''); }
              }}
              placeholder="Investigation name..."
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-xs min-w-0"
              autoFocus
            />
            <button
              onClick={handleCreateInvestigation}
              className="px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-xs shrink-0 transition-colors"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Investigation list */}
      <div className="flex-1 overflow-y-auto">
        {investigations.map((inv) => {
          const isActive = activeInvestigationId === inv.id;
          const isInvCollapsed = collapsedInvs.has(inv.id);
          return (
            <div key={inv.id}>
              <div
                onClick={() => onSelectInvestigation(inv)}
                className={`flex items-center group px-3 pr-2 py-1.5 cursor-pointer text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'hover:bg-gray-700/60 text-gray-300'
                }`}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); if (isActive && traces) toggleInv(inv.id); }}
                  className={`mr-1 shrink-0 transition-colors ${isActive && traces ? 'text-gray-500 hover:text-gray-300' : 'text-gray-600'}`}
                >
                  {isActive && traces && !isInvCollapsed
                    ? <FaChevronDown size={9} />
                    : <FaChevronRight size={9} />}
                </button>
                <span className="truncate flex-1 text-xs font-medium">{inv.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onEditInvestigation(inv); }}
                  className="px-0.5 text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Edit investigation"
                >
                  <FaPen size={10} />
                </button>
              </div>

              {/* Traces under active investigation */}
              {isActive && !isInvCollapsed && traces && (
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

        {investigations.length === 0 && (
          <p className="text-gray-500 text-xs p-3">No investigations yet.</p>
        )}

        {/* Productions */}
        {(
          <div className="mt-2 border-t border-gray-700">
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Productions</span>
              {onAddProduction && (
                <button
                  onClick={onAddProduction}
                  className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
                  title="Add production"
                >
                  +
                </button>
              )}
            </div>
            {(productions || []).map((prod) => {
              const dotColor = prod.type === 'report' ? '#3b82f6' : prod.type === 'chart' ? '#10b981' : '#8b5cf6';
              return (
                <div
                  key={prod.id}
                  onClick={() => onSelectProduction?.(prod)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer text-xs transition-colors ${
                    selectedProductionId === prod.id
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'hover:bg-gray-700/60 text-gray-400'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: dotColor }}
                  />
                  <span className="truncate flex-1 font-medium">{prod.name}</span>
                  <span className="text-[10px] text-gray-600">{prod.type}</span>
                </div>
              );
            })}
            {(!productions || productions.length === 0) && (
              <p className="text-gray-600 text-xs px-3 py-1">No productions yet.</p>
            )}
          </div>
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
