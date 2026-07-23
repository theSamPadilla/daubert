'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaPlus,
  FaTrash,
  FaChevronUp,
  FaChevronDown,
  FaUserTie,
  FaKeyboard,
  FaRegFilePdf,
  FaFileContract,
  FaFileArrowUp,
  FaDownload,
  FaSpinner,
  FaTriangleExclamation,
  FaPaperclip,
} from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { Panel } from '@/components/ui/Panel';
import { Kicker } from '@/components/ui/Kicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';

type Declarant = components['schemas']['Declarant'];
type CreateDeclarantRequest = components['schemas']['CreateDeclarantRequest'];
type UpdateDeclarantRequest = components['schemas']['UpdateDeclarantRequest'];
type DeclarationParagraph = components['schemas']['DeclarationParagraph'];
type DeclarantExtractionDraft = components['schemas']['DeclarantExtractionDraft'];
type DeclarantFile = components['schemas']['DeclarantFile'];
type OrganizationMember = components['schemas']['OrganizationMember'];

type DeclarantSource = 'cv' | 'prior_declaration';

function newParagraph(): DeclarationParagraph {
  return { id: crypto.randomUUID(), text: '', subItems: [], exhibitIds: [], footnotes: [] };
}

// Coerce a stored qualifications paragraph into a well-formed editable paragraph,
// so opening the editor can never crash on an undefined `text`.
function toEditableParagraph(p: unknown): DeclarationParagraph {
  const o = p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  return {
    id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
    text: typeof o.text === 'string' ? o.text : '',
    subItems: Array.isArray(o.subItems) ? (o.subItems as DeclarationParagraph['subItems']) : [],
    exhibitIds: Array.isArray(o.exhibitIds) ? (o.exhibitIds as string[]) : [],
    footnotes: Array.isArray(o.footnotes) ? (o.footnotes as DeclarationParagraph['footnotes']) : [],
  };
}

// Human-readable byte size (mirrors data-room/page.tsx).
function formatBytes(raw: string | undefined): string {
  if (!raw) return '—';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Create/edit modal
// ---------------------------------------------------------------------------

type DeclarantDto = {
  displayName: string;
  title?: string;
  firm?: string;
  cvExhibit?: string;
  hourlyRate?: string;
  nonContingencyDisclosure?: string;
  dateOfBirth?: string;
  address?: string;
  priorTestimony: string[];
  qualifications: DeclarationParagraph[];
  userId?: string;
};

// The three create entry points. `manual` jumps straight to a blank review form;
// the two `pull` paths route through the upload step first.
type CreateChoice = 'manual' | 'cv' | 'prior_declaration';

// Create flow is a small state machine: pick how to start → (optionally) upload a
// PDF and extract → review/edit the (pre-filled) form. Edit flow skips it entirely.
type Step = 'chooser' | 'upload' | 'review';

function DeclarantModal({
  declarant,
  orgSlug,
  isAdmin,
  currentUserId,
  onClose,
  onSave,
}: {
  declarant: Declarant | null;
  orgSlug: string;
  isAdmin: boolean;
  currentUserId: string;
  onClose: () => void;
  // Returns the created declarant on create (so the modal can attach the source
  // file afterwards), or null on edit.
  onSave: (dto: DeclarantDto) => Promise<Declarant | null>;
}) {
  const isEdit = declarant !== null;

  // Form fields
  const [displayName, setDisplayName] = useState(declarant?.displayName ?? '');
  const [title, setTitle] = useState(declarant?.title ?? '');
  const [firm, setFirm] = useState(declarant?.firm ?? '');
  const [cvExhibit, setCvExhibit] = useState(declarant?.cvExhibit ?? '');
  const [hourlyRate, setHourlyRate] = useState(declarant?.hourlyRate ?? '');
  const [nonContingencyDisclosure, setNonContingencyDisclosure] = useState(
    declarant?.nonContingencyDisclosure ?? '',
  );
  const [dateOfBirth, setDateOfBirth] = useState(declarant?.dateOfBirth ?? '');
  const [address, setAddress] = useState(declarant?.address ?? '');
  const [priorTestimony, setPriorTestimony] = useState<string[]>(
    Array.isArray(declarant?.priorTestimony) ? declarant!.priorTestimony : [],
  );
  const [qualifications, setQualifications] = useState<DeclarationParagraph[]>(() => {
    const stored = Array.isArray(declarant?.qualifications) ? declarant!.qualifications : [];
    return stored.length ? stored.map(toEditableParagraph) : [newParagraph()];
  });

  // Linking (create only)
  const [linkToMe, setLinkToMe] = useState(false);
  const [linkedUserId, setLinkedUserId] = useState<string>('');
  const [members, setMembers] = useState<OrganizationMember[]>([]);

  // Create-flow step machine + upload state
  const [step, setStep] = useState<Step>(isEdit ? 'review' : 'chooser');
  const [source, setSource] = useState<DeclarantSource | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fromExtraction, setFromExtraction] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const extractInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachWarning, setAttachWarning] = useState<string | null>(null);

  const canSave = displayName.trim().length > 0 && !saving;

  // Admins can link an arbitrary member; load the roster lazily on the chooser step.
  useEffect(() => {
    if (isEdit || !isAdmin) return;
    let cancelled = false;
    apiClient
      .listOrgMembers(orgSlug)
      .then((data) => {
        if (!cancelled) setMembers(data);
      })
      .catch(() => {
        // Non-fatal: the picker just won't populate. Self-link checkbox still works.
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, isAdmin, orgSlug]);

  // Fill-only: apply a draft field only when it has content and the form field is
  // still empty — never clobber a value the user has already typed.
  const applyDraft = (draft: DeclarantExtractionDraft) => {
    const fill = (
      value: string | undefined,
      current: string,
      set: (v: string) => void,
    ) => {
      if (value && value.trim() && !current.trim()) set(value);
    };
    fill(draft.displayName, displayName, setDisplayName);
    fill(draft.title, title, setTitle);
    fill(draft.firm, firm, setFirm);
    fill(draft.hourlyRate, hourlyRate, setHourlyRate);
    fill(draft.nonContingencyDisclosure, nonContingencyDisclosure, setNonContingencyDisclosure);
    fill(draft.dateOfBirth, dateOfBirth, setDateOfBirth);
    fill(draft.address, address, setAddress);
    fill(draft.cvExhibit, cvExhibit, setCvExhibit);

    if (Array.isArray(draft.priorTestimony) && draft.priorTestimony.length) {
      setPriorTestimony((prev) =>
        prev.length ? prev : draft.priorTestimony!.filter((t) => typeof t === 'string'),
      );
    }
    if (Array.isArray(draft.qualifications) && draft.qualifications.length) {
      setQualifications((prev) => {
        // Only overwrite the initial single-blank paragraph.
        const isBlankInitial = prev.length === 1 && !(prev[0].text ?? '').trim();
        return isBlankInitial ? draft.qualifications!.map(toEditableParagraph) : prev;
      });
    }
  };

  const chooseCreatePath = (choice: CreateChoice) => {
    setUploadError(null);
    if (choice === 'manual') {
      setSource(null);
      setFromExtraction(false);
      setPendingFile(null);
      setStep('review');
      return;
    }
    setSource(choice);
    setStep('upload');
  };

  const handleExtractClick = () => {
    extractInputRef.current?.click();
  };

  const handleExtractFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so re-selecting the same file fires change again.
    if (e.target) e.target.value = '';
    if (!file || !source) return;

    setUploadError(null);
    setExtracting(true);
    try {
      const draft = await apiClient.extractDeclarant(orgSlug, file, source);
      setPendingFile(file);
      setFromExtraction(true);
      applyDraft(draft);
      setStep('review');
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to extract from file');
    } finally {
      setExtracting(false);
    }
  };

  const updateParagraph = (id: string, text: string) => {
    setQualifications((prev) => prev.map((p) => (p.id === id ? { ...p, text } : p)));
  };

  const addParagraph = () => {
    setQualifications((prev) => [...prev, newParagraph()]);
  };

  const removeParagraph = (id: string) => {
    setQualifications((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  };

  const moveParagraph = (index: number, direction: -1 | 1) => {
    setQualifications((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const updatePriorTestimony = (index: number, value: string) => {
    setPriorTestimony((prev) => prev.map((t, i) => (i === index ? value : t)));
  };

  const addPriorTestimony = () => {
    setPriorTestimony((prev) => [...prev, '']);
  };

  const removePriorTestimony = (index: number) => {
    setPriorTestimony((prev) => prev.filter((_, i) => i !== index));
  };

  // The self-checkbox and the admin picker are two views onto the same userId.
  // Checking "this is my profile" resolves the picker to the current user (and
  // unchecking clears it); picking yourself in the picker checks the box, while
  // picking anyone else (or clearing) unchecks it — so the two controls always
  // agree on who the declarant is linked to.
  const toggleLinkToMe = (checked: boolean) => {
    setLinkToMe(checked);
    setLinkedUserId(checked ? currentUserId : '');
  };

  const pickMember = (userId: string) => {
    setLinkedUserId(userId);
    setLinkToMe(userId !== '' && userId === currentUserId);
  };

  const resolvedUserId = (): string | undefined => {
    if (isEdit) return undefined;
    // Picker takes precedence when set, else the self-checkbox.
    if (linkedUserId) return linkedUserId;
    if (linkToMe) return currentUserId;
    return undefined;
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setAttachWarning(null);
    try {
      const created = await onSave({
        displayName: displayName.trim(),
        title: title.trim() || undefined,
        firm: firm.trim() || undefined,
        cvExhibit: cvExhibit.trim() || undefined,
        hourlyRate: hourlyRate.trim() || undefined,
        nonContingencyDisclosure: nonContingencyDisclosure.trim() || undefined,
        dateOfBirth: dateOfBirth.trim() || undefined,
        address: address.trim() || undefined,
        priorTestimony: priorTestimony.map((t) => t.trim()).filter((t) => t.length > 0),
        qualifications: qualifications.filter((p) => (p.text ?? '').trim().length > 0),
        userId: resolvedUserId(),
      });

      // Attach-after-create: if this create came from a PDF upload, attach that
      // source file to the newly created declarant. A failure here must NOT roll
      // back the declarant — surface a non-blocking warning and still close.
      if (created && pendingFile && source) {
        try {
          await apiClient.uploadDeclarantFile(orgSlug, created.id, pendingFile, source);
        } catch {
          setAttachWarning(
            'Profile saved; attaching the source file failed — you can retry from the edit modal.',
          );
          setSaving(false);
          return;
        }
      }

      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save declarant');
      setSaving(false);
    }
  };

  const modalTitle = isEdit
    ? 'Edit declarant'
    : step === 'chooser'
      ? 'New declarant'
      : step === 'upload'
        ? source === 'cv'
          ? 'Pull from CV'
          : 'Pull from previous declaration'
        : 'Review declarant';

  // -------------------------------------------------------------------------
  // Chooser step (create only)
  // -------------------------------------------------------------------------
  if (!isEdit && step === 'chooser') {
    const cards: { choice: CreateChoice; Icon: typeof FaKeyboard; label: string; hint: string }[] = [
      { choice: 'manual', Icon: FaKeyboard, label: 'Insert manually', hint: 'Type the profile in yourself' },
      { choice: 'cv', Icon: FaRegFilePdf, label: 'Pull from CV', hint: 'Extract fields from a CV PDF' },
      {
        choice: 'prior_declaration',
        Icon: FaFileContract,
        label: 'Pull from previous declaration',
        hint: 'Extract fields from a prior declaration',
      },
    ];
    return (
      <Modal open title={modalTitle} onClose={onClose} maxWidth="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {cards.map(({ choice, Icon, label, hint }) => (
              <button
                key={choice}
                type="button"
                onClick={() => chooseCreatePath(choice)}
                className="flex flex-col items-center text-center gap-2 rounded-lg border border-line hover:border-brand/50 hover:bg-brand-soft/40 transition-colors px-3 py-5"
              >
                <Icon className="w-6 h-6 text-brand" />
                <span className="text-sm font-medium text-ink">{label}</span>
                <span className="text-xs text-ink-muted">{hint}</span>
              </button>
            ))}
          </div>

          <div className="border-t border-line pt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                checked={linkToMe}
                onChange={(e) => toggleLinkToMe(e.target.checked)}
                className="accent-brand"
              />
              This is my profile (link it to my account)
            </label>

            {isAdmin && (
              <div>
                <label className="block text-xs text-ink-muted mb-1">
                  Link to a member (optional)
                </label>
                <Select value={linkedUserId} onChange={(e) => pickMember(e.target.value)}>
                  <option value="">— Not linked —</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user?.name || m.user?.email || m.userId}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  // -------------------------------------------------------------------------
  // Upload step (pull paths only)
  // -------------------------------------------------------------------------
  if (!isEdit && step === 'upload') {
    return (
      <Modal
        open
        title={modalTitle}
        onClose={extracting ? () => {} : onClose}
        maxWidth="max-w-lg"
        footer={
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setStep('chooser')}
              disabled={extracting}
            >
              Back
            </Button>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={extracting}>
              Cancel
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <input
            ref={extractInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleExtractFile}
            className="hidden"
          />

          {uploadError && (
            <div className="px-3 py-2 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
              {uploadError}
            </div>
          )}

          <div className="flex flex-col items-center text-center gap-3 rounded-lg border border-dashed border-line px-4 py-8">
            <FaFileArrowUp className="w-7 h-7 text-ink-faint" />
            <p className="text-sm text-ink-muted">
              Upload a PDF{' '}
              {source === 'cv' ? 'CV' : 'prior declaration'} and we&apos;ll extract the
              declarant&apos;s details for you to review.
            </p>
            {extracting ? (
              <div className="inline-flex items-center gap-2 text-sm text-ink-muted">
                <FaSpinner className="w-4 h-4 animate-spin" />
                Extracting…
              </div>
            ) : uploadError ? (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleExtractClick}>
                  Try again
                </Button>
                <Button variant="secondary" size="sm" onClick={() => chooseCreatePath('manual')}>
                  Switch to manual
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={handleExtractClick}>
                Choose PDF
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  // -------------------------------------------------------------------------
  // Review step (create) / full form (edit)
  // -------------------------------------------------------------------------
  return (
    <Modal
      open
      title={modalTitle}
      onClose={saving ? () => {} : onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {fromExtraction && (
          <p className="text-xs text-ink-muted">
            Extracted from your upload — review before saving.
          </p>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
            {error}
          </div>
        )}

        {attachWarning && (
          <div className="px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm text-amber-600 flex items-start gap-2">
            <FaTriangleExclamation className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{attachWarning}</span>
          </div>
        )}

        <div>
          <label className="block text-xs text-ink-muted mb-1">Display name</label>
          <Input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Dr. Jane Smith"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-muted mb-1">Title (optional)</label>
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Forensic Accountant"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Firm (optional)</label>
            <Input
              type="text"
              value={firm}
              onChange={(e) => setFirm(e.target.value)}
              placeholder="Smith Forensics LLC"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-ink-muted mb-1">CV exhibit (optional)</label>
          <Input
            type="text"
            value={cvExhibit}
            onChange={(e) => setCvExhibit(e.target.value)}
            placeholder="Description or URL for the CV exhibit"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-muted mb-1">Hourly rate (optional)</label>
            <Input
              type="text"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="$500/hour"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Date of birth (optional)</label>
            <Input
              type="text"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              placeholder="January 1, 1980"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-ink-muted mb-1">Address (optional)</label>
          <Input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street, city, state, ZIP"
          />
        </div>

        <div>
          <label className="block text-xs text-ink-muted mb-1">
            Non-contingency disclosure (optional)
          </label>
          <Textarea
            value={nonContingencyDisclosure}
            onChange={(e) => setNonContingencyDisclosure(e.target.value)}
            rows={2}
            placeholder="My compensation is not contingent on the outcome of this matter."
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-ink-muted">Prior testimony (optional)</label>
            <button
              type="button"
              onClick={addPriorTestimony}
              className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
            >
              <FaPlus size={10} />
              Add entry
            </button>
          </div>
          {priorTestimony.length === 0 ? (
            <p className="text-xs text-ink-faint">No prior testimony listed.</p>
          ) : (
            <div className="space-y-2">
              {priorTestimony.map((entry, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={entry}
                    onChange={(e) => updatePriorTestimony(i, e.target.value)}
                    placeholder="Case name, court, year"
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => removePriorTestimony(i)}
                    className="p-1 text-ink-faint hover:text-redline transition-colors"
                    title="Remove entry"
                  >
                    <FaTrash size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-ink-muted">Qualifications</label>
            <button
              type="button"
              onClick={addParagraph}
              className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
            >
              <FaPlus size={10} />
              Add paragraph
            </button>
          </div>
          <p className="text-xs text-ink-faint mb-2">
            Ordered qualifications paragraphs. These are appended to a declaration&apos;s
            qualifications section when this declarant is selected.
          </p>
          <div className="space-y-2">
            {qualifications.map((p, i) => (
              <div key={p.id} className="flex items-start gap-2">
                <Textarea
                  value={p.text ?? ''}
                  onChange={(e) => updateParagraph(p.id, e.target.value)}
                  rows={3}
                  placeholder={`Paragraph ${i + 1}`}
                  className="flex-1"
                />
                <div className="flex flex-col gap-1 pt-0.5">
                  <button
                    type="button"
                    onClick={() => moveParagraph(i, -1)}
                    disabled={i === 0}
                    className="p-1 text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    title="Move up"
                  >
                    <FaChevronUp size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveParagraph(i, 1)}
                    disabled={i === qualifications.length - 1}
                    className="p-1 text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    title="Move down"
                  >
                    <FaChevronDown size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeParagraph(p.id)}
                    disabled={qualifications.length <= 1}
                    className="p-1 text-ink-faint hover:text-redline transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    title="Remove paragraph"
                  >
                    <FaTrash size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {isEdit && <AttachmentsBlock orgSlug={orgSlug} declarant={declarant!} canDelete={isAdmin || declarant!.userId === currentUserId} />}

        {!isEdit && (
          <div className="border-t border-line pt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                checked={linkToMe}
                onChange={(e) => toggleLinkToMe(e.target.checked)}
                className="accent-brand"
              />
              This is my profile (link it to my account)
            </label>

            {isAdmin && (
              <div>
                <label className="block text-xs text-ink-muted mb-1">
                  Link to a member (optional)
                </label>
                <Select value={linkedUserId} onChange={(e) => pickMember(e.target.value)}>
                  <option value="">— Not linked —</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user?.name || m.user?.email || m.userId}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Attachments block (edit modal only)
// ---------------------------------------------------------------------------

function AttachmentsBlock({
  orgSlug,
  declarant,
  canDelete,
}: {
  orgSlug: string;
  declarant: Declarant;
  canDelete: boolean;
}) {
  const [files, setFiles] = useState<DeclarantFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadKind, setUploadKind] = useState<DeclarantSource>('cv');
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.listDeclarantFiles(orgSlug, declarant.id);
      setFiles(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load attachments');
    } finally {
      setLoading(false);
    }
  }, [orgSlug, declarant.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownload = async (file: DeclarantFile) => {
    try {
      await apiClient.downloadDeclarantFile(orgSlug, declarant.id, file.id, file.name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const handleDelete = async (file: DeclarantFile) => {
    setBusyId(file.id);
    try {
      await apiClient.deleteDeclarantFile(orgSlug, declarant.id, file.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleAttachClick = () => {
    uploadInputRef.current?.click();
  };

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so re-selecting the same file fires change again.
    if (e.target) e.target.value = '';
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      await apiClient.uploadDeclarantFile(orgSlug, declarant.id, file, uploadKind);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to attach file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="block text-xs text-ink-muted mb-1">Attachments</label>
      {error && (
        <div className="px-3 py-2 mb-2 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
          {error}
        </div>
      )}
      {loading ? (
        <Loader inline />
      ) : files.length === 0 ? (
        <p className="text-xs text-ink-faint mb-2">No source files attached.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line mb-2">
          <table className="w-full">
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="border-t border-line first:border-t-0">
                  <td className="px-3 py-2">
                    <p className="text-sm text-ink truncate">{file.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge tone="neutral">
                        {file.kind === 'cv' ? 'CV' : 'Prior declaration'}
                      </Badge>
                      <span className="text-xs text-ink-faint">{formatBytes(file.size)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleDownload(file)}
                      className="p-1.5 text-ink-faint hover:text-ink transition-colors"
                      title="Download file"
                      aria-label={`Download ${file.name}`}
                    >
                      <FaDownload size={12} />
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(file)}
                        disabled={busyId === file.id}
                        className="p-1.5 text-ink-faint hover:text-redline transition-colors disabled:opacity-40"
                        title="Delete file"
                        aria-label={`Delete ${file.name}`}
                      >
                        <FaTrash size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canDelete && (
        <div className="flex items-center gap-2">
          <input
            ref={uploadInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleAttachFile}
            className="hidden"
          />
          <Select
            value={uploadKind}
            onChange={(e) => setUploadKind(e.target.value as DeclarantSource)}
            disabled={uploading}
            className="w-auto text-xs"
          >
            <option value="cv">CV</option>
            <option value="prior_declaration">Prior declaration</option>
          </Select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAttachClick}
            disabled={uploading}
          >
            {uploading ? (
              <FaSpinner className="w-3 h-3 animate-spin" />
            ) : (
              <FaPaperclip className="w-3 h-3" />
            )}
            {uploading ? 'Uploading…' : 'Attach PDF'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function DeclarantsSection({
  orgSlug,
  isAdmin,
  currentUserId,
}: {
  orgSlug: string;
  isAdmin: boolean;
  currentUserId: string;
}) {
  const confirm = useConfirm();
  const [declarants, setDeclarants] = useState<Declarant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Declarant | null | 'new'>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.listDeclarants(orgSlug);
      setDeclarants(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load declarants');
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => { load(); }, [load]);

  const canEdit = (d: Declarant) => isAdmin || d.userId === currentUserId;

  // Persist the declarant. Returns the created declarant on create (so the modal
  // can attach the uploaded source file afterwards), or null on edit. Refreshing
  // the list happens here; the modal closes itself once any attach completes.
  const handleSave = async (dto: DeclarantDto): Promise<Declarant | null> => {
    if (editing && editing !== 'new') {
      const patch: UpdateDeclarantRequest = {
        displayName: dto.displayName,
        title: dto.title ?? null,
        firm: dto.firm ?? null,
        cvExhibit: dto.cvExhibit ?? null,
        hourlyRate: dto.hourlyRate ?? null,
        nonContingencyDisclosure: dto.nonContingencyDisclosure ?? null,
        dateOfBirth: dto.dateOfBirth ?? null,
        address: dto.address ?? null,
        priorTestimony: dto.priorTestimony,
        qualifications: dto.qualifications,
      };
      await apiClient.updateDeclarant(orgSlug, editing.id, patch);
      await load();
      return null;
    }

    const create: CreateDeclarantRequest = {
      displayName: dto.displayName,
      title: dto.title,
      firm: dto.firm,
      cvExhibit: dto.cvExhibit,
      hourlyRate: dto.hourlyRate,
      nonContingencyDisclosure: dto.nonContingencyDisclosure,
      dateOfBirth: dto.dateOfBirth,
      address: dto.address,
      priorTestimony: dto.priorTestimony,
      qualifications: dto.qualifications,
      userId: dto.userId,
    };
    const created = await apiClient.createDeclarant(orgSlug, create);
    await load();
    return created;
  };

  const handleDelete = async (declarant: Declarant) => {
    const ok = await confirm({
      title: 'Delete this declarant?',
      message: <>Delete <span className="text-ink font-medium">{declarant.displayName}</span> from this organization? This cannot be undone.</>,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.deleteDeclarant(orgSlug, declarant.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete declarant');
    }
  };

  return (
    <Panel padded className="mb-6">
      <div className="flex items-center justify-between mb-1">
        <Kicker className="block">Declarants</Kicker>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
        >
          <FaPlus size={10} />
          New declarant
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-5">
        Reusable expert profiles — name, credentials, and qualifications paragraphs that any
        case in this organization can insert into a declaration.
      </p>

      {error && (
        <div className="px-3 py-2 mb-4 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
          {error}
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : declarants.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-8">
          <FaUserTie className="w-6 h-6 text-ink-faint/60 mb-2" />
          <p className="text-sm text-ink-muted">No declarants yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full">
            <tbody>
              {declarants.map((declarant) => {
                const editable = canEdit(declarant);
                const subtitle = [declarant.title, declarant.firm].filter(Boolean).join(' · ');
                return (
                  <tr key={declarant.id} className="border-t border-line first:border-t-0">
                    <td className="px-4 py-3">
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => setEditing(declarant)}
                          className="text-sm text-ink font-medium hover:text-brand transition-colors text-left"
                        >
                          {declarant.displayName}
                        </button>
                      ) : (
                        <span className="text-sm text-ink font-medium">{declarant.displayName}</span>
                      )}
                      {subtitle && <p className="text-[13px] text-ink-muted">{subtitle}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {declarant.userId === currentUserId && <Badge tone="accent">You</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editable && (
                        <button
                          onClick={() => handleDelete(declarant)}
                          className="p-1.5 text-ink-faint hover:text-redline transition-colors"
                          title="Delete declarant"
                          aria-label={`Delete declarant ${declarant.displayName}`}
                        >
                          <FaTrash size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DeclarantModal
          declarant={editing === 'new' ? null : editing}
          orgSlug={orgSlug}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </Panel>
  );
}
