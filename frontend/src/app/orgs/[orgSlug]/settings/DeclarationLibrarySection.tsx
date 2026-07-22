'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaPlus, FaTrash, FaChevronUp, FaChevronDown, FaBookOpen } from 'react-icons/fa6';
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

type DeclarationLibraryBlock = components['schemas']['DeclarationLibraryBlock'];
type DeclarationLibraryBlockKind = components['schemas']['DeclarationLibraryBlockKind'];
type DeclarationParagraph = components['schemas']['DeclarationParagraph'];

const KIND_LABEL: Record<DeclarationLibraryBlockKind, string> = {
  declarant_profile: 'Declarant profiles (legacy)',
  boilerplate: 'Boilerplate',
};

// Display order for the grouped list. Keeps `declarant_profile` so any legacy
// block that predates the Declarants tab still renders rather than crashing —
// the create/edit modal can only ever produce `boilerplate` blocks now.
const KIND_ORDER: DeclarationLibraryBlockKind[] = ['boilerplate', 'declarant_profile'];

const CATEGORY_SUGGESTIONS = ['primer', 'authentication'];

function newParagraph(): DeclarationParagraph {
  return { id: crypto.randomUUID(), text: '', subItems: [], exhibitIds: [], footnotes: [] };
}

// Coerce a stored paragraph (which may be malformed for legacy/edge blocks) into a
// well-formed editable paragraph, so opening the editor can never crash on an
// undefined `text`.
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

function DeclarationLibraryBlockModal({
  block,
  onClose,
  onSave,
}: {
  block: DeclarationLibraryBlock | null;
  onClose: () => void;
  onSave: (dto: {
    kind: DeclarationLibraryBlockKind;
    name: string;
    category?: string;
    content: { paragraphs: DeclarationParagraph[] };
  }) => Promise<void>;
}) {
  // Kind is no longer editable here — new blocks are always boilerplate, and
  // editing a legacy declarant_profile block preserves its existing kind.
  const kind: DeclarationLibraryBlockKind = block?.kind ?? 'boilerplate';
  const [name, setName] = useState(block?.name ?? '');
  const [category, setCategory] = useState(block?.category ?? '');
  const [paragraphs, setParagraphs] = useState<DeclarationParagraph[]>(() => {
    const stored = Array.isArray(block?.content?.paragraphs) ? block!.content!.paragraphs : [];
    return stored.length ? stored.map(toEditableParagraph) : [newParagraph()];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave =
    name.trim().length > 0 && paragraphs.some((p) => (p.text ?? '').trim().length > 0) && !saving;

  const updateParagraph = (id: string, text: string) => {
    setParagraphs((prev) => prev.map((p) => (p.id === id ? { ...p, text } : p)));
  };

  const addParagraph = () => {
    setParagraphs((prev) => [...prev, newParagraph()]);
  };

  const removeParagraph = (id: string) => {
    setParagraphs((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  };

  const moveParagraph = (index: number, direction: -1 | 1) => {
    setParagraphs((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        kind,
        name: name.trim(),
        category: category.trim() || undefined,
        content: { paragraphs: paragraphs.filter((p) => (p.text ?? '').trim().length > 0) },
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save block');
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={block ? 'Edit library block' : 'New library block'}
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
          <label className="block text-xs text-ink-muted mb-1">Category (optional)</label>
          <Input
            type="text"
            list="declaration-library-category-suggestions"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="primer"
          />
          <datalist id="declaration-library-category-suggestions">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="block text-xs text-ink-muted mb-1">Name</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Standard chain-of-custody boilerplate"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-ink-muted">Paragraphs</label>
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
            Paragraphs-only content is fine here — sub-items, exhibits, and footnotes can be
            added later, directly on a declaration.
          </p>
          <div className="space-y-2">
            {paragraphs.map((p, i) => (
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
                    disabled={i === paragraphs.length - 1}
                    className="p-1 text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    title="Move down"
                  >
                    <FaChevronDown size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeParagraph(p.id)}
                    disabled={paragraphs.length <= 1}
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
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function DeclarationLibrarySection({ orgSlug }: { orgSlug: string }) {
  const confirm = useConfirm();
  const [blocks, setBlocks] = useState<DeclarationLibraryBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DeclarationLibraryBlock | null | 'new'>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.listDeclarationLibrary(orgSlug);
      setBlocks(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load the declaration library');
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<DeclarationLibraryBlockKind, DeclarationLibraryBlock[]>();
    for (const kind of KIND_ORDER) map.set(kind, []);
    for (const block of blocks) {
      const list = map.get(block.kind);
      if (list) list.push(block);
    }
    return map;
  }, [blocks]);

  const handleSave = async (dto: {
    kind: DeclarationLibraryBlockKind;
    name: string;
    category?: string;
    content: { paragraphs: DeclarationParagraph[] };
  }) => {
    if (editing && editing !== 'new') {
      await apiClient.updateDeclarationLibraryBlock(orgSlug, editing.id, dto);
    } else {
      await apiClient.createDeclarationLibraryBlock(orgSlug, dto);
    }
    setEditing(null);
    await load();
  };

  const handleDelete = async (block: DeclarationLibraryBlock) => {
    const ok = await confirm({
      title: 'Delete this library block?',
      message: <>Delete <span className="text-ink font-medium">{block.name}</span> from the declaration library? This cannot be undone.</>,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.deleteDeclarationLibraryBlock(orgSlug, block.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete block');
    }
  };

  return (
    <Panel padded className="mb-6">
      <div className="flex items-center justify-between mb-1">
        <Kicker index={4} className="block">Boilerplate library</Kicker>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
        >
          <FaPlus size={10} />
          New block
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-5">
        Reusable boilerplate paragraphs that any case in this organization can insert
        into a declaration. Expert profiles now live in the Declarants tab.
      </p>

      {error && (
        <div className="px-3 py-2 mb-4 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
          {error}
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : blocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-8">
          <FaBookOpen className="w-6 h-6 text-ink-faint/60 mb-2" />
          <p className="text-sm text-ink-muted">The library is empty.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {KIND_ORDER.map((kind) => {
            const list = grouped.get(kind) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={kind}>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
                  {KIND_LABEL[kind]}
                </div>
                <div className="overflow-hidden rounded-lg border border-line">
                  <table className="w-full">
                    <tbody>
                      {list.map((block) => (
                        <tr key={block.id} className="border-t border-line first:border-t-0">
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setEditing(block)}
                              className="text-sm text-ink font-medium hover:text-brand transition-colors text-left"
                            >
                              {block.name}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            {block.category && <Badge tone="neutral">{block.category}</Badge>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDelete(block)}
                              className="p-1.5 text-ink-faint hover:text-redline transition-colors"
                              title="Delete block"
                              aria-label={`Delete block ${block.name}`}
                            >
                              <FaTrash size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <DeclarationLibraryBlockModal
          block={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </Panel>
  );
}
