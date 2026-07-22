'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { components } from '@/generated/api-types';
import { apiClient, type DeclarationFormat } from '@/lib/api-client';
import { useCaseContext } from '@/contexts/CaseContext';
import { Modal, Button, Field, Select } from '@/components/ui';

type PrimaryType = 'investigation' | 'production';
type ProductionType = 'report' | 'chart' | 'chronology' | 'declaration';
type DeclarationFormatId = components['schemas']['DeclarationFormatId'];

export function NewPrimaryModal() {
  const router = useRouter();
  const { caseId, newPrimaryDefault, closeNewPrimary, setProductions, reloadInvestigations } = useCaseContext();

  const [tab, setTab] = useState<PrimaryType>(newPrimaryDefault);
  const [name, setName] = useState('');
  const [productionType, setProductionType] = useState<ProductionType>('report');
  const [declarationFormatId, setDeclarationFormatId] = useState<DeclarationFormatId>('ca-declaration');
  const [formats, setFormats] = useState<DeclarationFormat[]>([]);
  const [formatsLoading, setFormatsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listDeclarationFormats()
      .then((f) => {
        if (cancelled) return;
        setFormats(f);
        if (f.length > 0 && !f.some((format) => format.id === declarationFormatId)) {
          setDeclarationFormatId(f[0].id);
        }
      })
      .catch((err) => console.error('Failed to load declaration formats:', err))
      .finally(() => {
        if (!cancelled) setFormatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);

    try {
      if (tab === 'investigation') {
        const inv = await apiClient.createInvestigation(caseId, { name: trimmed });
        reloadInvestigations();
        closeNewPrimary();
        router.push(`/cases/${caseId}/investigations?inv=${inv.id}`);
      } else {
        const defaultData =
          productionType === 'report' ? { content: '' }
          : productionType === 'chronology' ? { entries: [] }
          : productionType === 'declaration' ? { formatId: declarationFormatId }
          : { chartType: 'bar', labels: [], datasets: [] };
        const prod = await apiClient.createProduction(caseId, {
          name: trimmed,
          type: productionType,
          data: defaultData,
        });
        setProductions((prev) => [...prev, prod]);
        closeNewPrimary();
        router.push(`/cases/${caseId}/productions?id=${prod.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={closeNewPrimary}
      maxWidth="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={closeNewPrimary} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={
              !name.trim() ||
              submitting ||
              (tab === 'production' && productionType === 'declaration' && (formatsLoading || !declarationFormatId))
            }
          >
            {submitting ? 'Creating...' : 'Create'}
          </Button>
        </div>
      }
    >
      {/* Tabs */}
      <div className="-mx-5 -mt-5 mb-5 flex border-b border-line">
        <button
          onClick={() => setTab('investigation')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            tab === 'investigation'
              ? 'text-ink border-b-2 border-brand'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          Investigation
        </button>
        <button
          onClick={() => setTab('production')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            tab === 'production'
              ? 'text-ink border-b-2 border-brand'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          Production
        </button>
      </div>

      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm text-ink-muted mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleSubmit(); }}
            placeholder={tab === 'investigation' ? 'e.g. Funds tracing' : 'e.g. Flow of Funds Report'}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            autoFocus
          />
        </div>

        {/* Production type selector */}
        {tab === 'production' && (
          <div>
            <label className="block text-sm text-ink-muted mb-1.5">Type</label>
            <div className="flex gap-2">
              {(['report', 'chart', 'chronology', 'declaration'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setProductionType(t)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    productionType === t
                      ? 'bg-brand text-white'
                      : 'bg-surface text-ink-muted border border-line-strong hover:bg-surface-raised'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Declaration format selector */}
        {tab === 'production' && productionType === 'declaration' && (
          <Field label="Format">
            <Select
              value={declarationFormatId}
              disabled={formatsLoading || formats.length === 0}
              onChange={(e) => setDeclarationFormatId(e.target.value as DeclarationFormatId)}
            >
              {formatsLoading && <option value="">Loading...</option>}
              {formats.map((format) => (
                <option key={format.id} value={format.id}>
                  {format.label} ({format.jurisdiction})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs text-redline">{error}</p>
        )}
      </div>
    </Modal>
  );
}
