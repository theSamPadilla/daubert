'use client';

import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { FaPen, FaChevronRight, FaChevronDown, FaArrowLeft } from 'react-icons/fa6';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { apiClient, type Investigation, type DataRoomConnection } from '@/lib/api-client';
import type { Trace } from '@/types/investigation';
import { ScriptsPanel } from './ScriptsPanel';
import { ExhibitBuilder } from '../Productions/ExhibitBuilder';
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

  const { productions, investigationsVersion } = ctx;
  const searchParams = useSearchParams();
  const onInvestigationsRoute = !!pathname?.startsWith(`/cases/${caseId}/investigations`);
  const onProductionsRoute = !!pathname?.startsWith(`/cases/${caseId}/productions`);
  const selectedProductionId = onProductionsRoute ? searchParams?.get('id') ?? null : null;

  const [caseName, setCaseName] = useState('');
  const [exhibitOpen, setExhibitOpen] = useState(false);
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
  }, [loadInvestigations, investigationsVersion]);

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
    <div className="w-full bg-surface-panel border-r border-line-strong flex flex-col h-full overflow-hidden">
      {/* Case header with back button */}
      <div className="h-12 px-3 border-b border-[#E5E7EB] bg-[#F7F8FB] flex items-center gap-2 shrink-0">
        <button
          onClick={() => router.push('/')}
          className="text-[#5B6473] hover:text-[#0B1220] transition-colors shrink-0"
          title="Back to cases"
        >
          <FaArrowLeft size={12} />
        </button>
        <div className="flex items-center justify-between gap-2 min-w-0 flex-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#5B6473] shrink-0">
              Case
            </span>
            <p className="text-[15px] font-semibold tracking-tight text-[#0B1220] truncate">
              {caseName || 'Loading...'}
            </p>
          </div>
          <button
            onClick={() => setExhibitOpen(true)}
            className="shrink-0 text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-0.5 rounded border border-[#D1D5DB] text-[#5B6473] hover:text-[#0B1220] hover:border-[#9CA3AF] transition-colors"
            title="Create exhibit from investigations and productions"
          >
            + Exhibit
          </button>
        </div>
      </div>

      {/* Investigation header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-line-strong">
        <span className="font-mono text-[10px] text-ink-faint uppercase tracking-[0.14em]">Investigations</span>
        <button
          onClick={() => ctx.openNewPrimary('investigation')}
          className="text-ink-faint hover:text-ink text-xs transition-colors"
          title="New investigation"
        >
          +
        </button>
      </div>

      {/* Investigation list */}
      <div className="flex-1 overflow-y-auto">
        {investigations.map((inv) => {
          const isActive = activeInvestigationId === inv.id && onInvestigationsRoute;
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
                    ? 'bg-brand-soft text-ink shadow-[inset_2px_0_0_var(--brand)]'
                    : 'hover:bg-surface-raised text-ink-muted'
                }`}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); if (isActive && traces) toggleInv(inv.id); }}
                  className={`mr-1 shrink-0 transition-colors ${isActive && traces ? 'text-ink-faint hover:text-ink-muted' : 'text-ink-faint/60'}`}
                >
                  {isActive && traces && !isInvCollapsed
                    ? <FaChevronDown size={9} />
                    : <FaChevronRight size={9} />}
                </button>
                <span className="truncate flex-1 text-xs font-medium">{inv.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onEditInvestigation?.(inv); }}
                  className="px-0.5 text-ink-faint hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Edit investigation"
                >
                  <FaPen size={10} />
                </button>
              </div>

              {/* Traces under active investigation */}
              {isActive && !isInvCollapsed && traces && (
                <div className="ml-3 border-l border-line">
                  {traces.map((trace) => (
                    <div
                      key={trace.id}
                      onClick={() => onSelectTrace?.(trace)}
                      className={`flex items-center gap-1.5 pl-3 pr-2 py-1 cursor-pointer transition-colors ${
                        selectedTraceId === trace.id
                          ? 'bg-surface-raised text-ink'
                          : 'hover:bg-surface-raised text-ink-muted hover:text-ink'
                      }`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: trace.color || '#3b82f6' }}
                      />
                      <span className="flex-1 truncate text-xs">{trace.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleVisibility?.(trace.id); }}
                        className={`flex items-center ${trace.visible ? 'text-ink-faint hover:text-ink' : 'text-ink-faint/40 hover:text-ink-faint'}`}
                        title={trace.visible ? 'Hide' : 'Show'}
                      >
                        {trace.visible ? <Eye size={12} /> : <EyeSlash size={12} />}
                      </button>
                    </div>
                  ))}
                  {onAddTrace && (
                    <button
                      onClick={onAddTrace}
                      className="flex items-center gap-1.5 pl-3 pr-2 py-1 w-full text-left text-ink-faint/60 hover:text-ink-faint transition-colors"
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
          <p className="text-ink-faint text-xs p-3">No investigations yet.</p>
        )}

        {/* Productions */}
        <div className="mt-2 border-t border-line-strong">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="font-mono text-[10px] text-ink-faint uppercase tracking-[0.14em]">Productions</span>
            <button
              onClick={() => ctx.openNewPrimary('production')}
              className="text-ink-faint hover:text-ink text-xs transition-colors"
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
                    ? 'bg-brand-soft text-ink shadow-[inset_2px_0_0_var(--brand)]'
                    : 'hover:bg-surface-raised text-ink-muted'
                }`}
              >
                <span className="truncate flex-1 font-medium">{prod.name}</span>
                <span className="font-mono text-[10px] text-ink-faint/70 uppercase tracking-wider">{prod.type}</span>
              </div>
          ))}
          {(!productions || productions.length === 0) && (
            <p className="text-ink-faint text-xs px-3 py-1">No productions yet.</p>
          )}
        </div>

        {/* Data Room */}
        {(() => {
          const dataRoomHref = `/cases/${caseId}/data-room`;
          const dataRoomActive = pathname === dataRoomHref || pathname?.startsWith(dataRoomHref + '/');

          let statusText = 'Loading...';
          let statusColor = 'text-ink-faint';
          let folderText: string | null = null;

          if (dataRoom === null) {
            statusText = 'Not connected';
            statusColor = 'text-ink-faint';
          } else if (dataRoom && dataRoom.status === 'broken') {
            statusText = 'Reconnect needed';
            statusColor = 'text-yellow-500';
          } else if (dataRoom && dataRoom.status === 'active') {
            statusText = 'Connected';
            statusColor = 'text-green-500';
            folderText = dataRoom.folderName ?? 'No folder selected';
          }

          return (
            <div className="mt-2 border-t border-line-strong">
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="font-mono text-[10px] text-ink-faint uppercase tracking-[0.14em]">Data Room</span>
              </div>
              <a
                href={dataRoomHref}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(dataRoomHref);
                }}
                className={`block px-3 py-1.5 cursor-pointer text-xs transition-colors ${
                  dataRoomActive
                    ? 'bg-brand-soft text-ink shadow-[inset_2px_0_0_var(--brand)]'
                    : 'hover:bg-surface-raised text-ink-muted'
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

      <ExhibitBuilder
        open={exhibitOpen}
        onClose={() => setExhibitOpen(false)}
        caseId={caseId}
        caseName={caseName}
      />
    </div>
  );
}
