'use client';

import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import {
  FaPen, FaChevronRight, FaChevronDown, FaArrowLeft,
  FaFileLines, FaChartLine, FaTableList, FaGear, FaPlus, FaFolder,
} from 'react-icons/fa6';

const PRODUCTION_TYPE_ORDER = ['report', 'chart', 'chronology'] as const;
const PRODUCTION_TYPE_LABEL: Record<string, string> = {
  report: 'Reports',
  chart: 'Charts',
  chronology: 'Chronologies',
};
const PRODUCTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  report: <FaFileLines className="w-3 h-3" />,
  chart: <FaChartLine className="w-3 h-3" />,
  chronology: <FaTableList className="w-3 h-3" />,
};
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { apiClient, type Investigation } from '@/lib/api-client';
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

  const { productions, investigationsVersion, viewerRole } = ctx;
  const canMutate = viewerRole === 'owner' || viewerRole === 'editor';
  const canManageCase = viewerRole === 'owner';
  const searchParams = useSearchParams();
  const onInvestigationsRoute = !!pathname?.startsWith(`/cases/${caseId}/investigations`);
  const onProductionsRoute = !!pathname?.startsWith(`/cases/${caseId}/productions`);
  const selectedProductionId = onProductionsRoute ? searchParams?.get('id') ?? null : null;

  const [caseName, setCaseName] = useState('');
  const [exhibitOpen, setExhibitOpen] = useState(false);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [collapsedInvs, setCollapsedInvs] = useState<Set<string>>(new Set());

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
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#5B6473] shrink-0">
            Case
          </span>
          <p className="text-[16px] font-semibold tracking-tight text-[#0B1220] truncate">
            {caseName || 'Loading...'}
          </p>
        </div>
      </div>

      {/* Investigation header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-line-strong">
        <span className="font-mono text-[10px] text-ink-faint uppercase tracking-[0.14em]">Investigations</span>
        {canMutate && (
          <button
            onClick={() => ctx.openNewPrimary('investigation')}
            className="text-ink-faint hover:text-ink text-sm transition-colors"
            title="New investigation"
          >
            +
          </button>
        )}
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
                    ? 'bg-brand-soft text-ink shadow-[inset_2px_0_0_var(--brand-ink)]'
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
                <span className="truncate flex-1 text-sm font-medium">{inv.name}</span>
                {canMutate && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditInvestigation?.(inv); }}
                    className="px-0.5 text-ink-faint hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Edit investigation"
                  >
                    <FaPen size={10} />
                  </button>
                )}
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
                      <span className="flex-1 truncate text-sm">{trace.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleVisibility?.(trace.id); }}
                        className={`flex items-center ${trace.visible ? 'text-ink-faint hover:text-ink' : 'text-ink-faint/40 hover:text-ink-faint'}`}
                        title={trace.visible ? 'Hide' : 'Show'}
                      >
                        {trace.visible ? <Eye size={12} /> : <EyeSlash size={12} />}
                      </button>
                    </div>
                  ))}
                  {canMutate && onAddTrace && (
                    <button
                      onClick={onAddTrace}
                      className="flex items-center gap-1.5 pl-3 pr-2 py-1 w-full text-left text-ink-faint/60 hover:text-ink-faint transition-colors"
                    >
                      <span className="text-sm">+</span>
                      <span className="text-sm">Add trace</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {investigations.length === 0 && (
          <p className="text-ink-faint text-sm p-3">No investigations yet.</p>
        )}

        {/* Productions */}
        <div className="mt-2 border-t border-line-strong">
          <div className="px-3 py-2 flex items-center justify-between border-b border-line-strong">
            <span className="font-mono text-[10px] text-ink-faint uppercase tracking-[0.14em]">Productions</span>
            {canMutate && (
              <button
                onClick={() => ctx.openNewPrimary('production')}
                className="text-ink-faint hover:text-ink text-sm transition-colors"
                title="New production"
              >
                +
              </button>
            )}
          </div>
          {(() => {
            const list = productions || [];
            if (list.length === 0) {
              return <p className="text-ink-faint text-sm px-3 py-1">No productions yet.</p>;
            }
            // Preserve creation order within each type; only render non-empty groups.
            const byType: Record<string, typeof list> = {};
            for (const p of list) {
              (byType[p.type] ||= []).push(p);
            }
            // Known types first (in canonical order), then any unknown types alphabetically.
            const knownTypes = PRODUCTION_TYPE_ORDER.filter((t) => byType[t]?.length);
            const otherTypes = Object.keys(byType).filter((t) => !PRODUCTION_TYPE_ORDER.includes(t as any)).sort();
            const orderedTypes = [...knownTypes, ...otherTypes];

            return orderedTypes.map((type) => (
              <div key={type}>
                <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-ink-muted">
                  <span className="shrink-0 text-ink-faint">
                    {PRODUCTION_TYPE_ICONS[type] ?? <FaFileLines className="w-3 h-3" />}
                  </span>
                  <span className="text-[12px] font-medium tracking-tight">
                    {PRODUCTION_TYPE_LABEL[type] ?? type}
                  </span>
                </div>
                <div className="ml-3 border-l border-line">
                  {byType[type].map((prod) => {
                    const active = selectedProductionId === prod.id;
                    return (
                      <div
                        key={prod.id}
                        onClick={() => router.push(`/cases/${caseId}/productions?id=${prod.id}`)}
                        title={prod.name}
                        className={`flex items-center px-3 py-1 cursor-pointer text-sm transition-colors ${
                          active
                            ? 'bg-brand-soft text-ink shadow-[inset_2px_0_0_var(--brand-ink)]'
                            : 'hover:bg-surface-raised text-ink-muted hover:text-ink'
                        }`}
                      >
                        <span className="truncate flex-1 font-medium">{prod.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>

        {/* Data Room — single nav destination (no section header) */}
        {(() => {
          const dataRoomHref = `/cases/${caseId}/data-room`;
          const dataRoomActive = pathname === dataRoomHref || pathname?.startsWith(dataRoomHref + '/');
          return (
            <div className="mt-2 pt-2 border-t border-line-strong">
              <a
                href={dataRoomHref}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(dataRoomHref);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm transition-colors ${
                  dataRoomActive
                    ? 'bg-brand-soft text-ink shadow-[inset_2px_0_0_var(--brand-ink)]'
                    : 'hover:bg-surface-raised text-ink-muted hover:text-ink'
                }`}
              >
                <FaFolder size={12} className="shrink-0 text-ink-faint" />
                <span className="font-medium">Data Room</span>
              </a>
            </div>
          );
        })()}
      </div>

      {/* Footer actions — Exhibit + Settings, pinned to the bottom (owners + editors) */}
      {canMutate && (
        <div className="border-t border-line-strong px-3 py-2.5 shrink-0 space-y-2">
          <button
            onClick={() => setExhibitOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium bg-brand-soft text-ink shadow-[inset_0_0_0_1px_var(--brand-ink)] hover:bg-brand hover:text-white transition-colors"
            title="Create exhibit from investigations and productions"
          >
            <FaPlus size={10} />
            <span>Exhibit</span>
          </button>
          <button
            onClick={() => router.push(`/cases/${caseId}/settings`)}
            className="flex items-center gap-2 text-ink-faint hover:text-ink text-sm w-full transition-colors"
            title="Case settings"
          >
            <FaGear size={14} />
            <span>Settings</span>
          </button>
        </div>
      )}

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
