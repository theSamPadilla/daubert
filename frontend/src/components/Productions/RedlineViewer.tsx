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
} from 'react-icons/fa6';
import { apiClient, type Production } from '@/lib/api-client';
import { Badge, Button, Field, IconButton, Input, Modal, Textarea } from '@/components/ui';
import { buildRedlineSegments, type Paragraph, type RedlineEdit, type RedlineEditStatus } from '@/utils/redlineSegments';
import type { components } from '@/generated/api-types';

type RedlineData = components['schemas']['RedlineData'];
type RedlineComment = components['schemas']['RedlineComment'];

type FilterKey = 'all' | RedlineEditStatus;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'proposed', label: 'Proposed' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
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
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [modifyEdit, setModifyEdit] = useState<RedlineEdit | null>(null);
  const [notesOpen, setNotesOpen] = useState((data.comments ?? []).length > 0);

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const edits = data.edits ?? [];
  const comments = data.comments ?? [];
  const counts = useMemo(() => countByStatus(edits), [edits]);

  const orderedEdits = useMemo(
    () => [...edits].sort((a, b) => a.anchor.start - b.anchor.start || a.anchor.end - b.anchor.end),
    [edits],
  );

  const filterSet: Set<RedlineEditStatus> | 'all' = useMemo(
    () => (filter === 'all' ? 'all' : new Set<RedlineEditStatus>([filter])),
    [filter],
  );

  const paragraphs: Paragraph[] = useMemo(
    () => buildRedlineSegments(data.baseText ?? '', edits, filterSet),
    [data.baseText, edits, filterSet],
  );

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
      {/* Header: counts, filter, reviewer notes */}
      <div className="shrink-0 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Badge tone={STATUS_TONE.proposed}>{counts.proposed} proposed</Badge>
            <Badge tone={STATUS_TONE.accepted}>{counts.accepted} accepted</Badge>
            <Badge tone={STATUS_TONE.rejected}>{counts.rejected} rejected</Badge>
          </div>
          <div className="flex items-center h-8 bg-surface border border-line rounded-md overflow-hidden text-xs font-medium">
            {FILTERS.map((f, i) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 h-full flex items-center transition-colors ${i > 0 ? 'border-l border-line' : ''} ${
                  filter === f.key
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-raised'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

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

        <ReviewerNotes
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

      {/* Two panes: marked-up document + card rail */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* Document pane */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-line bg-surface-panel p-6">
          {paragraphs.map((segments, pi) => (
            <p key={pi} className="mb-3 text-[15px] leading-relaxed text-ink whitespace-pre-wrap break-words">
              {segments.map((seg, si) => {
                if (seg.role === 'context') return <span key={si}>{seg.text}</span>;
                const decoration = seg.role === 'del' ? 'line-through' : 'underline';
                const statusCls =
                  seg.status === 'proposed'
                    ? 'border border-dashed border-redline rounded-sm px-0.5'
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
                    className={`text-redline cursor-pointer ${decoration} ${statusCls} ${selectedCls}`}
                  >
                    {seg.text}
                  </span>
                );
              })}
            </p>
          ))}
        </div>

        {/* Card rail */}
        <div className="w-[400px] shrink-0 min-h-0 overflow-y-auto flex flex-col gap-2.5 pr-0.5">
          {orderedEdits.length === 0 ? (
            <div className="text-sm text-ink-muted px-1 py-6 text-center">
              No proposed edits yet.
            </div>
          ) : (
            orderedEdits.map((edit) => (
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

      {modifyEdit && (
        <ModifyModal edit={modifyEdit} onClose={() => setModifyEdit(null)} onSave={saveModify} />
      )}
    </div>
  );
}

// ── Reviewer notes ───────────────────────────────────────────────────────────

interface ReviewerNotesProps {
  comments: RedlineComment[];
  open: boolean;
  editable: boolean;
  onToggle: () => void;
  onAdd: (title: string, text: string) => void;
  onUpdate: (commentId: string, title: string, text: string) => void;
  onRemove: (commentId: string) => void;
}

function ReviewerNotes({ comments, open, editable, onToggle, onAdd, onUpdate, onRemove }: ReviewerNotesProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-line bg-surface">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-ink-soft hover:text-ink transition-colors"
      >
        {open ? <FaChevronDown className="w-3 h-3" /> : <FaChevronRight className="w-3 h-3" />}
        Reviewer notes
        <span className="text-ink-faint">({comments.length})</span>
      </button>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {comments.length === 0 && !adding && (
            <p className="text-xs text-ink-muted">No reviewer notes.</p>
          )}

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
              <div key={c.id} className="rounded-md border border-line bg-surface-panel px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-ink">{c.title}</div>
                  {editable && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <IconButton aria-label="Edit note" className="h-7 w-7" onClick={() => setEditingId(c.id)}>
                        <FaPenToSquare className="w-3 h-3" />
                      </IconButton>
                      <IconButton aria-label="Remove note" className="h-7 w-7" onClick={() => onRemove(c.id)}>
                        <FaTrash className="w-3 h-3" />
                      </IconButton>
                    </div>
                  )}
                </div>
                <div className="text-sm text-ink-muted mt-0.5 whitespace-pre-wrap">{c.text}</div>
              </div>
            ),
          )}

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
                className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:text-brand-strong transition-colors"
              >
                <FaPlus className="w-3 h-3" /> Add note
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
