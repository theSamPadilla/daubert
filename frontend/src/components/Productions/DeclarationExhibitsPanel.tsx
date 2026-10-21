'use client';

import { useMemo, useState } from 'react';
import type { IconType } from 'react-icons';
import {
  FaChevronDown, FaChevronRight, FaPlus, FaTrash, FaPaperclip, FaArrowUpRightFromSquare,
  FaPen, FaCheck, FaRightLeft, FaGlobe, FaRegFile, FaTriangleExclamation,
} from 'react-icons/fa6';
import type { components } from '@/generated/api-types';
import { Button, IconButton, Input, Select, Textarea } from '@/components/ui';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { computeDeclarationNumbering } from '@/utils/declarationNumbering';

type DeclarationData = components['schemas']['DeclarationData'];
type DeclarationExhibit = components['schemas']['DeclarationExhibit'];
type DeclarationExhibitSource = components['schemas']['DeclarationExhibitSource'];
type DeclarationSourceKind = DeclarationExhibitSource['kind'];

interface DeclarationExhibitsPanelProps {
  data: DeclarationData;
  readOnly: boolean;
  /** Emits the next full DeclarationData (immutable). */
  onChange: (next: DeclarationData) => void;
}

const SOURCE_KIND_OPTIONS: { value: DeclarationSourceKind; label: string }[] = [
  { value: 'transaction', label: 'Transaction' },
  { value: 'url', label: 'URL' },
  { value: 'file', label: 'File' },
  { value: 'other', label: 'Other' },
];

const SOURCE_KIND_META: Record<DeclarationSourceKind, { label: string; Icon: IconType }> = {
  transaction: { label: 'Transaction', Icon: FaRightLeft },
  url: { label: 'Web page', Icon: FaGlobe },
  file: { label: 'File', Icon: FaRegFile },
  other: { label: 'Other', Icon: FaPaperclip },
};

/**
 * Next unused exhibit label — mirrors backend `nextExhibitLabel`:
 * A..Z first, then Z1, Z2, … once every letter is taken.
 */
function nextExhibitLabel(exhibits: DeclarationExhibit[]): string {
  const used = new Set(exhibits.map((e) => e.label));
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) return l;
  }
  let n = 1;
  while (used.has(`Z${n}`)) n += 1;
  return `Z${n}`;
}

/** The source's identifying detail (hash, URL, or note), for the card. */
function sourceDetail(source: DeclarationExhibitSource | null): string | null {
  if (!source) return null;
  switch (source.kind) {
    case 'transaction':
      return [source.chain, source.txHash].filter(Boolean).join(' · ') || null;
    case 'url':
      return source.url || null;
    case 'file':
    case 'other':
      return source.note || null;
    default:
      return null;
  }
}

/** Only http/https URLs are safe to render as a clickable anchor (blocks javascript:, etc.). */
function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** Reset irrelevant fields when the source kind changes. */
function sourceForKind(kind: DeclarationSourceKind, prev: DeclarationExhibitSource | null): DeclarationExhibitSource {
  switch (kind) {
    case 'transaction':
      return { kind, txHash: prev?.txHash ?? '', chain: prev?.chain ?? '', url: prev?.url ?? '' };
    case 'url':
      return { kind, url: prev?.url ?? '' };
    case 'file':
      return { kind, note: prev?.note ?? '' };
    case 'other':
      return { kind, note: prev?.note ?? '' };
    default:
      return { kind };
  }
}

/** Paragraph numbers (as rendered in the declaration) that cite each exhibit. */
function citationsByExhibit(data: DeclarationData): Map<string, number[]> {
  const { paragraphNumbers } = computeDeclarationNumbering(data);
  const out = new Map<string, number[]>();
  for (const section of data.sections) {
    for (const paragraph of section.paragraphs) {
      const n = paragraphNumbers.get(paragraph.id);
      if (n === undefined) continue;
      for (const eid of paragraph.exhibitIds) {
        out.set(eid, [...(out.get(eid) ?? []), n]);
      }
    }
  }
  return out;
}

export function DeclarationExhibitsPanel({ data, readOnly, onChange }: DeclarationExhibitsPanelProps) {
  const confirm = useConfirm();
  const exhibits = data.exhibits;
  const [open, setOpen] = useState(exhibits.length > 0);
  const [editingId, setEditingId] = useState<string | null>(null);

  const citations = useMemo(() => citationsByExhibit(data), [data]);

  const setExhibits = (updater: (exhibits: DeclarationExhibit[]) => DeclarationExhibit[]) => {
    if (readOnly) return;
    onChange({ ...data, exhibits: updater(exhibits) });
  };

  const patchExhibit = (id: string, patch: Partial<DeclarationExhibit>) => {
    setExhibits((list) => list.map((ex) => (ex.id === id ? { ...ex, ...patch } : ex)));
  };

  const addExhibit = () => {
    if (readOnly) return;
    const exhibit: DeclarationExhibit = {
      id: crypto.randomUUID(),
      label: nextExhibitLabel(exhibits),
      description: '',
      source: null,
    };
    setExhibits((list) => [...list, exhibit]);
    setOpen(true);
    setEditingId(exhibit.id);
  };

  const removeExhibit = async (exhibit: DeclarationExhibit) => {
    if (readOnly) return;
    const ok = await confirm({
      title: 'Delete exhibit?',
      message: (
        <>
          Delete Exhibit <span className="font-medium text-ink">{exhibit.label}</span>. Any paragraph
          references to it will also be removed. This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    // Strip the exhibit AND every paragraph's reference to it, in one immutable update.
    onChange({
      ...data,
      exhibits: data.exhibits.filter((ex) => ex.id !== exhibit.id),
      sections: data.sections.map((section) => ({
        ...section,
        paragraphs: section.paragraphs.map((paragraph) =>
          paragraph.exhibitIds.includes(exhibit.id)
            ? { ...paragraph, exhibitIds: paragraph.exhibitIds.filter((eid) => eid !== exhibit.id) }
            : paragraph,
        ),
      })),
    });
  };

  const uncitedCount = exhibits.filter((ex) => !(citations.get(ex.id)?.length)).length;

  return (
    <div className="rounded-lg border border-line-strong bg-surface-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-raised transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <FaPaperclip className="w-3.5 h-3.5 text-ink-muted" />
          Exhibits
          {exhibits.length > 0 && (
            <span className="text-xs font-mono text-ink-faint">{exhibits.length}</span>
          )}
          {uncitedCount > 0 && (
            <span className="text-[11px] font-normal text-amber-700">
              {uncitedCount} not cited
            </span>
          )}
        </span>
        {open ? (
          <FaChevronDown className="w-3 h-3 text-ink-muted" />
        ) : (
          <FaChevronRight className="w-3 h-3 text-ink-muted" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-3 space-y-2 border-t border-line">
          {exhibits.length === 0 && (
            <p className="text-xs text-ink-faint py-2">No exhibits yet.</p>
          )}

          {exhibits.map((exhibit) => {
            const editing = !readOnly && editingId === exhibit.id;
            const meta = exhibit.source ? SOURCE_KIND_META[exhibit.source.kind] : null;
            const detail = sourceDetail(exhibit.source);
            const cites = citations.get(exhibit.id) ?? [];
            const link =
              (exhibit.source?.kind === 'url' || exhibit.source?.kind === 'transaction') &&
              exhibit.source.url &&
              isSafeHttpUrl(exhibit.source.url)
                ? exhibit.source.url
                : null;

            return (
              <div
                key={exhibit.id}
                data-testid="exhibit-card"
                className={`rounded-lg border bg-surface transition-colors ${
                  editing ? 'border-brand' : 'border-line'
                }`}
              >
                <div className="flex gap-3 p-3">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-brand-soft text-brand">
                    <span className="text-[9px] font-semibold uppercase tracking-wider">Ex.</span>
                    <span className="font-mono text-base font-bold leading-none">{exhibit.label || '?'}</span>
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <p
                      className={`text-sm leading-snug line-clamp-2 ${exhibit.description ? 'text-ink' : 'italic text-ink-faint'}`}
                      title={exhibit.description || undefined}
                    >
                      {exhibit.description || 'No description'}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                      {meta ? (
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <meta.Icon className="h-3 w-3 shrink-0" />
                          <span className="shrink-0">{meta.label}</span>
                          {detail && exhibit.source?.kind === 'transaction' && (
                            <span className="truncate font-mono text-ink-faint max-w-[16rem]">{detail}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-ink-faint">No source</span>
                      )}
                      {cites.length > 0 ? (
                        <span>
                          Cited in {cites.map((n) => `¶ ${n}`).join(', ')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <FaTriangleExclamation className="h-3 w-3" /> Not cited
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-start gap-0.5">
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open Exhibit ${exhibit.label}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-brand"
                      >
                        <FaArrowUpRightFromSquare className="h-3 w-3" />
                      </a>
                    )}
                    {!readOnly && (
                      <>
                        <IconButton
                          aria-label={editing ? `Done editing Exhibit ${exhibit.label}` : `Edit Exhibit ${exhibit.label}`}
                          onClick={() => setEditingId(editing ? null : exhibit.id)}
                          className={editing ? 'text-brand' : ''}
                        >
                          {editing ? <FaCheck className="h-3.5 w-3.5" /> : <FaPen className="h-3 w-3" />}
                        </IconButton>
                        <IconButton
                          aria-label={`Delete Exhibit ${exhibit.label}`}
                          onClick={() => removeExhibit(exhibit)}
                          className="hover:text-redline"
                        >
                          <FaTrash className="h-3 w-3" />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>

                {editing && (
                  <div className="space-y-2 border-t border-line px-3 pb-3 pt-3">
                    <div className="flex gap-2">
                      <div className="w-16 shrink-0">
                        <Input
                          value={exhibit.label}
                          onChange={(e) => patchExhibit(exhibit.id, { label: e.target.value })}
                          placeholder="A"
                          className="text-center font-mono font-semibold uppercase"
                          aria-label="Exhibit label"
                        />
                      </div>
                      <Select
                        value={exhibit.source?.kind ?? ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          patchExhibit(exhibit.id, {
                            source: value ? sourceForKind(value as DeclarationSourceKind, exhibit.source) : null,
                          });
                        }}
                        aria-label="Source kind"
                      >
                        <option value="">No source</option>
                        {SOURCE_KIND_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <Textarea
                      value={exhibit.description}
                      onChange={(e) => patchExhibit(exhibit.id, { description: e.target.value })}
                      placeholder="What this exhibit is, e.g. Bank statement export, Jan-Aug 2025"
                      rows={3}
                      aria-label="Exhibit description"
                    />

                    {exhibit.source?.kind === 'transaction' && (
                      <div className="grid grid-cols-1 gap-2">
                        <Input
                          value={exhibit.source.txHash ?? ''}
                          onChange={(e) =>
                            patchExhibit(exhibit.id, { source: { ...exhibit.source!, txHash: e.target.value } })
                          }
                          placeholder="Transaction hash"
                        />
                        <Input
                          value={exhibit.source.chain ?? ''}
                          onChange={(e) =>
                            patchExhibit(exhibit.id, { source: { ...exhibit.source!, chain: e.target.value } })
                          }
                          placeholder="Chain, e.g. Ethereum"
                        />
                        <Input
                          value={exhibit.source.url ?? ''}
                          onChange={(e) =>
                            patchExhibit(exhibit.id, { source: { ...exhibit.source!, url: e.target.value } })
                          }
                          placeholder="Explorer URL (optional)"
                        />
                      </div>
                    )}

                    {exhibit.source?.kind === 'url' && (
                      <Input
                        value={exhibit.source.url ?? ''}
                        onChange={(e) =>
                          patchExhibit(exhibit.id, { source: { ...exhibit.source!, url: e.target.value } })
                        }
                        placeholder="https://…"
                      />
                    )}

                    {(exhibit.source?.kind === 'file' || exhibit.source?.kind === 'other') && (
                      <Input
                        value={exhibit.source.note ?? ''}
                        onChange={(e) =>
                          patchExhibit(exhibit.id, { source: { ...exhibit.source!, note: e.target.value } })
                        }
                        placeholder="Note, e.g. produced as WESTLAND-003118"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              onClick={addExhibit}
              className="text-ink-muted"
            >
              <FaPlus className="w-3 h-3" /> Add exhibit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
