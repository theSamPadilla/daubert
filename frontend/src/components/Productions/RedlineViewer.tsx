'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FaCheck,
  FaXmark,
  FaPenToSquare,
  FaArrowRight,
  FaArrowRotateLeft,
  FaTriangleExclamation,
  FaPlus,
  FaTrash,
  FaChevronDown,
  FaChevronRight,
  FaChevronLeft,
  FaFlag,
} from 'react-icons/fa6';
import { apiClient, type Production } from '@/lib/api-client';
import { Badge, Button, Field, IconButton, Input, Modal, Textarea } from '@/components/ui';
import {
  buildRedlineSegments,
  applyAcceptedEdits,
  buildPlainParagraphs,
  type Paragraph,
  type RedlineEdit,
  type RedlineEditStatus,
  type RedlineView,
} from '@/utils/redlineSegments';
import type { components } from '@/generated/api-types';

type RedlineData = components['schemas']['RedlineData'];
type RedlineComment = components['schemas']['RedlineComment'];

type FilterKey = 'all' | RedlineEditStatus;

// Status chips that double as filters, shown in the Edits rail header. No "All"
// chip — clicking the active chip clears the filter back to showing everything.
const STATUS_FILTERS: { key: RedlineEditStatus; label: string }[] = [
  { key: 'proposed', label: 'proposed' },
  { key: 'accepted', label: 'accepted' },
  { key: 'rejected', label: 'rejected' },
];

const VIEWS: { key: RedlineView; label: string }[] = [
  { key: 'original', label: 'Original' },
  { key: 'markup', label: 'Markup' },
  { key: 'final', label: 'Final' },
];

const KIND_LABEL: Record<RedlineEdit['kind'], string> = {
  replace: 'Replace',
  delete: 'Delete',
  insert_after: 'Insert',
};

const KIND_TONE: Record<RedlineEdit['kind'], 'brand' | 'danger' | 'accent'> = {
  replace: 'brand',
  delete: 'danger',
  insert_after: 'accent',
};

const STATUS_TONE: Record<RedlineEditStatus, 'neutral' | 'brand' | 'danger'> = {
  proposed: 'neutral',
  accepted: 'brand',
  rejected: 'danger',
};

function countByStatus(edits: RedlineEdit[]): Record<RedlineEditStatus, number> {
  const counts: Record<RedlineEditStatus, number> = { proposed: 0, accepted: 0, rejected: 0 };
  for (const e of edits) counts[e.status] += 1;
  return counts;
}

interface RedlineViewerProps {
  production: Production;
  /** When provided, triage actions and note editing are enabled; read-only otherwise. */
  onUpdate?: (updated: Production) => void;
}

export function RedlineViewer({ production, onUpdate }: RedlineViewerProps) {
  const data = production.data as unknown as RedlineData;
  const editable = !!onUpdate;

  const [filter, setFilter] = useState<FilterKey>('all');
  const [view, setView] = useState<RedlineView>('markup');
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [modifyEdit, setModifyEdit] = useState<RedlineEdit | null>(null);
  const [notesOpen, setNotesOpen] = useState((data.comments ?? []).length > 0);
  const [railWidth, setRailWidth] = useState(400);
  const [railCollapsed, setRailCollapsed] = useState(false);

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Drag the divider to resize the edits rail. The rail is on the right, so
  // dragging left (decreasing clientX) widens it. Bounded [280, 760].
  const startRailResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = railWidth;
      const onMove = (ev: MouseEvent) => {
        const next = Math.min(760, Math.max(280, startWidth + (startX - ev.clientX)));
        setRailWidth(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.userSelect = 'none';
    },
    [railWidth],
  );

  const edits = data.edits ?? [];
  const comments = data.comments ?? [];
  const counts = useMemo(() => countByStatus(edits), [edits]);

  const orderedEdits = useMemo(
    () => [...edits].sort((a, b) => a.anchor.start - b.anchor.start || a.anchor.end - b.anchor.end),
    [edits],
  );

  // The status filter scopes the card rail (and, in markup view, the inline
  // marks) to one status. 'all' = no filter (default).
  const visibleEdits = useMemo(
    () => (filter === 'all' ? orderedEdits : orderedEdits.filter((e) => e.status === filter)),
    [orderedEdits, filter],
  );

  const filterSet: Set<RedlineEditStatus> | 'all' = useMemo(
    () => (filter === 'all' ? 'all' : new Set<RedlineEditStatus>([filter])),
    [filter],
  );

  const paragraphs: Paragraph[] = useMemo(() => {
    const baseText = data.baseText ?? '';
    if (view === 'original') return buildPlainParagraphs(baseText);
    if (view === 'final') return buildPlainParagraphs(applyAcceptedEdits(baseText, edits));
    return buildRedlineSegments(baseText, edits, filterSet);
  }, [view, data.baseText, edits, filterSet]);

  const applyOps = useCallback(
    async (ops: Record<string, unknown>[], failMessage: string) => {
      try {
        setLastError(null);
        const updated = await apiClient.updateProduction(production.id, { ops });
        onUpdate?.(updated);
      } catch (err) {
        console.error(failMessage, err);
        setLastError(failMessage);
      }
    },
    [production.id, onUpdate],
  );

  const setStatus = useCallback(
    (editId: string, status: RedlineEditStatus) =>
      applyOps(
        [{ op: 'redline_update_edit', editId, status }],
        'Failed to update the edit. Try again.',
      ),
    [applyOps],
  );

  const selectFromMark = useCallback((editId: string) => {
    setSelectedEditId(editId);
    cardRefs.current.get(editId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const saveModify = useCallback(
    (editId: string, kind: RedlineEdit['kind'], newText: string, comment: string) => {
      const op: Record<string, unknown> = { op: 'redline_update_edit', editId, comment };
      // `delete` edits must keep an empty newText; only patch it for the others.
      if (kind !== 'delete') op.newText = newText;
      setModifyEdit(null);
      return applyOps([op], 'Failed to modify the edit. Try again.');
    },
    [applyOps],
  );

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {/* Header: PDF notice, errors, open items. Status counts/filter now live
          in the Edits rail header (below), not at the top of the page. */}
      <div className="shrink-0 flex flex-col gap-3">
        {data.source?.kind === 'pdf' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs">
            <FaTriangleExclamation className="w-3.5 h-3.5 shrink-0" />
            Reconstructed view — layout is not the original document.
          </div>
        )}

        {lastError && (
          <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-redline text-xs">
            {lastError}
          </div>
        )}

        <OpenItems
          comments={comments}
          open={notesOpen}
          editable={editable}
          onToggle={() => setNotesOpen((v) => !v)}
          onAdd={(title, text) =>
            applyOps([{ op: 'redline_add_comment', title, text }], 'Failed to add the note. Try again.')
          }
          onUpdate={(commentId, title, text) =>
            applyOps(
              [{ op: 'redline_update_comment', commentId, title, text }],
              'Failed to update the note. Try again.',
            )
          }
          onRemove={(commentId) =>
            applyOps([{ op: 'redline_remove_comment', commentId }], 'Failed to remove the note. Try again.')
          }
        />
      </div>

      {/* Two panes: marked-up document + resizable/collapsible edits rail */}
      <div className="flex-1 min-h-0 flex">
        {/* Document pane */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-lg border border-line bg-surface-panel">
          {/* View toggle: Original / Markup / Final — governs how the document reads */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-line">
            <span className="text-[10px] uppercase tracking-wider text-ink-faint">View</span>
            <div className="flex items-center h-7 bg-surface border border-line rounded-md overflow-hidden text-xs font-medium">
              {VIEWS.map((v, i) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`px-2.5 h-full flex items-center transition-colors ${i > 0 ? 'border-l border-line' : ''} ${
                    view === v.key
                      ? 'bg-brand/10 text-brand'
                      : 'text-ink-muted hover:text-ink hover:bg-surface-raised'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[11px] text-ink-faint truncate">
              {view === 'markup' && (
                <span className="inline-flex items-center gap-2">
                  <span className="text-redline line-through">deletion</span>
                  <span className="text-brand underline">insertion</span>
                </span>
              )}
              {view === 'final' &&
                `Reads as it will export — ${counts.accepted} accepted edit${counts.accepted === 1 ? '' : 's'} applied`}
              {view === 'original' && 'The untouched draft'}
            </span>
          </div>

          {/* Scrollable document body — scrollbar hidden, overflow implies scroll */}
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-6">
            {paragraphs.map((segments, pi) => (
              <p key={pi} className="mb-3 text-[15px] leading-relaxed text-ink whitespace-pre-wrap break-words">
                {segments.map((seg, si) => {
                  if (seg.role === 'context') return <span key={si}>{seg.text}</span>;
                  const isDel = seg.role === 'del';
                  const roleCls = isDel ? 'text-redline line-through' : 'text-brand underline';
                  const proposedBorder = isDel ? 'border-redline' : 'border-brand';
                  const statusCls =
                    seg.status === 'proposed'
                      ? `border border-dashed ${proposedBorder} rounded-sm px-0.5`
                      : seg.status === 'rejected'
                        ? 'opacity-50'
                        : '';
                  const selectedCls =
                    seg.editId === selectedEditId ? 'ring-2 ring-brand/40 rounded-sm bg-brand/5' : '';
                  return (
                    <span
                      key={si}
                      data-edit-id={seg.editId}
                      onClick={() => seg.editId && selectFromMark(seg.editId)}
                      className={`cursor-pointer ${roleCls} ${statusCls} ${selectedCls}`}
                    >
                      {seg.text}
                    </span>
                  );
                })}
              </p>
            ))}
          </div>
        </div>

        {railCollapsed ? (
          /* Collapsed: a slim strip to bring the edits rail back. */
          <button
            onClick={() => setRailCollapsed(false)}
            title="Show edits"
            className="ml-3 shrink-0 w-8 rounded-lg border border-line bg-surface-raised flex flex-col items-center justify-center gap-2 text-ink-muted hover:text-ink hover:border-line-strong transition-colors"
          >
            <FaChevronLeft className="w-3 h-3" />
            <span className="text-[10px] font-medium tracking-wide [writing-mode:vertical-rl] rotate-180">
              Edits ({orderedEdits.length})
            </span>
          </button>
        ) : (
          <>
            {/* Drag handle — resize the edits rail. */}
            <div
              onMouseDown={startRailResize}
              title="Drag to resize"
              className="group mx-1.5 shrink-0 w-1.5 cursor-col-resize flex items-center justify-center"
            >
              <div className="h-10 w-1 rounded-full bg-line-strong group-hover:bg-brand transition-colors" />
            </div>

            {/* Edits rail */}
            <div
              style={{ width: railWidth }}
              className="shrink-0 min-h-0 flex flex-col rounded-lg border border-line bg-surface-raised"
            >
              <div className="shrink-0 border-b border-line">
                <div className="flex items-center justify-between px-3 pt-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-ink-faint">
                    Edits ({orderedEdits.length})
                  </span>
                  <IconButton aria-label="Collapse edits" className="h-6 w-6" onClick={() => setRailCollapsed(true)}>
                    <FaChevronRight className="w-3 h-3" />
                  </IconButton>
                </div>
                {/* Status counts that double as filters. Click to filter the
                    rail (and markup) to that status; click the active one to clear. */}
                <div className="flex items-center flex-wrap gap-1.5 px-3 pb-2 pt-1.5">
                  {STATUS_FILTERS.map((s) => {
                    const active = filter === s.key;
                    const dimmed = filter !== 'all' && !active;
                    const tone =
                      s.key === 'accepted'
                        ? 'text-brand bg-brand/10'
                        : s.key === 'rejected'
                          ? 'text-redline bg-redline/10'
                          : 'text-ink-muted bg-surface-panel';
                    return (
                      <button
                        key={s.key}
                        onClick={() => setFilter(active ? 'all' : s.key)}
                        title={active ? 'Show all edits' : `Show only ${s.label} edits`}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium transition-all ${tone} ${
                          active ? 'ring-1 ring-current' : ''
                        } ${dimmed ? 'opacity-40 hover:opacity-80' : 'hover:brightness-95'}`}
                      >
                        {counts[s.key]} {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scrollable card list — scrollbar hidden, overflow implies scroll */}
              <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-2.5 p-2.5">
                {orderedEdits.length === 0 ? (
                  <div className="text-sm text-ink-muted px-1 py-6 text-center">
                    No proposed edits yet.
                  </div>
                ) : visibleEdits.length === 0 ? (
                  <div className="text-sm text-ink-muted px-1 py-6 text-center">
                    No {filter} edits.
                  </div>
                ) : (
                  visibleEdits.map((edit) => (
                    <RedlineCard
                      key={edit.id}
                      edit={edit}
                      selected={edit.id === selectedEditId}
                      editable={editable}
                      registerRef={(el) => {
                        if (el) cardRefs.current.set(edit.id, el);
                        else cardRefs.current.delete(edit.id);
                      }}
                      onSelect={() => setSelectedEditId(edit.id)}
                      onAccept={() => setStatus(edit.id, 'accepted')}
                      onReject={() => setStatus(edit.id, 'rejected')}
                      onUndo={() => setStatus(edit.id, 'proposed')}
                      onModify={() => setModifyEdit(edit)}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {modifyEdit && (
        <ModifyModal edit={modifyEdit} onClose={() => setModifyEdit(null)} onSave={saveModify} />
      )}
    </div>
  );
}

// ── Open items ───────────────────────────────────────────────────────────────
// Document-level cover notes (RedlineComment): risk flags, open questions, and
// attorney action items the agent could NOT auto-fix. They are deliberately not
// tied to a text span — see the redlining skill, step 5. Framed distinctly from
// the proposed edits so their purpose ("resolve before filing") is legible, and
// height-bounded so a long list can't starve the document pane below.

interface OpenItemsProps {
  comments: RedlineComment[];
  open: boolean;
  editable: boolean;
  onToggle: () => void;
  onAdd: (title: string, text: string) => void;
  onUpdate: (commentId: string, title: string, text: string) => void;
  onRemove: (commentId: string) => void;
}

function OpenItems({ comments, open, editable, onToggle, onAdd, onUpdate, onRemove }: OpenItemsProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Nothing to show and nothing to add → don't render the panel at all.
  if (comments.length === 0 && !editable) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/40">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-amber-800 hover:text-amber-900 transition-colors"
      >
        {open ? <FaChevronDown className="w-3 h-3" /> : <FaChevronRight className="w-3 h-3" />}
        <FaFlag className="w-3 h-3 text-amber-600" />
        Open items for attorney
        <span className="font-normal text-amber-700/70">({comments.length})</span>
      </button>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <p className="text-[11px] text-amber-700/90 -mt-1">
            Not proposed edits — risk flags and open questions to resolve before filing.
          </p>

          {comments.length === 0 && !adding && (
            <p className="text-xs text-ink-muted">No open items.</p>
          )}

          {/* Bounded so a long list scrolls internally instead of crowding the document. */}
          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-0.5">
            {comments.map((c) =>
              editingId === c.id ? (
                <NoteForm
                  key={c.id}
                  initialTitle={c.title}
                  initialText={c.text}
                  onCancel={() => setEditingId(null)}
                  onSave={(title, text) => {
                    onUpdate(c.id, title, text);
                    setEditingId(null);
                  }}
                />
              ) : (
                <div key={c.id} className="rounded-md border border-amber-200 bg-surface px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-1.5 min-w-0">
                      <FaTriangleExclamation className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
                      <div className="text-sm font-medium text-ink">{c.title}</div>
                    </div>
                    {editable && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <IconButton aria-label="Edit open item" className="h-7 w-7" onClick={() => setEditingId(c.id)}>
                          <FaPenToSquare className="w-3 h-3" />
                        </IconButton>
                        <IconButton aria-label="Remove open item" className="h-7 w-7" onClick={() => onRemove(c.id)}>
                          <FaTrash className="w-3 h-3" />
                        </IconButton>
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-ink-muted mt-0.5 pl-[18px] whitespace-pre-wrap">{c.text}</div>
                </div>
              ),
            )}
          </div>

          {editable &&
            (adding ? (
              <NoteForm
                onCancel={() => setAdding(false)}
                onSave={(title, text) => {
                  onAdd(title, text);
                  setAdding(false);
                }}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
              >
                <FaPlus className="w-3 h-3" /> Add item
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

interface NoteFormProps {
  initialTitle?: string;
  initialText?: string;
  onCancel: () => void;
  onSave: (title: string, text: string) => void;
}

function NoteForm({ initialTitle = '', initialText = '', onCancel, onSave }: NoteFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const canSave = title.trim().length > 0 && text.trim().length > 0;

  return (
    <div className="rounded-md border border-line bg-surface-panel px-3 py-2.5 flex flex-col gap-2">
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title" />
      </Field>
      <Field label="Note">
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reviewer note" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!canSave} onClick={() => onSave(title.trim(), text.trim())}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ── Edit card ────────────────────────────────────────────────────────────────

interface RedlineCardProps {
  edit: RedlineEdit;
  selected: boolean;
  editable: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
  onModify: () => void;
}

function RedlineCard({
  edit,
  selected,
  editable,
  registerRef,
  onSelect,
  onAccept,
  onReject,
  onUndo,
  onModify,
}: RedlineCardProps) {
  const stop = (handler: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    handler();
  };

  return (
    <div
      ref={registerRef}
      onClick={onSelect}
      className={`rounded-lg border p-3 bg-surface transition-shadow cursor-pointer ${
        selected ? 'border-brand ring-2 ring-brand/40' : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Badge tone={KIND_TONE[edit.kind]}>{KIND_LABEL[edit.kind]}</Badge>
          <Badge tone={STATUS_TONE[edit.status]}>{edit.status}</Badge>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-ink-faint">{edit.origin}</span>
      </div>

      <div className="text-xs font-mono text-ink-muted truncate" title={edit.anchor.text}>
        {edit.anchor.text}
      </div>

      {edit.kind !== 'delete' && (
        <div className="flex items-start gap-1.5 mt-1.5">
          <FaArrowRight className="w-3 h-3 mt-0.5 shrink-0 text-ink-faint" />
          <span className="text-xs font-mono text-redline whitespace-pre-wrap break-words">{edit.newText}</span>
        </div>
      )}

      <div className="mt-2.5 rounded bg-surface-raised px-2.5 py-2">
        <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-0.5">Basis</div>
        <div className="text-xs font-mono text-ink-soft whitespace-pre-wrap break-words">{edit.basis}</div>
      </div>

      {edit.comment && (
        <div className="mt-2 text-xs text-ink-muted">
          <span className="font-medium text-ink-soft">Note: </span>
          {edit.comment}
        </div>
      )}

      {editable && (
        <div className="flex items-center gap-1.5 mt-3">
          {edit.status === 'proposed' ? (
            <>
              <Button variant="primary" size="sm" onClick={stop(onAccept)}>
                <FaCheck className="w-3 h-3" /> Accept
              </Button>
              <Button variant="ghost" size="sm" onClick={stop(onReject)}>
                <FaXmark className="w-3 h-3" /> Reject
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={stop(onUndo)}>
              <FaArrowRotateLeft className="w-3 h-3" /> Undo
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={stop(onModify)}>
            <FaPenToSquare className="w-3 h-3" /> Modify
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Modify modal ─────────────────────────────────────────────────────────────

interface ModifyModalProps {
  edit: RedlineEdit;
  onClose: () => void;
  onSave: (editId: string, kind: RedlineEdit['kind'], newText: string, comment: string) => void;
}

function ModifyModal({ edit, onClose, onSave }: ModifyModalProps) {
  const [newText, setNewText] = useState(edit.newText);
  const [comment, setComment] = useState(edit.comment ?? '');

  return (
    <Modal
      open
      title="Modify edit"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={() => onSave(edit.id, edit.kind, newText, comment)}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-md bg-surface-raised px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-0.5">Anchored text</div>
          <div className="text-xs font-mono text-ink-soft whitespace-pre-wrap break-words">{edit.anchor.text}</div>
        </div>
        {edit.kind !== 'delete' && (
          <Field label="Replacement text">
            <Textarea rows={4} value={newText} onChange={(e) => setNewText(e.target.value)} />
          </Field>
        )}
        <Field label="Drafting note (optional)">
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
