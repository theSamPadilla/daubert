'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaPlus, FaTrash, FaChevronUp, FaChevronDown, FaUserTie } from 'react-icons/fa6';
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
import { Modal } from '@/components/ui/Modal';

type Declarant = components['schemas']['Declarant'];
type CreateDeclarantRequest = components['schemas']['CreateDeclarantRequest'];
type UpdateDeclarantRequest = components['schemas']['UpdateDeclarantRequest'];
type DeclarationParagraph = components['schemas']['DeclarationParagraph'];

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

function DeclarantModal({
  declarant,
  currentUserId,
  onClose,
  onSave,
}: {
  declarant: Declarant | null;
  currentUserId: string;
  onClose: () => void;
  onSave: (dto: DeclarantDto) => Promise<void>;
}) {
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
  const [linkToMe, setLinkToMe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = displayName.trim().length > 0 && !saving;

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

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
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
        userId: !declarant && linkToMe ? currentUserId : undefined,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save declarant');
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={declarant ? 'Edit declarant' : 'New declarant'}
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
        {error && (
          <div className="px-3 py-2 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
            {error}
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

        {!declarant && (
          <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
            <input
              type="checkbox"
              checked={linkToMe}
              onChange={(e) => setLinkToMe(e.target.checked)}
              className="accent-brand"
            />
            This is my profile (link it to my account)
          </label>
        )}
      </div>
    </Modal>
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

  const handleSave = async (dto: DeclarantDto) => {
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
    } else {
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
      await apiClient.createDeclarant(orgSlug, create);
    }
    setEditing(null);
    await load();
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
        <Kicker index={3} className="block">Declarants</Kicker>
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
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </Panel>
  );
}
