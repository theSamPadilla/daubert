'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { apiClient, type LabeledEntity } from '@/lib/api-client';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/labeled-entities';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa6';

export default function EntitiesPage() {
  const [entities, setEntities] = useState<LabeledEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    const t = setTimeout(() => { fetchEntities(); }, 300);
    return () => clearTimeout(t);
  }, [fetchEntities]);

  const truncate = (text: string | null, max: number) => {
    if (!text) return '--';
    return text.length > max ? text.slice(0, max) + '...' : text;
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Labeled Entities</h1>
            <p className="mt-1 text-sm text-gray-400">
              Daubert&apos;s registry of known wallet operators. Read-only view — admins can manage entries from <code className="text-blue-400">/admin/entities</code>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search entities..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded bg-red-900/50 p-3 text-sm text-red-300">{error}</div>
        )}

        {loading ? (
          <p className="py-12 text-center text-gray-400">Loading entities...</p>
        ) : entities.length === 0 ? (
          <p className="py-12 text-center text-gray-400">No entities found.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-700">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-800/50 text-left text-sm text-gray-400">
                  <th className="w-8 px-4 py-3"></th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Wallets</th>
                  <th className="px-4 py-3">Description</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((entity) => {
                  const expanded = expandedId === entity.id;
                  const catColor = CATEGORY_COLORS[entity.category as Category] || CATEGORY_COLORS.other;
                  return (
                    <Fragment key={entity.id}>
                      <tr
                        className="cursor-pointer border-b border-gray-700/50 hover:bg-gray-800/50"
                        onClick={() => setExpandedId((p) => (p === entity.id ? null : entity.id))}
                      >
                        <td className="px-4 py-3 text-gray-500">
                          {expanded ? <FaChevronDown className="h-3 w-3" /> : <FaChevronRight className="h-3 w-3" />}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-white">{entity.name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${catColor}`}>
                            {entity.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">{entity.wallets.length}</td>
                        <td className="px-4 py-3 text-sm text-gray-400">{truncate(entity.description, 80)}</td>
                      </tr>
                      {expanded && (
                        <tr className="bg-gray-800/30">
                          <td colSpan={5} className="px-4 py-4">
                            <div className="space-y-3">
                              {entity.description && (
                                <div>
                                  <span className="text-xs uppercase tracking-wider text-gray-500">Description</span>
                                  <p className="mt-1 text-sm text-gray-300">{entity.description}</p>
                                </div>
                              )}
                              <div>
                                <span className="text-xs uppercase tracking-wider text-gray-500">
                                  Wallets ({entity.wallets.length})
                                </span>
                                {entity.wallets.length > 0 ? (
                                  <ul className="mt-1 space-y-1">
                                    {entity.wallets.map((wallet, i) => (
                                      <li
                                        key={i}
                                        className="mb-1 mr-2 inline-block rounded bg-gray-800 px-2 py-1 font-mono text-sm text-gray-300"
                                      >
                                        {wallet}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="mt-1 text-sm text-gray-500">No wallets associated</p>
                                )}
                              </div>
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
