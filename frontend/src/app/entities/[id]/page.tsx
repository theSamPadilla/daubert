'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { apiClient, LabeledEntity } from '@/lib/api-client';
import { FaArrowLeft } from 'react-icons/fa6';
import Link from 'next/link';
import { Loader } from '@/components/Common/Loader';
import { Panel } from '@/components/ui';

const CATEGORY_COLORS: Record<string, string> = {
  exchange: 'bg-blue-100 text-blue-700',
  mixer: 'bg-red-100 text-red-700',
  bridge: 'bg-purple-100 text-purple-700',
  protocol: 'bg-green-100 text-green-700',
  individual: 'bg-yellow-100 text-yellow-700',
  contract: 'bg-cyan-100 text-cyan-700',
  government: 'bg-orange-100 text-orange-700',
  custodian: 'bg-indigo-100 text-indigo-700',
  other: 'bg-surface-raised text-ink-muted',
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
          <p className="text-redline">{error || 'Entity not found'}</p>
          <Link href="/" className="text-sm text-brand hover:text-brand-strong transition-colors">
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
          className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink transition-colors mb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
        >
          <FaArrowLeft className="w-3 h-3" />
          Back
        </Link>

        <Panel padded>
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <h1 className="text-2xl font-bold text-ink">{entity.name}</h1>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${catColor}`}>
              {entity.category}
            </span>
          </div>

          {/* Description */}
          {entity.description && (
            <div className="mb-6">
              <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-faint mb-2">Description</h2>
              <p className="text-sm text-ink-muted">{entity.description}</p>
            </div>
          )}

          {/* Wallets */}
          <div className="mb-6">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-faint mb-2">
              Wallets ({entity.wallets.length})
            </h2>
            {entity.wallets.length > 0 ? (
              <div className="space-y-1.5">
                {entity.wallets.map((wallet, i) => (
                  <div
                    key={i}
                    className="text-sm text-ink-muted font-mono bg-surface-panel rounded-lg px-3 py-2 border border-line"
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
              <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-faint mb-2">Metadata</h2>
              <pre className="text-xs text-ink-muted bg-surface-panel rounded-lg p-3 border border-line overflow-x-auto">
                {JSON.stringify(entity.metadata, null, 2)}
              </pre>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
