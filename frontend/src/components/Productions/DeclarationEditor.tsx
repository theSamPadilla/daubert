'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FaChevronDown, FaChevronRight, FaPlus, FaTrash, FaFileSignature, FaBookOpen, FaUserTie,
} from 'react-icons/fa6';
import type { components } from '@/generated/api-types';
import { apiClient, type DeclarationFormat, type Production } from '@/lib/api-client';
import { Button, IconButton, Field, Input, Select, Textarea, Badge } from '@/components/ui';
import { computeDeclarationNumbering } from '@/utils/declarationNumbering';
import { DeclarationExhibitsPanel } from './DeclarationExhibitsPanel';
import { DeclarationLibraryPicker } from './DeclarationLibraryPicker';
import { DeclarantPicker } from './DeclarantPicker';

type DeclarationData = components['schemas']['DeclarationData'];
type DeclarationCaption = components['schemas']['DeclarationCaption'];
type DeclarationSection = components['schemas']['DeclarationSection'];
type DeclarationSectionKind = components['schemas']['DeclarationSectionKind'];
type DeclarationParagraph = components['schemas']['DeclarationParagraph'];
type DeclarationSubItem = components['schemas']['DeclarationSubItem'];
type DeclarationFootnote = components['schemas']['DeclarationFootnote'];
type DeclarationFormatId = components['schemas']['DeclarationFormatId'];

interface DeclarationEditorProps {
  production: Production;
  readOnly: boolean;
  onChange: (data: DeclarationData) => void;
}

const SECTION_KIND_OPTIONS: { value: DeclarationSectionKind; label: string }[] = [
  { value: 'qualifications', label: 'Qualifications' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'summary_of_opinions', label: 'Summary of Opinions' },
  { value: 'background', label: 'Background' },
  { value: 'authentication', label: 'Authentication' },
  { value: 'findings', label: 'Findings' },
  { value: 'conclusions', label: 'Conclusions' },
  { value: 'recommendations', label: 'Recommendations' },
  { value: 'custom', label: 'Custom' },
];

const SECTION_KIND_LABEL: Record<DeclarationSectionKind, string> = Object.fromEntries(
  SECTION_KIND_OPTIONS.map((o) => [o.value, o.label]),
) as Record<DeclarationSectionKind, string>;

function subItemLetter(index: number): string {
  return `${String.fromCharCode(97 + (index % 26))}.`;
}

function AutoTextarea({
  value,
  onChange,
  placeholder,
  disabled,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Textarea
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }}
      ref={(el) => {
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      className={`resize-none overflow-hidden leading-relaxed ${className}`}
    />
  );
}

export function DeclarationEditor({ production, readOnly, onChange }: DeclarationEditorProps) {
  const data = production.data as unknown as DeclarationData;
  const [captionOpen, setCaptionOpen] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionKind, setNewSectionKind] = useState<DeclarationSectionKind>('custom');
  const [newSectionHeading, setNewSectionHeading] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [declarantOpen, setDeclarantOpen] = useState(false);
  const [formats, setFormats] = useState<DeclarationFormat[]>([]);

  // Fetch the jurisdiction format catalog once so we know which declarant
  // fields (DOB / address) the current format requires.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .listDeclarationFormats()
      .then((f) => {
        if (!cancelled) setFormats(f);
      })
      .catch((err) => console.error('Failed to load declaration formats:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the active format id (formatId is canonical; variant is the
  // deprecated back-compat field; default to CA when absent).
  const formatId = data.formatId ?? data.variant ?? 'ca-declaration';
  const requiredDeclarantFields = useMemo(
    () => formats.find((f) => f.id === formatId)?.requiredDeclarantFields ?? [],
    [formats, formatId],
  );
  const needsDateOfBirth = requiredDeclarantFields.includes('dateOfBirth');
  const needsAddress = requiredDeclarantFields.includes('address');

  const numbering = useMemo(() => computeDeclarationNumbering(data), [data]);

  const emit = useCallback(
    (next: DeclarationData) => {
      if (readOnly) return;
      onChange(next);
    },
    [onChange, readOnly],
  );

  const setCaption = useCallback(
    (patch: Partial<DeclarationCaption>) => {
      emit({ ...data, caption: { ...data.caption, ...patch } });
    },
    [data, emit],
  );

  const setDeclarantName = useCallback(
    (declarantName: string) => {
      emit({ ...data, declarantName });
    },
    [data, emit],
  );

  const setDeclarantDateOfBirth = useCallback(
    (declarantDateOfBirth: string) => {
      emit({ ...data, declarantDateOfBirth });
    },
    [data, emit],
  );

  const setDeclarantAddress = useCallback(
    (declarantAddress: string) => {
      emit({ ...data, declarantAddress });
    },
    [data, emit],
  );

  const setFormatId = useCallback(
    (nextFormatId: DeclarationFormatId) => {
      emit({ ...data, formatId: nextFormatId });
    },
    [data, emit],
  );

  const setExecution = useCallback(
    (patch: Partial<DeclarationData['execution']>) => {
      emit({ ...data, execution: { ...data.execution, ...patch } });
    },
    [data, emit],
  );

  const updateSections = useCallback(
    (updater: (sections: DeclarationSection[]) => DeclarationSection[]) => {
      emit({ ...data, sections: updater(data.sections) });
    },
    [data, emit],
  );

  const addSection = useCallback(() => {
    const heading = newSectionHeading.trim();
    if (!heading) return;
    const section: DeclarationSection = {
      id: crypto.randomUUID(),
      kind: newSectionKind,
      heading,
      paragraphs: [],
    };
    updateSections((sections) => [...sections, section]);
    setNewSectionHeading('');
    setNewSectionKind('custom');
    setAddingSection(false);
  }, [newSectionHeading, newSectionKind, updateSections]);

  const removeSection = useCallback(
    (sectionId: string) => {
      updateSections((sections) => sections.filter((s) => s.id !== sectionId));
    },
    [updateSections],
  );

  const setSectionHeading = useCallback(
    (sectionId: string, heading: string) => {
      updateSections((sections) =>
        sections.map((s) => (s.id === sectionId ? { ...s, heading } : s)),
      );
    },
    [updateSections],
  );

  const updateParagraphs = useCallback(
    (sectionId: string, updater: (paragraphs: DeclarationParagraph[]) => DeclarationParagraph[]) => {
      updateSections((sections) =>
        sections.map((s) =>
          s.id === sectionId ? { ...s, paragraphs: updater(s.paragraphs) } : s,
        ),
      );
    },
    [updateSections],
  );

  const addParagraph = useCallback(
    (sectionId: string) => {
      const paragraph: DeclarationParagraph = {
        id: crypto.randomUUID(),
        text: '',
        subItems: [],
        exhibitIds: [],
        footnotes: [],
      };
      updateParagraphs(sectionId, (paragraphs) => [...paragraphs, paragraph]);
    },
    [updateParagraphs],
  );

  const removeParagraph = useCallback(
    (sectionId: string, paragraphId: string) => {
      updateParagraphs(sectionId, (paragraphs) => paragraphs.filter((p) => p.id !== paragraphId));
    },
    [updateParagraphs],
  );

  const patchParagraph = useCallback(
    (sectionId: string, paragraphId: string, patch: Partial<DeclarationParagraph>) => {
      updateParagraphs(sectionId, (paragraphs) =>
        paragraphs.map((p) => (p.id === paragraphId ? { ...p, ...patch } : p)),
      );
    },
    [updateParagraphs],
  );

  const addSubItem = useCallback(
    (sectionId: string, paragraph: DeclarationParagraph) => {
      const subItem: DeclarationSubItem = { id: crypto.randomUUID(), text: '' };
      patchParagraph(sectionId, paragraph.id, { subItems: [...paragraph.subItems, subItem] });
    },
    [patchParagraph],
  );

  const removeSubItem = useCallback(
    (sectionId: string, paragraph: DeclarationParagraph, subItemId: string) => {
      patchParagraph(sectionId, paragraph.id, {
        subItems: paragraph.subItems.filter((si) => si.id !== subItemId),
      });
    },
    [patchParagraph],
  );

  const setSubItemText = useCallback(
    (sectionId: string, paragraph: DeclarationParagraph, subItemId: string, text: string) => {
      patchParagraph(sectionId, paragraph.id, {
        subItems: paragraph.subItems.map((si) => (si.id === subItemId ? { ...si, text } : si)),
      });
    },
    [patchParagraph],
  );

  const addFootnote = useCallback(
    (sectionId: string, paragraph: DeclarationParagraph) => {
      const footnote: DeclarationFootnote = { id: crypto.randomUUID(), text: '' };
      patchParagraph(sectionId, paragraph.id, { footnotes: [...paragraph.footnotes, footnote] });
    },
    [patchParagraph],
  );

  const removeFootnote = useCallback(
    (sectionId: string, paragraph: DeclarationParagraph, footnoteId: string) => {
      patchParagraph(sectionId, paragraph.id, {
        footnotes: paragraph.footnotes.filter((fn) => fn.id !== footnoteId),
      });
    },
    [patchParagraph],
  );

  const setFootnoteText = useCallback(
    (sectionId: string, paragraph: DeclarationParagraph, footnoteId: string, text: string) => {
      patchParagraph(sectionId, paragraph.id, {
        footnotes: paragraph.footnotes.map((fn) => (fn.id === footnoteId ? { ...fn, text } : fn)),
      });
    },
    [patchParagraph],
  );

  const toggleExhibitRef = useCallback(
    (sectionId: string, paragraph: DeclarationParagraph, exhibitId: string) => {
      const has = paragraph.exhibitIds.includes(exhibitId);
      patchParagraph(sectionId, paragraph.id, {
        exhibitIds: has
          ? paragraph.exhibitIds.filter((id) => id !== exhibitId)
          : [...paragraph.exhibitIds, exhibitId],
      });
    },
    [patchParagraph],
  );

  const removeExhibitRef = useCallback(
    (sectionId: string, paragraph: DeclarationParagraph, exhibitId: string) => {
      patchParagraph(sectionId, paragraph.id, {
        exhibitIds: paragraph.exhibitIds.filter((id) => id !== exhibitId),
      });
    },
    [patchParagraph],
  );

  const exhibitsById = useMemo(
    () => new Map(data.exhibits.map((ex) => [ex.id, ex])),
    [data.exhibits],
  );

  // All footnotes, in document order, for the endnote list.
  const allFootnotes = useMemo(() => {
    const out: { footnote: DeclarationFootnote; number: number }[] = [];
    for (const section of data.sections) {
      for (const paragraph of section.paragraphs) {
        for (const fn of paragraph.footnotes) {
          const number = numbering.footnoteNumbers.get(fn.id);
          if (number !== undefined) out.push({ footnote: fn, number });
        }
      }
    }
    return out.sort((a, b) => a.number - b.number);
  }, [data.sections, numbering]);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDeclarantOpen(true)}
          >
            <FaUserTie className="w-3 h-3" /> Select declarant
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setLibraryOpen(true)}
          >
            <FaBookOpen className="w-3 h-3" /> Insert from library
          </Button>
        </div>
      )}

      {/* Caption block */}
      <div className="rounded-lg border border-line-strong bg-surface-panel overflow-hidden">
        <button
          type="button"
          onClick={() => setCaptionOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-raised transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <FaFileSignature className="w-3.5 h-3.5 text-ink-muted" />
            Caption
          </span>
          {captionOpen ? (
            <FaChevronDown className="w-3 h-3 text-ink-muted" />
          ) : (
            <FaChevronRight className="w-3 h-3 text-ink-muted" />
          )}
        </button>
        {captionOpen && (
          <div className="px-4 pb-4 pt-1 space-y-3 border-t border-line">
            <Field label="Format">
              <Select
                value={formatId}
                disabled={readOnly || formats.length === 0}
                onChange={(e) => setFormatId(e.target.value as DeclarationFormatId)}
              >
                {formats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({f.jurisdiction})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Declarant name">
              <Input
                value={data.declarantName}
                disabled={readOnly}
                onChange={(e) => setDeclarantName(e.target.value)}
                placeholder="e.g. Jane Smith"
              />
            </Field>
            {needsDateOfBirth && (
              <Field label="Date of birth">
                <Input
                  value={data.declarantDateOfBirth ?? ''}
                  disabled={readOnly}
                  onChange={(e) => setDeclarantDateOfBirth(e.target.value)}
                  placeholder="e.g. January 1, 1980"
                />
              </Field>
            )}
            {needsAddress && (
              <Field label="Address">
                <Input
                  value={data.declarantAddress ?? ''}
                  disabled={readOnly}
                  onChange={(e) => setDeclarantAddress(e.target.value)}
                  placeholder="Street, city, state, ZIP"
                />
              </Field>
            )}
            <Field label="Attorney block">
              <AutoTextarea
                value={data.caption.attorneyBlock}
                disabled={readOnly}
                onChange={(v) => setCaption({ attorneyBlock: v })}
                placeholder="Attorney name, bar no., firm, address..."
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Court">
                <Input
                  value={data.caption.court}
                  disabled={readOnly}
                  onChange={(e) => setCaption({ court: e.target.value })}
                  placeholder="SUPERIOR COURT OF THE STATE OF CALIFORNIA"
                />
              </Field>
              <Field label="County">
                <Input
                  value={data.caption.county}
                  disabled={readOnly}
                  onChange={(e) => setCaption({ county: e.target.value })}
                  placeholder="COUNTY OF SAN FRANCISCO"
                />
              </Field>
              <Field label="Plaintiff">
                <Input
                  value={data.caption.plaintiff}
                  disabled={readOnly}
                  onChange={(e) => setCaption({ plaintiff: e.target.value })}
                />
              </Field>
              <Field label="Defendant">
                <Input
                  value={data.caption.defendant}
                  disabled={readOnly}
                  onChange={(e) => setCaption({ defendant: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Case number">
              <Input
                value={data.caption.caseNumber}
                disabled={readOnly}
                onChange={(e) => setCaption({ caseNumber: e.target.value })}
                placeholder="Case No. CGC-24-620900"
              />
            </Field>
            <Field label="Document title">
              <Input
                value={data.caption.documentTitle}
                disabled={readOnly}
                onChange={(e) => setCaption({ documentTitle: e.target.value })}
                placeholder="DECLARATION OF ... IN SUPPORT OF ..."
              />
            </Field>
            <Field label="Hearing info">
              <AutoTextarea
                value={data.caption.hearingInfo}
                disabled={readOnly}
                onChange={(v) => setCaption({ hearingInfo: v })}
                placeholder="Hearing date, department, action filed, trial date..."
              />
            </Field>
          </div>
        )}
      </div>

      {/* Exhibits panel */}
      <DeclarationExhibitsPanel data={data} readOnly={readOnly} onChange={emit} />

      {/* Sections */}
      <div className="space-y-4">
        {data.sections.map((section) => (
          <div key={section.id} className="rounded-lg border border-line-strong bg-surface-panel p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-ink-muted shrink-0 w-7">
                {numbering.sectionLetters.get(section.id)}
              </span>
              <Input
                value={section.heading}
                disabled={readOnly}
                onChange={(e) => setSectionHeading(section.id, e.target.value)}
                className="flex-1 min-w-0 font-semibold uppercase tracking-wide text-[13px]"
              />
              <Badge tone="neutral" className="shrink-0">
                {SECTION_KIND_LABEL[section.kind] ?? section.kind}
              </Badge>
              {!readOnly && (
                <IconButton
                  aria-label="Delete section"
                  onClick={() => removeSection(section.id)}
                  className="shrink-0 hover:text-redline"
                >
                  <FaTrash className="w-3.5 h-3.5" />
                </IconButton>
              )}
            </div>

            {/* Paragraphs */}
            <div className="space-y-4 pl-9">
              {section.paragraphs.map((paragraph) => (
                <div key={paragraph.id} className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="font-mono text-xs text-ink-faint mt-2 w-6 shrink-0">
                      {numbering.paragraphNumbers.get(paragraph.id)}.
                    </span>
                    <div className="flex-1 min-w-0 space-y-2">
                      <AutoTextarea
                        value={paragraph.text}
                        disabled={readOnly}
                        onChange={(v) => patchParagraph(section.id, paragraph.id, { text: v })}
                        placeholder="Paragraph text..."
                      />

                      {/* Sub-items */}
                      {paragraph.subItems.length > 0 && (
                        <div className="pl-4 space-y-1.5">
                          {paragraph.subItems.map((subItem, idx) => (
                            <div key={subItem.id} className="flex items-center gap-2">
                              <span className="font-mono text-xs text-ink-faint w-5 shrink-0">
                                {subItemLetter(idx)}
                              </span>
                              <Input
                                value={subItem.text}
                                disabled={readOnly}
                                onChange={(e) =>
                                  setSubItemText(section.id, paragraph, subItem.id, e.target.value)
                                }
                                className="flex-1 min-w-0"
                              />
                              {!readOnly && (
                                <IconButton
                                  aria-label="Remove sub-item"
                                  onClick={() => removeSubItem(section.id, paragraph, subItem.id)}
                                  className="shrink-0 hover:text-redline"
                                >
                                  <FaTrash className="w-3 h-3" />
                                </IconButton>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Exhibit ref chips */}
                      {paragraph.exhibitIds.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {paragraph.exhibitIds.map((exhibitId) => {
                            const exhibit = exhibitsById.get(exhibitId);
                            return (
                              <span
                                key={exhibitId}
                                className="inline-flex items-center gap-1 rounded-full bg-brand-soft text-brand px-2.5 py-0.5 text-[11px] font-medium"
                              >
                                See Exhibit {exhibit?.label ?? '?'}
                                {!readOnly && (
                                  <button
                                    type="button"
                                    aria-label="Remove exhibit reference"
                                    onClick={() => removeExhibitRef(section.id, paragraph, exhibitId)}
                                    className="hover:text-redline"
                                  >
                                    <FaTrash className="w-2.5 h-2.5" />
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Footnotes */}
                      {paragraph.footnotes.length > 0 && (
                        <div className="space-y-1.5">
                          {paragraph.footnotes.map((fn) => (
                            <div key={fn.id} className="flex items-center gap-2">
                              <sup className="font-mono text-[10px] text-ink-muted shrink-0">
                                {numbering.footnoteNumbers.get(fn.id)}
                              </sup>
                              <Input
                                value={fn.text}
                                disabled={readOnly}
                                onChange={(e) =>
                                  setFootnoteText(section.id, paragraph, fn.id, e.target.value)
                                }
                                placeholder="Footnote text..."
                                className="flex-1 min-w-0 text-xs"
                              />
                              {!readOnly && (
                                <IconButton
                                  aria-label="Remove footnote"
                                  onClick={() => removeFootnote(section.id, paragraph, fn.id)}
                                  className="shrink-0 hover:text-redline"
                                >
                                  <FaTrash className="w-3 h-3" />
                                </IconButton>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Paragraph-level controls */}
                      {!readOnly && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => addSubItem(section.id, paragraph)}
                            className="text-[11px] text-ink-muted hover:text-ink transition-colors"
                          >
                            + Sub-item
                          </button>
                          <span className="text-line-strong">|</span>
                          <button
                            type="button"
                            onClick={() => addFootnote(section.id, paragraph)}
                            className="text-[11px] text-ink-muted hover:text-ink transition-colors"
                          >
                            + Footnote
                          </button>
                          {data.exhibits.length > 0 && (
                            <>
                              <span className="text-line-strong">|</span>
                              <select
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) toggleExhibitRef(section.id, paragraph, e.target.value);
                                }}
                                className="text-[11px] text-ink-muted bg-transparent border-none outline-none hover:text-ink cursor-pointer"
                              >
                                <option value="" disabled>
                                  + Exhibit ref
                                </option>
                                {data.exhibits.map((ex) => (
                                  <option key={ex.id} value={ex.id}>
                                    {ex.label} — {ex.description || 'untitled'}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {!readOnly && (
                      <IconButton
                        aria-label="Delete paragraph"
                        onClick={() => removeParagraph(section.id, paragraph.id)}
                        className="shrink-0 hover:text-redline"
                      >
                        <FaTrash className="w-3.5 h-3.5" />
                      </IconButton>
                    )}
                  </div>
                </div>
              ))}

              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addParagraph(section.id)}
                  className="text-ink-muted"
                >
                  <FaPlus className="w-3 h-3" /> Add paragraph
                </Button>
              )}
            </div>
          </div>
        ))}

        {!readOnly && (
          <div className="rounded-lg border border-dashed border-line-strong p-3">
            {addingSection ? (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Input
                    autoFocus
                    value={newSectionHeading}
                    onChange={(e) => setNewSectionHeading(e.target.value)}
                    placeholder="Section heading, e.g. FINDINGS"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addSection();
                      if (e.key === 'Escape') setAddingSection(false);
                    }}
                  />
                  <Select
                    value={newSectionKind}
                    onChange={(e) => setNewSectionKind(e.target.value as DeclarationSectionKind)}
                    className="w-auto"
                  >
                    {SECTION_KIND_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setAddingSection(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={addSection} disabled={!newSectionHeading.trim()}>
                    Add section
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setAddingSection(true)} className="text-ink-muted">
                <FaPlus className="w-3 h-3" /> Add section
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Endnotes (read-only, computed) */}
      {allFootnotes.length > 0 && (
        <div className="rounded-lg border border-line-strong bg-surface-panel p-4">
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-ink-muted mb-2">Endnotes</h3>
          <ol className="space-y-1">
            {allFootnotes.map(({ footnote, number }) => (
              <li key={footnote.id} className="text-xs text-ink-muted flex gap-2">
                <span className="font-mono shrink-0">{number}.</span>
                <span>{footnote.text || <em className="text-ink-faint">empty</em>}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Execution block */}
      <div className="rounded-lg border border-line-strong bg-surface-panel p-4 space-y-3">
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-ink-muted">Execution</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Place">
            <Input
              value={data.execution.place}
              disabled={readOnly}
              onChange={(e) => setExecution({ place: e.target.value })}
              placeholder="San Francisco, California"
            />
          </Field>
          <Field label="Date">
            <Input
              value={data.execution.date}
              disabled={readOnly}
              onChange={(e) => setExecution({ date: e.target.value })}
              placeholder="e.g. January 15, 2026"
            />
          </Field>
        </div>
        <Field label="Signature name">
          <Input
            value={data.execution.signatureName}
            disabled={readOnly}
            onChange={(e) => setExecution({ signatureName: e.target.value })}
            placeholder="Name as it appears above the signature line"
          />
        </Field>
      </div>

      {/* Library picker */}
      {!readOnly && (
        <DeclarationLibraryPicker
          open={libraryOpen}
          data={data}
          onClose={() => setLibraryOpen(false)}
          onChange={emit}
        />
      )}

      {/* Declarant picker + auto-fill */}
      {!readOnly && (
        <DeclarantPicker
          open={declarantOpen}
          data={data}
          onClose={() => setDeclarantOpen(false)}
          onChange={emit}
        />
      )}
    </div>
  );
}
