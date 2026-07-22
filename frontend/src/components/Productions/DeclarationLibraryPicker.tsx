'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaBookOpen } from 'react-icons/fa6';
import type { components } from '@/generated/api-types';
import { apiClient } from '@/lib/api-client';
import { Modal, Button, Select, Badge } from '@/components/ui';
import { useAuth } from '@/components/Auth/AuthProvider';
import { useCaseContext } from '@/contexts/CaseContext';

type DeclarationData = components['schemas']['DeclarationData'];
type DeclarationSection = components['schemas']['DeclarationSection'];
type DeclarationParagraph = components['schemas']['DeclarationParagraph'];
type DeclarationLibraryBlock = components['schemas']['DeclarationLibraryBlock'];
type DeclarationLibraryBlockKind = components['schemas']['DeclarationLibraryBlockKind'];

interface DeclarationLibraryPickerProps {
  open: boolean;
  data: DeclarationData;
  onClose: () => void;
  /** Emits the next full DeclarationData (immutable) after an insert. */
  onChange: (next: DeclarationData) => void;
}

const KIND_LABEL: Partial<Record<DeclarationLibraryBlockKind, string>> = {
  boilerplate: 'Boilerplate',
};

const KIND_ORDER: DeclarationLibraryBlockKind[] = ['boilerplate'];

/** Deep-clone a library paragraph with fresh ids for it and its sub-items/footnotes.
 *  Tolerant of malformed stored paragraphs (missing text / arrays). */
function cloneParagraph(paragraph: DeclarationParagraph): DeclarationParagraph {
  const subItems = Array.isArray(paragraph?.subItems) ? paragraph.subItems : [];
  const footnotes = Array.isArray(paragraph?.footnotes) ? paragraph.footnotes : [];
  return {
    id: crypto.randomUUID(),
    text: typeof paragraph?.text === 'string' ? paragraph.text : '',
    subItems: subItems.map((si) => ({ id: crypto.randomUUID(), text: si?.text ?? '' })),
    // Exhibit references are declaration-scoped and can't resolve in this
    // declaration, so library-inserted paragraphs start with none.
    exhibitIds: [],
    footnotes: footnotes.map((fn) => ({ id: crypto.randomUUID(), text: fn?.text ?? '' })),
  };
}

export function DeclarationLibraryPicker({ open, data, onClose, onChange }: DeclarationLibraryPickerProps) {
  const { user } = useAuth();
  const { orgId } = useCaseContext();

  // Resolve the case's own org slug from the user's org memberships. Never fall
  // back to a globally "active" org — a wrong org would leak another org's library.
  const orgSlug = useMemo(
    () => (orgId ? user?.orgs.find((o) => o.id === orgId)?.slug ?? null : null),
    [user, orgId],
  );

  const [blocks, setBlocks] = useState<DeclarationLibraryBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [targetSectionId, setTargetSectionId] = useState<string>(data.sections[0]?.id ?? '');

  useEffect(() => {
    if (!open) return;
    if (!orgSlug) {
      setBlocks([]);
      setError('Could not resolve this case\'s organization.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .listDeclarationLibrary(orgSlug)
      .then((result) => {
        if (cancelled) return;
        setBlocks(result);
      })
      .catch(() => {
        if (cancelled) return;
        setBlocks([]);
        setError('Failed to load the declaration library.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgSlug]);

  // Keep the target section valid as sections change / on open.
  useEffect(() => {
    if (!open) return;
    if (!data.sections.some((s) => s.id === targetSectionId)) {
      setTargetSectionId(data.sections[0]?.id ?? '');
    }
  }, [open, data.sections, targetSectionId]);

  const grouped = useMemo(() => {
    const map = new Map<DeclarationLibraryBlockKind, DeclarationLibraryBlock[]>();
    for (const kind of KIND_ORDER) map.set(kind, []);
    for (const block of blocks) {
      const list = map.get(block.kind);
      if (list) list.push(block);
    }
    return map;
  }, [blocks]);

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const canInsert = Boolean(selectedBlock && targetSectionId);

  const insert = () => {
    if (!selectedBlock || !targetSectionId) return;
    const cloned = (selectedBlock.content?.paragraphs ?? []).map(cloneParagraph);
    const nextSections: DeclarationSection[] = data.sections.map((section) =>
      section.id === targetSectionId
        ? { ...section, paragraphs: [...section.paragraphs, ...cloned] }
        : section,
    );
    onChange({ ...data, sections: nextSections });
    setSelectedBlockId(null);
    onClose();
  };

  if (!open) return null;

  return (
    <Modal
      open
      title="Insert from library"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span>Into section</span>
            <Select
              value={targetSectionId}
              onChange={(e) => setTargetSectionId(e.target.value)}
              className="w-auto"
              disabled={data.sections.length === 0}
            >
              {data.sections.length === 0 ? (
                <option value="">No sections</option>
              ) : (
                data.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.heading || 'Untitled section'}
                  </option>
                ))
              )}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={insert} disabled={!canInsert}>
              Insert
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {loading && <p className="text-sm text-ink-muted py-2">Loading library…</p>}
        {error && !loading && <p className="text-sm text-redline py-2">{error}</p>}
        {!loading && !error && blocks.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-8">
            <FaBookOpen className="w-6 h-6 text-ink-faint/60 mb-2" />
            <p className="text-sm text-ink-muted">The library is empty.</p>
            <p className="text-xs text-ink-faint mt-1">
              Add reusable blocks in your organization settings.
            </p>
          </div>
        )}

        {!loading && !error &&
          KIND_ORDER.map((kind) => {
            const list = grouped.get(kind) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={kind} className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                  {KIND_LABEL[kind]}
                </div>
                <div className="space-y-1">
                  {list.map((block) => {
                    const selected = block.id === selectedBlockId;
                    return (
                      <button
                        key={block.id}
                        type="button"
                        onClick={() => setSelectedBlockId(block.id)}
                        className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                          selected
                            ? 'border-brand bg-brand-soft'
                            : 'border-line-strong bg-surface hover:bg-surface-raised'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-ink font-medium truncate flex-1">
                            {block.name}
                          </span>
                          {block.category && (
                            <Badge tone="neutral" className="shrink-0">
                              {block.category}
                            </Badge>
                          )}
                          <span className="text-[11px] font-mono text-ink-faint shrink-0">
                            {(block.content?.paragraphs ?? []).length} ¶
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>
    </Modal>
  );
}
