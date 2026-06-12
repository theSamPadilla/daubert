'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { apiClient, type LabeledEntity } from '@/lib/api-client';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/labeled-entities';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa6';
import { Loader } from '@/components/Common/Loader';

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
    <div className="min-h-screen bg-surface p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink">Labeled Entities</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Daubert&apos;s registry of known wallet operators. Read-only view — admins can manage entries from <code className="text-brand font-mono">/admin/entities</code>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search entities..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
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
          <div className="mb-4 rounded-lg border border-redline/30 bg-redline/8 p-3 text-sm text-redline">{error}</div>
        )}

        {loading ? (
          <Loader inline />
        ) : entities.length === 0 ? (
          <p className="py-12 text-center text-ink-muted">No entities found.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-panel text-left">
                  <th className="w-8 px-4 py-3 border-b border-line"></th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Name</th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Category</th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Wallets</th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Description</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((entity) => {
                  const expanded = expandedId === entity.id;
                  const catColor = CATEGORY_COLORS[entity.category as Category] || CATEGORY_COLORS.other;
                  return (
                    <Fragment key={entity.id}>
                      <tr
                        className="cursor-pointer border-b border-line hover:bg-surface-panel transition-colors"
                        onClick={() => setExpandedId((p) => (p === entity.id ? null : entity.id))}
                      >
                        <td className="px-4 py-3 text-ink-faint">
                          {expanded ? <FaChevronDown className="h-3 w-3" /> : <FaChevronRight className="h-3 w-3" />}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-ink">{entity.name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${catColor}`}>
                            {entity.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-ink-muted">{entity.wallets.length}</td>
                        <td className="px-4 py-3 text-sm text-ink-muted">{truncate(entity.description, 80)}</td>
                      </tr>
                      {expanded && (
                        <tr className="bg-surface-panel">
                          <td colSpan={5} className="px-4 py-4">
                            <div className="space-y-3">
                              {entity.description && (
                                <div>
                                  <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">Description</span>
                                  <p className="mt-1 text-sm text-ink-muted">{entity.description}</p>
                                </div>
                              )}
                              <div>
                                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                                  Wallets ({entity.wallets.length})
                                </span>
                                {entity.wallets.length > 0 ? (
                                  <ul className="mt-1 space-y-1">
                                    {entity.wallets.map((wallet, i) => (
                                      <li
                                        key={i}
                                        className="mb-1 mr-2 inline-block rounded-lg border border-line bg-surface px-2 py-1 font-mono text-sm text-ink-muted"
                                      >
                                        {wallet}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="mt-1 text-sm text-ink-faint">No wallets associated</p>
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
