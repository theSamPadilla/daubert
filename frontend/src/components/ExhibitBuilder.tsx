'use client';
import { useEffect, useMemo, useState } from 'react';
import { FaPlus, FaXmark, FaGripVertical } from 'react-icons/fa6';
import { apiClient, type Investigation, type Production } from '@/lib/api-client';
import { normalizeInvestigation } from '@/utils/normalizeInvestigation';
import { useCaseContext } from '@/contexts/CaseContext';
import { ExportModal } from './ExportModal';
import { useGraphSnapshot } from '@/hooks/useGraphSnapshot';
import { useChartSnapshot } from '@/hooks/useChartSnapshot';

type ItemRef = {
  refType: 'production' | 'investigation';
  refId: string;
  title: string;
  subtitle?: string;
  // Captured at export time
  imageDataUrl?: string;
  // Cached for the picker
  _displayType: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  caseId: string;
  caseName: string;
}

export function ExhibitBuilder({ open, onClose, caseId, caseName }: Props) {
  const { productions } = useCaseContext(); // already populated case-wide
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

  const move = (from: number, to: number) => {
    setComposition((p) => {
      const next = p.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleExport = async (_format: 'pdf' | 'png' | 'docx', filename: string) => {
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
        const dataUrl = await graphSnapshot(normalizeInvestigation(inv));
        finalItems.push({ ...it, imageDataUrl: dataUrl });
      } else {
        // Production item — only charts need a captured image. Reports and
        // chronologies render server-side from stored data, no snapshot.
        const prod = productions.find((p) => p.id === it.refId);
        if (prod?.type === 'chart') {
          const dataUrl = await chartSnapshot(prod.data);
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

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
      <div className="bg-surface-panel border border-line-strong rounded-lg shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col">
        <header className="px-5 py-3 border-b border-line-strong flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Create Exhibit</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><FaXmark /></button>
        </header>

        <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden">
          {/* Picker */}
          <div className="border border-line-strong rounded p-3 overflow-y-auto">
            <h3 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Investigations</h3>
            {investigations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between py-1 text-sm">
                <span className="text-ink">{inv.name}</span>
                <button
                  onClick={() => add({ refType: 'investigation', refId: inv.id, title: inv.name, _displayType: 'Investigation' })}
                  disabled={isAdded('investigation', inv.id)}
                  className="text-xs px-2 py-0.5 rounded bg-brand/20 text-brand hover:bg-brand/30 disabled:opacity-40"
                >
                  <FaPlus className="inline w-2.5 h-2.5" /> Add
                </button>
              </div>
            ))}

            <h3 className="text-xs uppercase tracking-wider text-ink-muted mt-4 mb-2">Productions</h3>
            {productions.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                <span className="text-ink">{p.name} <span className="text-ink-faint text-[10px] uppercase">{p.type}</span></span>
                <button
                  onClick={() => add({ refType: 'production', refId: p.id, title: p.name, _displayType: p.type })}
                  disabled={isAdded('production', p.id)}
                  className="text-xs px-2 py-0.5 rounded bg-brand/20 text-brand hover:bg-brand/30 disabled:opacity-40"
                >
                  <FaPlus className="inline w-2.5 h-2.5" /> Add
                </button>
              </div>
            ))}
          </div>

          {/* Composition */}
          <div className="border border-line-strong rounded p-3 overflow-y-auto">
            {composition.length === 0 && (
              <p className="text-ink-faint text-sm text-center mt-8">Add items from the left to build the exhibit.</p>
            )}
            {composition.map((it, i) => (
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
                className="border border-line-strong rounded mb-2 p-2 bg-surface text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <FaGripVertical className="text-ink-faint cursor-grab" />
                  <span className="text-ink-faint text-xs">#{i + 1}</span>
                  <span className="text-ink-muted text-[10px] uppercase ml-auto">{it._displayType}</span>
                  <button onClick={() => remove(i)} className="text-ink-faint hover:text-red-400"><FaXmark /></button>
                </div>
                <input
                  value={it.title}
                  onChange={(e) => setComposition((p) => p.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))}
                  placeholder="Title"
                  className="w-full bg-transparent text-ink text-sm outline-none border-b border-line-strong/40 mb-1 py-0.5"
                />
                <input
                  value={it.subtitle ?? ''}
                  onChange={(e) => setComposition((p) => p.map((x, idx) => idx === i ? { ...x, subtitle: e.target.value } : x))}
                  placeholder="Subtitle (optional)"
                  className="w-full bg-transparent text-ink-muted text-xs outline-none py-0.5"
                />
              </div>
            ))}
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-line-strong flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Cancel</button>
          <button
            onClick={() => setExportOpen(true)}
            disabled={composition.length === 0}
            className="px-3 h-8 rounded bg-brand hover:bg-brand/90 text-white text-sm font-medium disabled:opacity-50"
          >
            Export PDF
          </button>
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
