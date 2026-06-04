'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { apiClient, LabeledEntity } from '@/lib/api-client';
import { FaArrowLeft } from 'react-icons/fa6';
import Link from 'next/link';
import { Loader } from '@/components/Common/Loader';

const CATEGORY_COLORS: Record<string, string> = {
  exchange: 'bg-blue-900/50 text-blue-300',
  mixer: 'bg-red-900/50 text-red-300',
  bridge: 'bg-purple-900/50 text-purple-300',
  protocol: 'bg-green-900/50 text-green-300',
  individual: 'bg-yellow-900/50 text-yellow-300',
  contract: 'bg-cyan-900/50 text-cyan-300',
  government: 'bg-orange-900/50 text-orange-300',
  custodian: 'bg-indigo-900/50 text-indigo-300',
  other: 'bg-gray-700 text-gray-300',
};

export default function EntityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [entity, setEntity] = useState<LabeledEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiClient
      .getLabeledEntity(id)
      .then(setEntity)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load entity'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <Loader />;
  }

  if (error || !entity) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-400">{error || 'Entity not found'}</p>
          <Link href="/" className="text-sm text-brand-ink hover:text-white">
            Back to cases
          </Link>
        </div>
      </div>
    );
  }

  const catColor = CATEGORY_COLORS[entity.category] || CATEGORY_COLORS.other;

  return (
    <div className="min-h-screen bg-surface p-6">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink-muted mb-6"
        >
          <FaArrowLeft className="w-3 h-3" />
          Back
        </Link>

        <div className="bg-surface-panel border border-line-strong rounded-lg p-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <h1 className="text-2xl font-bold text-white">{entity.name}</h1>
            <span className={`px-2.5 py-1 rounded text-xs font-medium ${catColor}`}>
              {entity.category}
            </span>
          </div>

          {/* Description */}
          {entity.description && (
            <div className="mb-6">
              <h2 className="text-xs text-ink-faint uppercase tracking-wider mb-2">Description</h2>
              <p className="text-sm text-ink-muted">{entity.description}</p>
            </div>
          )}

          {/* Wallets */}
          <div className="mb-6">
            <h2 className="text-xs text-ink-faint uppercase tracking-wider mb-2">
              Wallets ({entity.wallets.length})
            </h2>
            {entity.wallets.length > 0 ? (
              <div className="space-y-1.5">
                {entity.wallets.map((wallet, i) => (
                  <div
                    key={i}
                    className="text-sm text-ink-muted font-mono bg-surface rounded px-3 py-2 border border-line-strong"
                  >
                    {wallet}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-faint">No wallets associated</p>
            )}
          </div>

          {/* Metadata */}
          {entity.metadata && Object.keys(entity.metadata).length > 0 && (
            <div>
              <h2 className="text-xs text-ink-faint uppercase tracking-wider mb-2">Metadata</h2>
              <pre className="text-xs text-ink-muted bg-surface rounded p-3 border border-line-strong overflow-x-auto">
                {JSON.stringify(entity.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
