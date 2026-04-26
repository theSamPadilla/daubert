'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { apiClient, LabeledEntity } from '@/lib/api-client';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/labeled-entities';
import { FaPenToSquare, FaTrash, FaPlus, FaMinus, FaChevronDown, FaChevronRight } from 'react-icons/fa6';

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
    if (!window.confirm(`Delete entity "${entity.name}"? This cannot be undone.`)) return;
    try {
      await apiClient.adminDeleteLabeledEntity(entity.id);
      await fetchEntities();
      if (expandedId === entity.id) setExpandedId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete entity');
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('Name is required');
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
        await apiClient.adminUpdateLabeledEntity(editingId, body);
      } else {
        await apiClient.adminCreateLabeledEntity(body);
      }

      setShowForm(false);
      setEditingId(null);
      setFormData(emptyForm);
      await fetchEntities();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save entity');
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
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Manage Labeled Entities</h1>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search entities..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 w-56"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white"
            >
              Add Entity
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded bg-red-900/50 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Form (inline) */}
        {showForm && (
          <div className="mb-6 p-4 rounded-lg bg-gray-800 border border-gray-700">
            <h2 className="text-lg font-semibold text-white mb-4">
              {editingId ? 'Edit Entity' : 'Add Entity'}
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  placeholder="Entity name"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
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
              <label className="block text-sm text-gray-400 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 resize-y"
                rows={3}
                placeholder="Optional description"
              />
            </div>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-400">Wallets</label>
                <button
                  type="button"
                  onClick={addWalletField}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
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
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                      placeholder="0x..."
                    />
                    {formData.wallets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeWalletField(i)}
                        className="p-1.5 text-gray-500 hover:text-red-400"
                      >
                        <FaMinus className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-400">Loading entities...</p>
          </div>
        ) : entities.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">No entities found.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-800/50 text-left text-sm text-gray-400">
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
                        className="border-b border-gray-700/50 hover:bg-gray-800/50 cursor-pointer"
                        onClick={() => toggleExpand(entity.id)}
                      >
                        <td className="px-4 py-3 text-gray-500">
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
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${catColor}`}
                          >
                            {entity.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">
                          {entity.wallets.length}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">
                          {truncate(entity.description, 80)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(entity);
                              }}
                              className="p-1.5 text-gray-500 hover:text-blue-400"
                              title="Edit"
                            >
                              <FaPenToSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(entity);
                              }}
                              className="p-1.5 text-gray-500 hover:text-red-400"
                              title="Delete"
                            >
                              <FaTrash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-800/30">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="space-y-3">
                              {entity.description && (
                                <div>
                                  <span className="text-xs text-gray-500 uppercase tracking-wider">
                                    Description
                                  </span>
                                  <p className="text-sm text-gray-300 mt-1">
                                    {entity.description}
                                  </p>
                                </div>
                              )}
                              <div>
                                <span className="text-xs text-gray-500 uppercase tracking-wider">
                                  Wallets ({entity.wallets.length})
                                </span>
                                {entity.wallets.length > 0 ? (
                                  <ul className="mt-1 space-y-1">
                                    {entity.wallets.map((wallet, i) => (
                                      <li
                                        key={i}
                                        className="text-sm text-gray-300 font-mono bg-gray-800 rounded px-2 py-1 inline-block mr-2 mb-1"
                                      >
                                        {wallet}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-sm text-gray-500 mt-1">
                                    No wallets associated
                                  </p>
                                )}
                              </div>
                              {entity.metadata &&
                                Object.keys(entity.metadata).length > 0 && (
                                  <div>
                                    <span className="text-xs text-gray-500 uppercase tracking-wider">
                                      Metadata
                                    </span>
                                    <pre className="text-xs text-gray-400 mt-1 bg-gray-800 rounded p-2 overflow-x-auto">
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
      </div>
    </div>
  );
}
