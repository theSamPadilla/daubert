'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaUserTie } from 'react-icons/fa6';
import type { components } from '@/generated/api-types';
import { apiClient } from '@/lib/api-client';
import { Modal, Button, Badge } from '@/components/ui';
import { useAuth } from '@/components/Auth/AuthProvider';
import { useCaseContext } from '@/contexts/CaseContext';

type DeclarationData = components['schemas']['DeclarationData'];
type DeclarationSection = components['schemas']['DeclarationSection'];
type DeclarationParagraph = components['schemas']['DeclarationParagraph'];
type Declarant = components['schemas']['Declarant'];

interface DeclarantPickerProps {
  open: boolean;
  data: DeclarationData;
  onClose: () => void;
  /** Emits the next full DeclarationData (immutable) after an auto-fill. */
  onChange: (next: DeclarationData) => void;
}

/** Deep-clone a declarant qualifications paragraph with fresh ids for it and
 *  its sub-items/footnotes. Declarant qualifications carry no exhibit refs by
 *  construction, so exhibitIds always start empty. Tolerant of malformed data. */
function cloneParagraph(paragraph: DeclarationParagraph): DeclarationParagraph {
  const subItems = Array.isArray(paragraph?.subItems) ? paragraph.subItems : [];
  const footnotes = Array.isArray(paragraph?.footnotes) ? paragraph.footnotes : [];
  return {
    id: crypto.randomUUID(),
    text: typeof paragraph?.text === 'string' ? paragraph.text : '',
    subItems: subItems.map((si) => ({ id: crypto.randomUUID(), text: si?.text ?? '' })),
    exhibitIds: [],
    footnotes: footnotes.map((fn) => ({ id: crypto.randomUUID(), text: fn?.text ?? '' })),
  };
}

/** Build the trailing rate / non-contingency paragraph, or null if both empty. */
function buildRateParagraph(declarant: Declarant): DeclarationParagraph | null {
  const rate = (declarant.hourlyRate ?? '').trim();
  const disclosure = (declarant.nonContingencyDisclosure ?? '').trim();
  if (!rate && !disclosure) return null;
  const parts: string[] = [];
  if (rate) parts.push(`My hourly rate is ${rate}.`);
  if (disclosure) parts.push(disclosure);
  return {
    id: crypto.randomUUID(),
    text: parts.join(' '),
    subItems: [],
    exhibitIds: [],
    footnotes: [],
  };
}

/** Immutably apply a declarant's fields to the declaration:
 *  - declarantName / DOB / address set only if currently empty.
 *  - qualifications paragraphs (fresh ids) appended to the qualifications section
 *    (or the first section as a fallback); existing paragraphs are never touched.
 *  - a trailing rate/disclosure paragraph is appended when present. */
export function applyDeclarant(data: DeclarationData, declarant: Declarant): DeclarationData {
  const next: DeclarationData = { ...data };

  if (!(data.declarantName ?? '').trim()) {
    next.declarantName = declarant.displayName;
  }
  if (!(data.declarantDateOfBirth ?? '').trim() && (declarant.dateOfBirth ?? '').trim()) {
    next.declarantDateOfBirth = declarant.dateOfBirth ?? undefined;
  }
  if (!(data.declarantAddress ?? '').trim() && (declarant.address ?? '').trim()) {
    next.declarantAddress = declarant.address ?? undefined;
  }

  const appended: DeclarationParagraph[] = [
    ...(Array.isArray(declarant.qualifications) ? declarant.qualifications : []).map(cloneParagraph),
  ];
  const rateParagraph = buildRateParagraph(declarant);
  if (rateParagraph) appended.push(rateParagraph);

  if (appended.length > 0 && data.sections.length > 0) {
    const qualIndex = data.sections.findIndex((s) => s.kind === 'qualifications');
    const targetIndex = qualIndex >= 0 ? qualIndex : 0;
    next.sections = data.sections.map((section, i): DeclarationSection =>
      i === targetIndex
        ? { ...section, paragraphs: [...section.paragraphs, ...appended] }
        : section,
    );
  }

  return next;
}

export function DeclarantPicker({ open, data, onClose, onChange }: DeclarantPickerProps) {
  const { user } = useAuth();
  const { orgId } = useCaseContext();

  // Resolve the case's own org slug from the user's org memberships. Never fall
  // back to a globally "active" org — a wrong org would leak another org's data.
  const orgSlug = useMemo(
    () => (orgId ? user?.orgs.find((o) => o.id === orgId)?.slug ?? null : null),
    [user, orgId],
  );

  const [declarants, setDeclarants] = useState<Declarant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!orgSlug) {
      setDeclarants([]);
      setError('Could not resolve this case\'s organization.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .listDeclarants(orgSlug)
      .then((result) => {
        if (cancelled) return;
        setDeclarants(result);
      })
      .catch(() => {
        if (cancelled) return;
        setDeclarants([]);
        setError('Failed to load declarants.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgSlug]);

  const selected = declarants.find((d) => d.id === selectedId) ?? null;

  const apply = () => {
    if (!selected) return;
    onChange(applyDeclarant(data, selected));
    setSelectedId(null);
    onClose();
  };

  if (!open) return null;

  return (
    <Modal
      open
      title="Select declarant"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply} disabled={!selected}>
            Apply
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-ink-muted">
          Fills in the declarant name (and any required date-of-birth / address) if empty, and
          appends the declarant&apos;s qualifications paragraphs. Existing content is never
          overwritten.
        </p>

        {loading && <p className="text-sm text-ink-muted py-2">Loading declarants…</p>}
        {error && !loading && <p className="text-sm text-redline py-2">{error}</p>}
        {!loading && !error && declarants.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-8">
            <FaUserTie className="w-6 h-6 text-ink-faint/60 mb-2" />
            <p className="text-sm text-ink-muted">No declarants yet.</p>
            <p className="text-xs text-ink-faint mt-1">
              Add declarants in your organization settings.
            </p>
          </div>
        )}

        {!loading && !error && declarants.length > 0 && (
          <div className="space-y-1">
            {declarants.map((declarant) => {
              const isSelected = declarant.id === selectedId;
              const subtitle = [declarant.title, declarant.firm].filter(Boolean).join(' · ');
              const paraCount = Array.isArray(declarant.qualifications)
                ? declarant.qualifications.length
                : 0;
              return (
                <button
                  key={declarant.id}
                  type="button"
                  onClick={() => setSelectedId(declarant.id)}
                  className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                    isSelected
                      ? 'border-brand bg-brand-soft'
                      : 'border-line-strong bg-surface hover:bg-surface-raised'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-ink font-medium truncate flex-1">
                      {declarant.displayName}
                    </span>
                    {declarant.userId === user?.id && (
                      <Badge tone="accent" className="shrink-0">
                        You
                      </Badge>
                    )}
                    <span className="text-[11px] font-mono text-ink-faint shrink-0">
                      {paraCount} ¶
                    </span>
                  </div>
                  {subtitle && (
                    <div className="text-[12px] text-ink-muted mt-0.5 truncate">{subtitle}</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
