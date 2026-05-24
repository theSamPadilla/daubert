'use client';
import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  FaPlus, FaXmark, FaGripVertical,
  FaFileLines, FaChartLine, FaTableList, FaDiagramProject,
  FaLayerGroup, FaMoon, FaSun,
} from 'react-icons/fa6';
import { apiClient, type Investigation, type Production } from '@/lib/api-client';
import { normalizeInvestigation } from '@/utils/normalizeInvestigation';
import { useCaseContext } from '@/contexts/CaseContext';
import { ExportModal } from '../Common/ExportModal';
import { useGraphSnapshot } from '@/hooks/useGraphSnapshot';
import { useChartSnapshot } from '@/hooks/useChartSnapshot';
import type { ExportTheme } from '@/lib/exportTheme';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  investigation: <FaDiagramProject className="w-3.5 h-3.5" />,
  report: <FaFileLines className="w-3.5 h-3.5" />,
  chart: <FaChartLine className="w-3.5 h-3.5" />,
  chronology: <FaTableList className="w-3.5 h-3.5" />,
};

type ItemRef = {
  refType: 'production' | 'investigation';
  refId: string;
  title: string;
  subtitle?: string;
  // Captured at export time
  imageDataUrl?: string;
  // Cached for the picker
  _displayType: string;
  // Per-item export theme (investigations + charts only); defaults to 'dark'
  theme?: ExportTheme;
};

interface Props {
  open: boolean;
  onClose: () => void;
  caseId: string;
  caseName: string;
}

export function ExhibitBuilder({ open, onClose, caseId, caseName }: Props) {
  const { productions } = useCaseContext(); // already populated case-wide

  // Group the picker list by production type so reports/charts/chronologies
  // cluster together. Order chosen for narrative-first reading: reports
  // (written analysis) → chronologies (sequence of facts) → charts (visuals).
  const PRODUCTION_TYPE_ORDER: Record<string, number> = { report: 0, chronology: 1, chart: 2 };
  const sortedProductions = useMemo(() => {
    return productions.slice().sort((a, b) => {
      const ta = PRODUCTION_TYPE_ORDER[a.type] ?? 99;
      const tb = PRODUCTION_TYPE_ORDER[b.type] ?? 99;
      if (ta !== tb) return ta - tb;
      return a.name.localeCompare(b.name);
    });
  }, [productions]);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [composition, setComposition] = useState<ItemRef[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const { snapshot: graphSnapshot, dispose: disposeGraph } = useGraphSnapshot();
  const { snapshot: chartSnapshot, dispose: disposeChart } = useChartSnapshot();

  useEffect(() => () => { disposeGraph(); disposeChart(); }, [disposeGraph, disposeChart]);

  useEffect(() => {
    if (!open) return;
    // Only investigations need a fresh fetch (CaseContext doesn't hold them
    // in a useful shape for this builder). Productions come from context.
    apiClient.getCase(caseId).then((c) => {
      setInvestigations(c.investigations || []);
    });
  }, [open, caseId]);

  const isAdded = (refType: ItemRef['refType'], refId: string) =>
    composition.some((c) => c.refType === refType && c.refId === refId);

  const add = (item: Omit<ItemRef, 'subtitle' | 'imageDataUrl'>) => {
    if (isAdded(item.refType, item.refId)) return;
    setComposition((prev) => [...prev, item]);
  };

  const remove = (idx: number) => setComposition((p) => p.filter((_, i) => i !== idx));

  const updateItem = (idx: number, patch: Partial<ItemRef>) => {
    setComposition((p) => p.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const move = (from: number, to: number) => {
    setComposition((p) => {
      const next = p.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleExport = async (_format: 'pdf' | 'png' | 'docx', filename: string, _theme: ExportTheme) => {
    // Capture snapshots for investigation items in order.
    //
    // NOTE: apiClient.getCase() loads the case with `relations: ['investigations']`
    // — one level only, no nested `traces`. We MUST re-fetch each referenced
    // investigation individually via apiClient.getInvestigation(id), whose
    // service loads `relations: ['traces']` (investigations.service.ts:38-41).
    const finalItems = [] as ItemRef[];
    for (const it of composition) {
      if (it.imageDataUrl) {
        finalItems.push(it);
        continue;
      }
      if (it.refType === 'investigation') {
        const inv = await apiClient.getInvestigation(it.refId); // full traces relation
        if (!inv) throw new Error(`Investigation ${it.refId} not found`);
        const dataUrl = await graphSnapshot(normalizeInvestigation(inv), it.theme ?? 'dark');
        finalItems.push({ ...it, imageDataUrl: dataUrl });
      } else {
        // Production item — only charts need a captured image. Reports and
        // chronologies render server-side from stored data, no snapshot.
        const prod = productions.find((p) => p.id === it.refId);
        if (prod?.type === 'chart') {
          const chartHeight = typeof (prod.data as any)?.height === 'number'
            ? (prod.data as any).height as number
            : 600;
          const dataUrl = await chartSnapshot(prod.data, it.theme ?? 'dark', chartHeight);
          finalItems.push({ ...it, imageDataUrl: dataUrl });
        } else {
          finalItems.push(it);
        }
      }
    }
    await apiClient.exportExhibit(
      filename,
      finalItems.map((it) => ({
        refType: it.refType,
        refId: it.refId,
        title: it.title,
        subtitle: it.subtitle,
        imageDataUrl: it.imageDataUrl,
      })),
    );
  };

  if (!open) return null;

  const itemCount = composition.length;

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
      <div className="bg-surface-panel border border-line-strong rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col">
        <header className="px-6 py-4 border-b border-line-strong flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-7 h-7 shrink-0">
              <Image src="/logo-light.png" alt="" fill sizes="28px" className="object-contain opacity-90" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink">Create Exhibit</h2>
              <p className="text-xs text-ink-muted">
                {itemCount === 0 ? 'No items yet — add from the left.' :
                  `${itemCount} item${itemCount === 1 ? '' : 's'} · drag to reorder`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md text-ink-muted hover:text-ink hover:bg-surface-raised flex items-center justify-center transition-colors"
            title="Close"
          >
            <FaXmark className="w-3.5 h-3.5" />
          </button>
        </header>

        <div className="flex-1 grid grid-cols-2 gap-5 p-5 overflow-hidden">
          {/* Picker */}
          <div className="border border-line-strong rounded-md bg-surface flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-line-strong/60 text-[11px] uppercase tracking-wider text-ink-muted font-medium">
              Available
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-4">
              <PickerSection
                title="Investigations"
                count={investigations.length}
                empty="No investigations yet."
              >
                {investigations.map((inv) => (
                  <PickerRow
                    key={inv.id}
                    icon={TYPE_ICONS.investigation}
                    typeLabel="Investigation"
                    name={inv.name}
                    added={isAdded('investigation', inv.id)}
                    onAdd={() => add({
                      refType: 'investigation',
                      refId: inv.id,
                      title: inv.name,
                      _displayType: 'Investigation',
                    })}
                  />
                ))}
              </PickerSection>

              <PickerSection
                title="Productions"
                count={sortedProductions.length}
                empty="No productions yet."
              >
                {sortedProductions.map((p) => (
                  <PickerRow
                    key={p.id}
                    icon={TYPE_ICONS[p.type] ?? TYPE_ICONS.report}
                    typeLabel={p.type}
                    name={p.name}
                    added={isAdded('production', p.id)}
                    onAdd={() => add({
                      refType: 'production',
                      refId: p.id,
                      title: p.name,
                      _displayType: p.type,
                    })}
                  />
                ))}
              </PickerSection>
            </div>
          </div>

          {/* Composition */}
          <div className="border border-line-strong rounded-md bg-surface flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-line-strong/60 text-[11px] uppercase tracking-wider text-ink-muted font-medium flex items-center justify-between">
              <span>Composition</span>
              {itemCount > 0 && <span className="text-ink-faint normal-case tracking-normal">{itemCount} page{itemCount === 1 ? '' : 's'}</span>}
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {composition.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <FaLayerGroup className="w-7 h-7 text-ink-faint/60 mb-3" />
                  <p className="text-ink-muted text-sm font-medium">Build your exhibit</p>
                  <p className="text-ink-faint text-xs mt-1 max-w-[220px]">
                    Add investigations and productions from the left. They'll each become a page in the final PDF.
                  </p>
                </div>
              ) : (
                composition.map((it, i) => {
                  const typeKey = it.refType === 'investigation' ? 'investigation' : it._displayType;
                  return (
                    <div
                      key={`${it.refType}-${it.refId}`}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                        if (!Number.isNaN(from) && from !== i) move(from, i);
                      }}
                      className="group border border-line-strong rounded-md mb-2 last:mb-0 bg-surface-raised hover:border-line transition-colors overflow-hidden"
                    >
                      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-panel/40 border-b border-line-strong/40 cursor-grab active:cursor-grabbing">
                        <FaGripVertical className="w-3 h-3 text-ink-faint group-hover:text-ink-muted transition-colors" />
                        <span className="text-ink-faint text-[11px] font-mono w-6">#{i + 1}</span>
                        <span className="flex items-center gap-1.5 text-ink-muted text-[11px]">
                          <span className="text-ink-faint">{TYPE_ICONS[typeKey] ?? TYPE_ICONS.report}</span>
                          <span className="uppercase tracking-wider font-mono text-[10px]">{it._displayType}</span>
                        </span>
                        <button
                          onClick={() => remove(i)}
                          className="ml-auto w-6 h-6 rounded text-ink-faint hover:text-red-400 hover:bg-red-400/10 flex items-center justify-center transition-colors"
                          title="Remove"
                        >
                          <FaXmark className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="px-3 py-2 space-y-1">
                        <input
                          value={it.title}
                          onChange={(e) => setComposition((p) => p.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))}
                          placeholder="Title"
                          className="w-full bg-transparent text-ink text-sm font-medium outline-none focus:bg-surface px-1 py-0.5 rounded"
                        />
                        <input
                          value={it.subtitle ?? ''}
                          onChange={(e) => setComposition((p) => p.map((x, idx) => idx === i ? { ...x, subtitle: e.target.value } : x))}
                          placeholder="Subtitle (optional)"
                          className="w-full bg-transparent text-ink-muted text-xs outline-none focus:bg-surface px-1 py-0.5 rounded"
                        />
                        {(it._displayType === 'Investigation' || it._displayType === 'chart') && (
                          <div className="flex items-center gap-2 pt-1">
                            <span className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Theme</span>
                            <div className="inline-flex p-0.5 bg-surface rounded-md border border-line-strong">
                              {(['dark', 'light'] as const).map((t) => (
                                <button
                                  key={t}
                                  onClick={() => updateItem(i, { theme: t, imageDataUrl: undefined })}
                                  title={t === 'dark' ? 'Dark theme' : 'Light theme'}
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                                    (it.theme ?? 'dark') === t
                                      ? 'bg-surface-raised text-ink shadow-sm'
                                      : 'text-ink-muted hover:text-ink'
                                  }`}
                                >
                                  {t === 'dark' ? <FaMoon className="w-2.5 h-2.5" /> : <FaSun className="w-2.5 h-2.5" />}
                                  {t === 'dark' ? 'Dark' : 'Light'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <footer className="px-6 py-3 border-t border-line-strong flex items-center justify-between gap-2">
          <p className="text-xs text-ink-faint">
            {itemCount > 0
              ? 'Each item becomes one page in the PDF.'
              : 'Add at least one item to continue.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 h-8 rounded text-sm text-ink-muted hover:text-ink hover:bg-surface-raised transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setExportOpen(true)}
              disabled={composition.length === 0}
              className="px-4 h-8 rounded bg-brand hover:bg-brand/90 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Continue to Export
            </button>
          </div>
        </footer>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        kind="exhibit"
        defaultFilename={`${caseName}_exhibit`}
        onExport={handleExport}
      />
    </div>
  );
}

function PickerSection({
  title, count, empty, children,
}: {
  title: string; count: number; empty: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 px-1">
        <span className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">{title}</span>
        {count > 0 && <span className="text-[10px] text-ink-faint font-mono">{count}</span>}
      </div>
      {count === 0
        ? <p className="text-ink-faint text-xs italic px-1 py-1">{empty}</p>
        : <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

function PickerRow({
  icon, typeLabel, name, added, onAdd,
}: {
  icon: React.ReactNode;
  typeLabel: string;
  name: string;
  added: boolean;
  onAdd: () => void;
}) {
  return (
    <div className={`group flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors ${added ? 'opacity-50' : 'hover:bg-surface-raised'}`}>
      <span className="shrink-0 text-ink-faint">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-ink truncate block">{name}</span>
        <span className="text-ink-faint text-[10px] uppercase tracking-wider font-mono">{typeLabel}</span>
      </div>
      <button
        onClick={onAdd}
        disabled={added}
        className={`shrink-0 text-xs px-2 py-1 rounded font-medium transition-colors ${
          added
            ? 'text-ink-faint cursor-default'
            : 'bg-brand/15 text-brand hover:bg-brand/25'
        }`}
      >
        {added ? 'Added' : <><FaPlus className="inline w-2.5 h-2.5 mr-1" />Add</>}
      </button>
    </div>
  );
}
