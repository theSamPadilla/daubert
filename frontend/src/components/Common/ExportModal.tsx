'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { FaImage, FaFilePdf, FaFileWord, FaSpinner, FaMoon, FaSun } from 'react-icons/fa6';
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

  const kindLabel = kind === 'exhibit' ? 'Exhibit' : kind.charAt(0).toUpperCase() + kind.slice(1);
  const showPreview = !!previewGenerate && (kind === 'graph' || kind === 'chart');
  const showThemeToggle = showPreview && (kind === 'graph' || kind === 'chart');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`bg-surface-panel rounded-xl border border-line-strong shadow-2xl ${showPreview ? 'w-[960px] h-[640px]' : 'w-[480px]'}`}>
        {/* Header */}
        <header className="flex items-center gap-3 px-6 py-4 border-b border-line-strong">
          <div className="relative w-7 h-7 shrink-0">
            <Image src="/logo-light.png" alt="" fill sizes="28px" className="object-contain opacity-90" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink leading-tight">Export {kindLabel}</h3>
            <p className="text-[11px] text-ink-muted leading-tight mt-0.5">
              {showThemeToggle
                ? 'Choose format, theme, and preview the output'
                : showPreview
                  ? 'Choose format and preview the output'
                  : 'Choose format and download'}
            </p>
          </div>
        </header>

        {/* Body */}
        <div className={`p-6 ${showPreview ? 'grid grid-cols-[420px_1fr] gap-6 h-[calc(100%-65px)]' : ''}`}>
          <div className={showPreview ? 'flex flex-col min-h-0' : ''}>

            <label className="block text-xs font-medium text-ink-muted mb-1.5">Filename</label>
            <div className="flex items-stretch mb-5 border border-line-strong rounded-md overflow-hidden focus-within:border-brand/60 transition-colors">
              <input
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                className="flex-1 px-3 py-2 bg-surface text-ink text-sm outline-none"
                disabled={busy}
                spellCheck={false}
              />
              <span className="px-3 py-2 bg-surface-raised text-ink-muted text-xs font-mono border-l border-line-strong flex items-center">
                .{format}
              </span>
            </div>

            <label className="block text-xs font-medium text-ink-muted mb-2">Format</label>
            <div className="flex gap-2.5 mb-5">
              {formats.map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  disabled={busy}
                  className={`flex-1 flex flex-col items-center gap-1.5 px-3 py-3.5 rounded-lg border transition-all ${
                    format === f
                      ? 'bg-brand/15 border-brand text-brand'
                      : 'bg-surface-raised border-transparent hover:border-line-strong text-ink-muted'
                  }`}
                >
                  {FORMAT_LABELS[f].icon}
                  <span className="text-sm font-semibold">{FORMAT_LABELS[f].label}</span>
                  <span className={`text-[10px] ${format === f ? 'text-brand/80' : 'text-ink-faint'} text-center leading-snug`}>
                    {FORMAT_LABELS[f].desc}
                  </span>
                </button>
              ))}
            </div>

            {showThemeToggle && (
              <>
                <label className="block text-xs font-medium text-ink-muted mb-2">Theme</label>
                <div className="flex p-1 mb-5 bg-surface rounded-lg border border-line-strong">
                  {(['dark', 'light'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      disabled={busy}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        theme === t
                          ? 'bg-surface-raised text-ink shadow-sm'
                          : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {t === 'dark' ? <FaMoon className="w-3.5 h-3.5" /> : <FaSun className="w-3.5 h-3.5" />}
                      {t === 'dark' ? 'Dark' : 'Light'}
                    </button>
                  ))}
                </div>
              </>
            )}

            {error && (
              <div className="mb-3 px-3 py-2 rounded-md bg-red-900/40 border border-red-800/60 text-red-200 text-xs">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-auto pt-2">
              <button onClick={onClose} disabled={busy}
                      className="px-4 h-9 text-sm text-ink-muted hover:text-ink disabled:opacity-50 rounded-md transition-colors">
                Cancel
              </button>
              <button onClick={submit} disabled={busy || !stem.trim()}
                      className="px-5 h-9 rounded-md bg-brand hover:bg-brand/90 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60 transition-colors">
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
