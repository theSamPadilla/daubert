'use client';

import { useState } from 'react';
import {
  FaChevronDown, FaChevronRight, FaPlus, FaTrash, FaPaperclip, FaArrowUpRightFromSquare,
} from 'react-icons/fa6';
import type { components } from '@/generated/api-types';
import { Button, IconButton, Input, Select } from '@/components/ui';
import { useConfirm } from '@/components/Common/ConfirmProvider';

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

/** One-line human summary of a source, for the row. */
function sourceSummary(source: DeclarationExhibitSource | null): string {
  if (!source) return '—';
  switch (source.kind) {
    case 'transaction': {
      const parts = [source.chain, source.txHash].filter(Boolean);
      return parts.length ? `Transaction · ${parts.join(' ')}` : 'Transaction';
    }
    case 'url':
      return source.url ? `URL · ${source.url}` : 'URL';
    case 'file':
      return source.note ? `File · ${source.note}` : 'File';
    case 'other':
      return source.note ? `Other · ${source.note}` : 'Other';
    default:
      return '—';
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

export function DeclarationExhibitsPanel({ data, readOnly, onChange }: DeclarationExhibitsPanelProps) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);

  const exhibits = data.exhibits;

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
        </span>
        {open ? (
          <FaChevronDown className="w-3 h-3 text-ink-muted" />
        ) : (
          <FaChevronRight className="w-3 h-3 text-ink-muted" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-2 border-t border-line">
          {exhibits.length === 0 && (
            <p className="text-xs text-ink-faint py-2">No exhibits yet.</p>
          )}

          {exhibits.map((exhibit) => {
            const editingSource = editingSourceId === exhibit.id;
            return (
              <div
                key={exhibit.id}
                className="rounded-md border border-line bg-surface p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <Input
                    value={exhibit.label}
                    disabled={readOnly}
                    onChange={(e) => patchExhibit(exhibit.id, { label: e.target.value })}
                    placeholder="A"
                    className="w-14 shrink-0 text-center font-mono font-semibold uppercase"
                    aria-label="Exhibit label"
                  />
                  <Input
                    value={exhibit.description}
                    disabled={readOnly}
                    onChange={(e) => patchExhibit(exhibit.id, { description: e.target.value })}
                    placeholder="Description"
                    className="flex-1"
                    aria-label="Exhibit description"
                  />
                  {!readOnly && (
                    <IconButton
                      aria-label="Delete exhibit"
                      onClick={() => removeExhibit(exhibit)}
                      className="shrink-0 hover:text-redline"
                    >
                      <FaTrash className="w-3.5 h-3.5" />
                    </IconButton>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <span className="truncate flex-1">{sourceSummary(exhibit.source)}</span>
                  {exhibit.source?.kind === 'url' && exhibit.source.url && (
                    isSafeHttpUrl(exhibit.source.url) ? (
                      <a
                        href={exhibit.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand hover:underline shrink-0"
                      >
                        Open <FaArrowUpRightFromSquare className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span className="truncate shrink-0 max-w-[10rem]">{exhibit.source.url}</span>
                    )
                  )}
                  {exhibit.source?.kind === 'transaction' && exhibit.source.url && (
                    isSafeHttpUrl(exhibit.source.url) ? (
                      <a
                        href={exhibit.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand hover:underline shrink-0"
                      >
                        Open <FaArrowUpRightFromSquare className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span className="truncate shrink-0 max-w-[10rem]">{exhibit.source.url}</span>
                    )
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setEditingSourceId(editingSource ? null : exhibit.id)}
                      className="text-ink-muted hover:text-ink transition-colors shrink-0"
                    >
                      {editingSource ? 'Done' : 'Edit source'}
                    </button>
                  )}
                </div>

                {!readOnly && editingSource && (
                  <div className="space-y-2 pt-1 border-t border-line">
                    <Select
                      value={exhibit.source?.kind ?? ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        patchExhibit(exhibit.id, {
                          source: value
                            ? sourceForKind(value as DeclarationSourceKind, exhibit.source)
                            : null,
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

                    {exhibit.source?.kind === 'transaction' && (
                      <div className="grid grid-cols-1 gap-2">
                        <Input
                          value={exhibit.source.txHash ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            patchExhibit(exhibit.id, {
                              source: { ...exhibit.source!, txHash: e.target.value },
                            })
                          }
                          placeholder="Transaction hash"
                        />
                        <Input
                          value={exhibit.source.chain ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            patchExhibit(exhibit.id, {
                              source: { ...exhibit.source!, chain: e.target.value },
                            })
                          }
                          placeholder="Chain, e.g. Ethereum"
                        />
                        <Input
                          value={exhibit.source.url ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            patchExhibit(exhibit.id, {
                              source: { ...exhibit.source!, url: e.target.value },
                            })
                          }
                          placeholder="Explorer URL (optional)"
                        />
                      </div>
                    )}

                    {exhibit.source?.kind === 'url' && (
                      <Input
                        value={exhibit.source.url ?? ''}
                        disabled={readOnly}
                        onChange={(e) =>
                          patchExhibit(exhibit.id, {
                            source: { ...exhibit.source!, url: e.target.value },
                          })
                        }
                        placeholder="https://…"
                      />
                    )}

                    {(exhibit.source?.kind === 'file' || exhibit.source?.kind === 'other') && (
                      <Input
                        value={exhibit.source.note ?? ''}
                        disabled={readOnly}
                        onChange={(e) =>
                          patchExhibit(exhibit.id, {
                            source: { ...exhibit.source!, note: e.target.value },
                          })
                        }
                        placeholder="Note"
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
