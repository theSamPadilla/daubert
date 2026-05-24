'use client';
import { useEffect, useState } from 'react';
import { FaImage, FaFilePdf, FaFileWord, FaSpinner } from 'react-icons/fa6';
import type { ExportTheme } from '@/lib/exportTheme';
import { ExportPreview } from './ExportPreview';

export type ExportKind = 'graph' | 'chart' | 'chronology' | 'report' | 'exhibit';
export type ExportFormat = 'pdf' | 'png' | 'docx';

const FORMATS_BY_KIND: Record<ExportKind, ExportFormat[]> = {
  graph:      ['pdf', 'png'],
  chart:      ['pdf', 'png'],
  chronology: ['pdf', 'png'],
  report:     ['pdf', 'docx'],
  exhibit:    ['pdf'],
};

const FORMAT_LABELS: Record<ExportFormat, { label: string; desc: string; icon: React.ReactNode }> = {
  pdf:  { label: 'PDF',   desc: 'Best for printing',          icon: <FaFilePdf size={22} /> },
  png:  { label: 'PNG',   desc: 'Best for embedding/sharing', icon: <FaImage   size={22} /> },
  docx: { label: 'Word',  desc: 'Editable in Microsoft Word', icon: <FaFileWord size={22} /> },
};

function sanitize(stem: string): string {
  return (stem || '').replace(/[^a-z0-9_-]/gi, '_').toLowerCase().slice(0, 80) || 'export';
}

interface Props {
  open: boolean;
  onClose: () => void;
  kind: ExportKind;
  defaultFilename: string;
  onExport: (format: ExportFormat, filename: string, theme: ExportTheme) => Promise<void>;
  previewGenerate?: (theme: ExportTheme) => Promise<string>;
}

export function ExportModal({ open, onClose, kind, defaultFilename, onExport, previewGenerate }: Props) {
  const formats = FORMATS_BY_KIND[kind];
  const [format, setFormat] = useState<ExportFormat>(formats[0]);
  const [stem, setStem]     = useState(sanitize(defaultFilename));
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [theme, setTheme]   = useState<ExportTheme>('dark');

  useEffect(() => {
    if (open) {
      setFormat(formats[0]);
      setStem(sanitize(defaultFilename));
      setError(null);
      setBusy(false);
      setTheme('dark');
    }
  }, [open, kind, defaultFilename]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onExport(format, sanitize(stem), theme);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const title = `Export ${kind === 'exhibit' ? 'Exhibit' : kind.charAt(0).toUpperCase() + kind.slice(1)}`;
  const showPreview = !!previewGenerate && (kind === 'graph' || kind === 'chart');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`bg-surface-panel rounded-lg p-6 ${showPreview ? 'w-[960px] h-[620px]' : 'w-[460px]'}`}>
        <h3 className="text-sm font-semibold text-ink-muted uppercase mb-5">{title}</h3>

        <div className={showPreview ? 'grid grid-cols-[440px_1fr] gap-6 h-[calc(100%-60px)]' : ''}>
          <div className={showPreview ? 'flex flex-col' : ''}>

            <label className="block text-xs text-ink-muted mb-1">Filename</label>
            <div className="flex items-stretch mb-5 border border-line-strong rounded overflow-hidden">
              <input
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                className="flex-1 px-3 py-2 bg-surface text-ink text-sm outline-none"
                disabled={busy}
                spellCheck={false}
              />
              <span className="px-3 py-2 bg-surface-raised text-ink-muted text-sm border-l border-line-strong">
                .{format}
              </span>
            </div>

            <label className="block text-xs text-ink-muted mb-2">Format</label>
            <div className="flex gap-3 mb-4">
              {formats.map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  disabled={busy}
                  className={`flex-1 flex flex-col items-center gap-1.5 px-3 py-4 rounded-lg transition-colors ${
                    format === f ? 'bg-brand text-white' : 'bg-surface-raised hover:bg-surface-raised/80 text-ink-muted'
                  }`}
                >
                  {FORMAT_LABELS[f].icon}
                  <span className="text-sm font-semibold">{FORMAT_LABELS[f].label}</span>
                  <span className={`text-[10px] ${format === f ? 'text-white/80' : 'text-ink-faint'} text-center leading-snug`}>
                    {FORMAT_LABELS[f].desc}
                  </span>
                </button>
              ))}
            </div>

            {showPreview && (
              <>
                <label className="block text-xs text-ink-muted mb-2">Theme</label>
                <div className="flex gap-2 mb-5">
                  {(['dark', 'light'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      disabled={busy}
                      className={`flex-1 px-3 py-2 rounded text-sm transition-colors ${
                        theme === t ? 'bg-brand text-white' : 'bg-surface-raised hover:bg-surface-raised/80 text-ink-muted'
                      }`}
                    >
                      {t === 'dark' ? 'Dark' : 'Light'}
                    </button>
                  ))}
                </div>
              </>
            )}

            {error && (
              <div className="mb-3 px-3 py-2 rounded bg-red-900/40 border border-red-800/60 text-red-200 text-xs">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-auto">
              <button onClick={onClose} disabled={busy}
                      className="px-3 h-8 text-sm text-ink-muted hover:text-ink disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submit} disabled={busy || !stem.trim()}
                      className="px-4 h-8 rounded bg-brand hover:bg-brand/90 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                {busy ? <><FaSpinner className="animate-spin" /> Exporting…</> : 'Export'}
              </button>
            </div>
          </div>

          {showPreview && (
            <ExportPreview theme={theme} generate={previewGenerate!} />
          )}
        </div>
      </div>
    </div>
  );
}
