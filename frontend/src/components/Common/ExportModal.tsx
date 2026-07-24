'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { FaImage, FaFilePdf, FaFileWord, FaFileCsv, FaSpinner, FaMoon, FaSun } from 'react-icons/fa6';
import type { ExportTheme } from '@/lib/exportTheme';
import { ExportPreview } from './ExportPreview';
import { Button, Modal } from '@/components/ui';
import {
  FONT_FAMILIES, FONT_SIZES, FONT_LABELS,
  DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, DEFAULT_ORIENTATION,
  type FontFamily, type FontSize, type Orientation, type RenderOptions,
} from '@/lib/exportRenderOptions';

export type ExportKind = 'graph' | 'chart' | 'chronology' | 'report' | 'exhibit' | 'declaration' | 'redline';
export type ExportFormat = 'pdf' | 'png' | 'docx' | 'csv';

const FORMATS_BY_KIND: Record<ExportKind, ExportFormat[]> = {
  graph:       ['pdf', 'png'],
  chart:       ['pdf', 'png'],
  chronology:  ['pdf', 'png', 'csv'],
  report:      ['pdf', 'docx'],
  exhibit:     ['pdf'],
  declaration: ['pdf', 'docx'],
  redline:     ['pdf', 'docx'],
};

const FORMAT_LABELS: Record<ExportFormat, { label: string; desc: string; icon: React.ReactNode }> = {
  pdf:  { label: 'PDF',   desc: 'Best for printing',          icon: <FaFilePdf size={22} /> },
  png:  { label: 'PNG',   desc: 'Best for embedding/sharing', icon: <FaImage   size={22} /> },
  docx: { label: 'Word',  desc: 'Editable in Microsoft Word', icon: <FaFileWord size={22} /> },
  csv:  { label: 'CSV',   desc: 'Spreadsheet-friendly data',  icon: <FaFileCsv size={22} /> },
};

function sanitize(stem: string): string {
  return (stem || '').replace(/[^a-z0-9_-]/gi, '_').toLowerCase().slice(0, 80) || 'export';
}

interface Props {
  open: boolean;
  onClose: () => void;
  kind: ExportKind;
  defaultFilename: string;
  onExport: (format: ExportFormat, filename: string, theme: ExportTheme, renderOpts: RenderOptions) => Promise<void>;
  previewGenerate?: (theme: ExportTheme) => Promise<string>;
}

// Graph snapshots default to landscape because the cytoscape canvas is
// typically wider than tall; other exports follow the shared portrait default.
const defaultOrientationForKind = (kind: ExportKind): Orientation =>
  kind === 'graph' ? 'landscape' : DEFAULT_ORIENTATION;

export function ExportModal({ open, onClose, kind, defaultFilename, onExport, previewGenerate }: Props) {
  const formats = FORMATS_BY_KIND[kind];
  const [format, setFormat] = useState<ExportFormat>(formats[0]);
  const [stem, setStem]     = useState(sanitize(defaultFilename));
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [theme, setTheme]   = useState<ExportTheme>('dark');
  const [fontFamily, setFontFamily] = useState<FontFamily>(DEFAULT_FONT_FAMILY);
  const [fontSize, setFontSize]     = useState<FontSize>(DEFAULT_FONT_SIZE);
  const [orientation, setOrientation] = useState<Orientation>(defaultOrientationForKind(kind));

  useEffect(() => {
    if (open) {
      setFormat(formats[0]);
      setStem(sanitize(defaultFilename));
      setError(null);
      setBusy(false);
      setTheme('dark');
      setFontFamily(DEFAULT_FONT_FAMILY);
      setFontSize(DEFAULT_FONT_SIZE);
      setOrientation(defaultOrientationForKind(kind));
    }
  }, [open, kind, defaultFilename]);

  if (!open) return null;

  // Typography (font family + size) applies to rendered text exports — reports,
  // chronologies, and exhibits. Charts and graphs render as rasters so font CSS
  // would be inert; CSV is plain data with no rendering layer.
  const showTypography = (kind === 'report' || kind === 'chronology' || kind === 'exhibit') && format !== 'csv';
  // Orientation matters for chronology PDF (table flow) and graph PDF (page
  // shape for the snapshot). Reports stay portrait; charts always land
  // landscape; exhibit per-item orientation is deferred (see CLAUDE.md).
  const showOrientation = format === 'pdf' && (kind === 'chronology' || kind === 'graph');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const renderOpts: RenderOptions = {};
      if (showTypography) {
        renderOpts.fontFamily = fontFamily;
        renderOpts.fontSize = fontSize;
      }
      if (showOrientation) {
        renderOpts.orientation = orientation;
      }
      await onExport(format, sanitize(stem), theme, renderOpts);
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

  // For the wide preview layout, we render our own shell instead of Modal
  // (Modal's maxWidth would constrain the 960px two-column layout).
  if (showPreview) {
    return (
      <div
        className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4"
        onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      >
        <div className="bg-surface rounded-xl border border-line shadow-[0_24px_60px_-30px_rgba(11,18,32,0.25)] w-[960px] h-[640px] flex flex-col">
          {/* Header */}
          <header className="flex items-center gap-3 px-6 py-4 border-b border-line shrink-0">
            <div className="relative w-7 h-7 shrink-0">
              <Image src="/logo.png" alt="" fill sizes="28px" className="object-contain opacity-90" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-ink leading-tight">Export {kindLabel}</h3>
              <p className="text-[11px] text-ink-muted leading-tight mt-0.5">
                {showThemeToggle
                  ? 'Choose format, theme, and preview the output'
                  : 'Choose format and preview the output'}
              </p>
            </div>
          </header>

          {/* Body */}
          <div className="p-6 grid grid-cols-[420px_1fr] gap-6 h-[calc(100%-65px)]">
            <div className="flex flex-col min-h-0">
              {renderControls()}
            </div>
            <ExportPreview theme={theme} generate={previewGenerate!} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      maxWidth="max-w-[480px]"
      footer={renderFooter()}
    >
      {/* Header with logo */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative w-7 h-7 shrink-0">
          <Image src="/logo.png" alt="" fill sizes="28px" className="object-contain opacity-90" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink leading-tight">Export {kindLabel}</h3>
          <p className="text-[11px] text-ink-muted leading-tight mt-0.5">Choose format and download</p>
        </div>
      </div>
      {renderControls()}
    </Modal>
  );

  function renderControls() {
    return (
      <>
        <label className="block text-xs font-medium text-ink-muted mb-1.5">Filename</label>
        <div className="flex items-stretch mb-5 border border-line-strong rounded-lg overflow-hidden focus-within:border-brand/60 transition-colors">
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
              className={`flex-1 flex flex-col items-center gap-1.5 px-3 py-3.5 rounded-lg border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                format === f
                  ? 'bg-brand border-brand text-white'
                  : 'bg-surface-raised border-transparent hover:border-line-strong text-ink-muted'
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

        {showThemeToggle && (
          <>
            <label className="block text-xs font-medium text-ink-muted mb-2">Theme</label>
            <div className="flex p-1 mb-5 bg-surface rounded-lg border border-line-strong">
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  disabled={busy}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
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

        {showTypography && (
          <div className="grid grid-cols-[1fr_auto] gap-3 mb-5">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5">Font</label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as FontFamily)}
                disabled={busy}
                className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-lg text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: FONT_LABELS[f].preview }}>
                    {FONT_LABELS[f].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5">Size</label>
              <select
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value) as FontSize)}
                disabled={busy}
                className="h-9 px-2.5 bg-surface border border-line-strong rounded-lg text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
              >
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>{s} pt</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {showOrientation && (
          <>
            <label className="block text-xs font-medium text-ink-muted mb-2">Orientation</label>
            <div className="flex p-1 mb-5 bg-surface rounded-lg border border-line-strong">
              {(['portrait', 'landscape'] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => setOrientation(o)}
                  disabled={busy}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                    orientation === o
                      ? 'bg-surface-raised text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </>
        )}

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-redline text-xs">
            {error}
          </div>
        )}

        {showPreview && renderFooter()}
      </>
    );
  }

  function renderFooter() {
    return (
      <div className="flex justify-end gap-2 mt-auto pt-2">
        <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" size="md" onClick={submit} disabled={busy || !stem.trim()}>
          {busy ? <><FaSpinner className="animate-spin" /> Exporting…</> : 'Export'}
        </Button>
      </div>
    );
  }
}
