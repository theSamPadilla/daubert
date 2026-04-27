'use client';

import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { FaPen, FaChevronRight, FaChevronDown, FaArrowLeft } from 'react-icons/fa6';
import { useRouter, usePathname } from 'next/navigation';
import { apiClient, type Investigation, type DataRoomConnection } from '@/lib/api-client';
import type { Trace } from '@/types/investigation';
import { ScriptsPanel } from './ScriptsPanel';
import { useCaseContext } from '@/contexts/CaseContext';

interface InvestigationsSidebarProps {
  caseId: string;
}

export function InvestigationsSidebar({ caseId }: InvestigationsSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const ctx = useCaseContext();

  const {
    activeInvestigationId,
    traces,
    selectedTraceId,
    onAddTrace,
    onSelectTrace,
    onToggleVisibility,
    onToggleCollapsed,
    scriptRuns,
    selectedScriptRunId,
    onSelectScriptRun,
    onEditInvestigation,
  } = ctx.sidebar;

  const { productions } = ctx;
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const selectedProductionId = pathname?.startsWith(`/cases/${caseId}/productions`) ? searchParams.get('id') : null;

  const [caseName, setCaseName] = useState('');
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [collapsedInvs, setCollapsedInvs] = useState<Set<string>>(new Set());
  const [dataRoom, setDataRoom] = useState<DataRoomConnection | null | undefined>(undefined);

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

  // Refetch data-room state on mount and pathname changes
  useEffect(() => {
    let cancelled = false;
    apiClient
      .dataRoomGet(caseId)
      .then((conn) => { if (!cancelled) setDataRoom(conn); })
      .catch(() => { if (!cancelled) setDataRoom(null); });
    return () => { cancelled = true; };
  }, [caseId, pathname]);

  const handleSelectInvestigation = useCallback((inv: Investigation) => {
    router.push(`/cases/${caseId}/investigations?inv=${inv.id}`);
  }, [router, caseId]);

  return (
    <div className="w-full bg-gray-800 flex flex-col h-full overflow-hidden">
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
          onClick={() => ctx.openNewPrimary('investigation')}
          className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
          title="New investigation"
        >
          +
        </button>
      </div>

      {/* Investigation list */}
      <div className="flex-1 overflow-y-auto">
        {investigations.map((inv) => {
          const isActive = activeInvestigationId === inv.id;
          const isInvCollapsed = collapsedInvs.has(inv.id);
          return (
            <div key={inv.id}>
              <div
                onClick={() => {
                  handleSelectInvestigation(inv);
                  // Always expand when clicking the row
                  setCollapsedInvs((prev) => {
                    const next = new Set(prev);
                    next.delete(inv.id);
                    return next;
                  });
                }}
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
                  onClick={(e) => { e.stopPropagation(); onEditInvestigation?.(inv); }}
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
        <div className="mt-2 border-t border-gray-700">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Productions</span>
            <button
              onClick={() => ctx.openNewPrimary('production')}
              className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
              title="New production"
            >
              +
            </button>
          </div>
          {(productions || []).map((prod) => (
              <div
                key={prod.id}
                onClick={() => router.push(`/cases/${caseId}/productions?id=${prod.id}`)}
                className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer text-xs transition-colors ${
                  selectedProductionId === prod.id
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'hover:bg-gray-700/60 text-gray-400'
                }`}
              >
                <span className="truncate flex-1 font-medium">{prod.name}</span>
                <span className="text-[10px] text-gray-600">{prod.type}</span>
              </div>
          ))}
          {(!productions || productions.length === 0) && (
            <p className="text-gray-600 text-xs px-3 py-1">No productions yet.</p>
          )}
        </div>

        {/* Data Room */}
        {(() => {
          const dataRoomHref = `/cases/${caseId}/data-room`;
          const dataRoomActive = pathname === dataRoomHref || pathname?.startsWith(dataRoomHref + '/');

          let statusText = 'Loading...';
          let statusColor = 'text-gray-600';
          let folderText: string | null = null;

          if (dataRoom === null) {
            statusText = 'Not connected';
            statusColor = 'text-gray-500';
          } else if (dataRoom && dataRoom.status === 'broken') {
            statusText = 'Reconnect needed';
            statusColor = 'text-yellow-500';
          } else if (dataRoom && dataRoom.status === 'active') {
            statusText = 'Connected';
            statusColor = 'text-green-500';
            folderText = dataRoom.folderName ?? 'No folder selected';
          }

          return (
            <div className="mt-2 border-t border-gray-700">
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Data Room</span>
              </div>
              <a
                href={dataRoomHref}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(dataRoomHref);
                }}
                className={`block px-3 py-1.5 cursor-pointer text-xs transition-colors ${
                  dataRoomActive
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'hover:bg-gray-700/60 text-gray-400'
                }`}
              >
                <span className={`text-[10px] ${statusColor}`}>{statusText}</span>
                {folderText && (
                  <p className="truncate font-medium mt-0.5">{folderText}</p>
                )}
              </a>
            </div>
          );
        })()}
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
