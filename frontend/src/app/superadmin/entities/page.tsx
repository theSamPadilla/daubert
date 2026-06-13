'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { apiClient, LabeledEntity } from '@/lib/api-client';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/labeled-entities';
import { FaPenToSquare, FaTrash, FaPlus, FaMinus, FaChevronDown, FaChevronRight } from 'react-icons/fa6';
import { Loader } from '@/components/Common/Loader';
import { ErrorModal } from '@/components/Common/ErrorModal';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { Button, IconButton, Input, Select, Kicker, Panel } from '@/components/ui';

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
          Delete entity <span className="text-ink font-medium">&ldquo;{entity.name}&rdquo;</span>. This cannot
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
          <Kicker className="mb-3 block">Superadmin</Kicker>
          <h2 className="mt-1 text-4xl font-bold tracking-tight text-ink">
            Labeled entities
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Curated wallet labels surfaced across all investigations.
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <Input
            type="text"
            placeholder="Search entities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-44"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </Select>
          <Button onClick={handleAdd} className="shrink-0">
            <FaPlus className="h-3 w-3" /> Add entity
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-redline/40 bg-redline/10 p-3 text-sm text-redline">
          {error}
        </div>
      )}

      {showForm && (
        <Panel padded className="mb-6 border-line-strong">
          <h3 className="text-base font-semibold text-ink mb-5">
            {editingId ? 'Edit entity' : 'Add entity'}
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-ink-muted mb-1">Name</label>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Entity name"
              />
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">Category</label>
              <Select
                value={formData.category}
                onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm text-ink-muted mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 resize-y"
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
                className="flex items-center gap-1 text-xs text-brand hover:text-brand-strong transition-colors"
              >
                <FaPlus className="w-3 h-3" /> Add wallet
              </button>
            </div>
            <div className="space-y-2">
              {formData.wallets.map((wallet, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={wallet}
                    onChange={(e) => updateWallet(i, e.target.value)}
                    className="font-mono"
                    placeholder="0x..."
                  />
                  {formData.wallets.length > 1 && (
                    <IconButton
                      aria-label="Remove wallet"
                      type="button"
                      onClick={() => removeWalletField(i)}
                      className="text-ink-faint hover:text-redline hover:bg-redline/10"
                    >
                      <FaMinus className="w-3 h-3" />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </Button>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </Panel>
      )}

      {loading ? (
        <Loader inline />
      ) : entities.length === 0 ? (
        <Panel className="py-16 text-center">
          <p className="text-sm text-ink-muted">No entities found.</p>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Name</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Category</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Wallets</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Description</th>
                <th className="px-4 py-3 w-24 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Actions</th>
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
                      className="border-b border-line hover:bg-surface-panel cursor-pointer transition-colors"
                      onClick={() => toggleExpand(entity.id)}
                    >
                      <td className="px-4 py-3 text-ink-faint">
                        {isExpanded ? (
                          <FaChevronDown className="w-3 h-3" />
                        ) : (
                          <FaChevronRight className="w-3 h-3" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink font-medium">
                        {entity.name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold ${catColor}`}
                        >
                          {entity.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink-muted">
                        {entity.wallets.length}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink-muted">
                        {truncate(entity.description, 80)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <IconButton
                            aria-label="Edit entity"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(entity);
                            }}
                            className="text-ink-faint hover:text-brand"
                          >
                            <FaPenToSquare className="w-3.5 h-3.5" />
                          </IconButton>
                          <IconButton
                            aria-label="Delete entity"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(entity);
                            }}
                            className="text-ink-faint hover:text-redline hover:bg-redline/10"
                          >
                            <FaTrash className="w-3.5 h-3.5" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-surface-panel">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="space-y-3">
                            {entity.description && (
                              <div>
                                <span className="text-[10px] text-ink-faint font-semibold uppercase tracking-[0.18em]">
                                  Description
                                </span>
                                <p className="text-sm text-ink-muted mt-1">
                                  {entity.description}
                                </p>
                              </div>
                            )}
                            <div>
                              <span className="text-[10px] text-ink-faint font-semibold uppercase tracking-[0.18em]">
                                Wallets ({entity.wallets.length})
                              </span>
                              {entity.wallets.length > 0 ? (
                                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                                  {entity.wallets.map((wallet, i) => (
                                    <li
                                      key={i}
                                      className="text-xs text-ink-muted font-mono bg-surface border border-line rounded-md px-2 py-1"
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
                                  <span className="text-[10px] text-ink-faint font-semibold uppercase tracking-[0.18em]">
                                    Metadata
                                  </span>
                                  <pre className="text-xs text-ink-muted mt-1.5 bg-surface border border-line rounded-lg p-2.5 overflow-x-auto">
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
        </Panel>
      )}

      <ErrorModal
        open={!!errorMessage}
        message={errorMessage ?? ''}
        onClose={() => setErrorMessage(null)}
      />
    </main>
  );
}
