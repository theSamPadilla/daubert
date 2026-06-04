'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { apiClient, LabeledEntity } from '@/lib/api-client';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/labeled-entities';
import { FaPenToSquare, FaTrash, FaPlus, FaMinus, FaChevronDown, FaChevronRight } from 'react-icons/fa6';
import { Loader } from '@/components/Common/Loader';
import { ErrorModal } from '@/components/Common/ErrorModal';
import { useConfirm } from '@/components/Common/ConfirmProvider';

interface EntityFormData {
  name: string;
  category: string;
  description: string;
  wallets: string[];
}

const emptyForm: EntityFormData = {
  name: '',
  category: 'exchange',
  description: '',
  wallets: [''],
};

const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand transition-colors';

const primaryBtn =
  'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-brand hover:bg-brand/90 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

const secondaryBtn =
  'px-4 py-2 rounded-lg text-sm bg-surface-raised hover:bg-surface-raised/80 text-ink-muted hover:text-white transition-colors';

export default function AdminEntitiesPage() {
  const confirm = useConfirm();
  const [entities, setEntities] = useState<LabeledEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<EntityFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchEntities = useCallback(async () => {
    try {
      setError(null);
      const filters: { category?: string; search?: string } = {};
      if (categoryFilter) filters.category = categoryFilter;
      if (search.trim()) filters.search = search.trim();
      const data = await apiClient.listLabeledEntities(filters);
      setEntities(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entities');
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter]);

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => {
      fetchEntities();
    }, 300);
    return () => clearTimeout(timeout);
  }, [fetchEntities]);

  const handleAdd = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setShowForm(true);
  };

  const handleEdit = (entity: LabeledEntity) => {
    setEditingId(entity.id);
    setFormData({
      name: entity.name,
      category: entity.category,
      description: entity.description || '',
      wallets: entity.wallets.length > 0 ? [...entity.wallets] : [''],
    });
    setShowForm(true);
  };

  const handleDelete = async (entity: LabeledEntity) => {
    const ok = await confirm({
      title: 'Delete entity?',
      message: (
        <>
          Delete entity <span className="text-white">&ldquo;{entity.name}&rdquo;</span>. This cannot
          be undone.
        </>
      ),
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.superadminDeleteLabeledEntity(entity.id);
      await fetchEntities();
      if (expandedId === entity.id) setExpandedId(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete entity');
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setErrorMessage('Name is required');
      return;
    }

    setSaving(true);
    try {
      const wallets = formData.wallets.map((w) => w.trim()).filter(Boolean);
      const body = {
        name: formData.name.trim(),
        category: formData.category,
        description: formData.description.trim() || undefined,
        wallets,
      };

      if (editingId) {
        await apiClient.superadminUpdateLabeledEntity(editingId, body);
      } else {
        await apiClient.superadminCreateLabeledEntity(body);
      }

      setShowForm(false);
      setEditingId(null);
      setFormData(emptyForm);
      await fetchEntities();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save entity');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(emptyForm);
  };

  const addWalletField = () => {
    setFormData((prev) => ({ ...prev, wallets: [...prev.wallets, ''] }));
  };

  const removeWalletField = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      wallets: prev.wallets.filter((_, i) => i !== index),
    }));
  };

  const updateWallet = (index: number, value: string) => {
    setFormData((prev) => ({
      ...prev,
      wallets: prev.wallets.map((w, i) => (i === index ? value : w)),
    }));
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const truncate = (text: string | null, max: number) => {
    if (!text) return '--';
    return text.length > max ? text.slice(0, max) + '...' : text;
  };

  return (
    <main className="relative max-w-6xl mx-auto px-6 py-12">
      <div className="mb-10 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-gradient-to-r from-brand-ink to-transparent" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
              Superadmin
            </span>
          </div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-white">
            Labeled entities
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Curated wallet labels surfaced across all investigations.
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <input
            type="text"
            placeholder="Search entities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} w-56`}
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={inputClass}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </select>
          <button onClick={handleAdd} className={`${primaryBtn} shrink-0`}>
            <FaPlus className="h-3 w-3" /> Add entity
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {showForm && (
        <div className="relative mb-6 p-6 rounded-xl bg-surface-panel border border-line-strong/60 shadow-[0_2px_12px_rgba(0,0,0,0.35)] overflow-hidden">
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
          <h3 className="text-base font-semibold text-white mb-5">
            {editingId ? 'Edit entity' : 'Add entity'}
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-ink-muted mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className={inputClass}
                placeholder="Entity name"
              />
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                className={inputClass}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm text-ink-muted mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className={`${inputClass} resize-y`}
              rows={3}
              placeholder="Optional description"
            />
          </div>
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-ink-muted">Wallets</label>
              <button
                type="button"
                onClick={addWalletField}
                className="flex items-center gap-1 text-xs text-brand-ink hover:text-white transition-colors"
              >
                <FaPlus className="w-3 h-3" /> Add wallet
              </button>
            </div>
            <div className="space-y-2">
              {formData.wallets.map((wallet, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={wallet}
                    onChange={(e) => updateWallet(i, e.target.value)}
                    className={`${inputClass} font-mono`}
                    placeholder="0x..."
                  />
                  {formData.wallets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeWalletField(i)}
                      className="p-1.5 text-ink-faint hover:text-red-400 transition-colors"
                    >
                      <FaMinus className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleSave} disabled={saving} className={primaryBtn}>
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
            <button onClick={handleCancel} className={secondaryBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : entities.length === 0 ? (
        <div className="rounded-xl border border-line-strong/60 bg-surface-panel/50 py-16 text-center">
          <p className="text-sm text-ink-muted">No entities found.</p>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-line-strong/60 bg-surface-panel shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
          <table className="w-full">
            <thead>
              <tr className="bg-surface/40 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Wallets</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((entity) => {
                const isExpanded = expandedId === entity.id;
                const catColor =
                  CATEGORY_COLORS[entity.category as Category] || CATEGORY_COLORS.other;

                return (
                  <Fragment key={entity.id}>
                    <tr
                      className="border-t border-line-strong/40 hover:bg-white/[0.02] cursor-pointer transition-colors"
                      onClick={() => toggleExpand(entity.id)}
                    >
                      <td className="px-4 py-3 text-ink-faint">
                        {isExpanded ? (
                          <FaChevronDown className="w-3 h-3" />
                        ) : (
                          <FaChevronRight className="w-3 h-3" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-white font-medium">
                        {entity.name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold ${catColor}`}
                        >
                          {entity.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-muted">
                        {entity.wallets.length}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-muted">
                        {truncate(entity.description, 80)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(entity);
                            }}
                            className="p-1.5 text-ink-faint hover:text-brand-ink transition-colors"
                            title="Edit"
                          >
                            <FaPenToSquare className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(entity);
                            }}
                            className="p-1.5 text-ink-faint hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <FaTrash className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-surface/30">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="space-y-3">
                            {entity.description && (
                              <div>
                                <span className="text-[10px] text-ink-muted font-semibold uppercase tracking-[0.18em]">
                                  Description
                                </span>
                                <p className="text-sm text-ink-muted mt-1">
                                  {entity.description}
                                </p>
                              </div>
                            )}
                            <div>
                              <span className="text-[10px] text-ink-muted font-semibold uppercase tracking-[0.18em]">
                                Wallets ({entity.wallets.length})
                              </span>
                              {entity.wallets.length > 0 ? (
                                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                                  {entity.wallets.map((wallet, i) => (
                                    <li
                                      key={i}
                                      className="text-xs text-ink-muted font-mono bg-surface border border-line-strong/60 rounded-md px-2 py-1"
                                    >
                                      {wallet}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-sm text-ink-faint mt-1">
                                  No wallets associated
                                </p>
                              )}
                            </div>
                            {entity.metadata &&
                              Object.keys(entity.metadata).length > 0 && (
                                <div>
                                  <span className="text-[10px] text-ink-muted font-semibold uppercase tracking-[0.18em]">
                                    Metadata
                                  </span>
                                  <pre className="text-xs text-ink-muted mt-1.5 bg-surface border border-line-strong/60 rounded-lg p-2.5 overflow-x-auto">
                                    {JSON.stringify(entity.metadata, null, 2)}
                                  </pre>
                                </div>
                              )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ErrorModal
        open={!!errorMessage}
        message={errorMessage ?? ''}
        onClose={() => setErrorMessage(null)}
      />
    </main>
  );
}
