'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaRegFileWord, FaRegFilePdf, FaFilePen } from 'react-icons/fa6';
import type { components } from '@/generated/api-types';
import { apiClient, type DeclarationFormat, type DataRoomFile } from '@/lib/api-client';
import { useCaseContext } from '@/contexts/CaseContext';
import { Modal, Button, Field, Select } from '@/components/ui';

type PrimaryType = 'investigation' | 'production';
type ProductionType = 'report' | 'chart' | 'chronology' | 'declaration' | 'redline';
type DeclarationFormatId = components['schemas']['DeclarationFormatId'];

// Mirrors backend DOCX_MIME (backend/src/modules/data-room/data-room.service.ts)
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

function formatBytes(raw: string | undefined): string {
  if (!raw) return '—';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function NewPrimaryModal() {
  const router = useRouter();
  const { caseId, newPrimaryDefault, closeNewPrimary, setProductions, reloadInvestigations } = useCaseContext();

  const [tab, setTab] = useState<PrimaryType>(newPrimaryDefault);
  const [name, setName] = useState('');
  const [productionType, setProductionType] = useState<ProductionType>('report');
  const [declarationFormatId, setDeclarationFormatId] = useState<DeclarationFormatId>('ca-declaration');
  const [formats, setFormats] = useState<DeclarationFormat[]>([]);
  const [formatsLoading, setFormatsLoading] = useState(true);
  const [sourceFiles, setSourceFiles] = useState<DataRoomFile[]>([]);
  const [sourceFilesLoading, setSourceFilesLoading] = useState(false);
  const [sourceFilesLoaded, setSourceFilesLoaded] = useState(false);
  const [sourceFileId, setSourceFileId] = useState<string | null>(null);
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

  // On entering redline mode, fetch the data room's docx/pdf files once.
  useEffect(() => {
    if (productionType !== 'redline' || sourceFilesLoaded) return;
    let cancelled = false;
    setSourceFilesLoading(true);
    apiClient
      .dataRoomListFiles(caseId)
      .then((files) => {
        if (cancelled) return;
        setSourceFiles(files.filter((f) => f.mimeType === DOCX_MIME || f.mimeType === PDF_MIME));
      })
      .catch((err) => console.error('Failed to load data room files:', err))
      .finally(() => {
        if (!cancelled) {
          setSourceFilesLoading(false);
          setSourceFilesLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [productionType, caseId, sourceFilesLoaded]);

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
          : productionType === 'redline' ? { sourceFileId }
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
              (tab === 'production' && productionType === 'declaration' && (formatsLoading || !declarationFormatId)) ||
              (tab === 'production' && productionType === 'redline' && (sourceFilesLoading || !sourceFileId))
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
              {(['report', 'chart', 'chronology', 'declaration', 'redline'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setProductionType(t)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                    productionType === t
                      ? 'bg-brand text-white'
                      : 'bg-surface text-ink-muted border border-line-strong hover:bg-surface-raised'
                  }`}
                >
                  {t === 'redline' && <FaFilePen className="w-3 h-3" />}
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

        {/* Redline source file picker */}
        {tab === 'production' && productionType === 'redline' && (
          <div>
            <label className="block text-sm text-ink-muted mb-1.5">Source file</label>
            {sourceFilesLoading ? (
              <p className="text-xs text-ink-faint py-2">Loading data room files...</p>
            ) : sourceFiles.length === 0 ? (
              <p className="text-xs text-ink-faint italic py-2">
                No .docx or .pdf files in the data room yet — upload the draft first.
              </p>
            ) : (
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {sourceFiles.map((file) => {
                  const isDocx = file.mimeType === DOCX_MIME;
                  const isSelected = file.id === sourceFileId;
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => setSourceFileId(file.id)}
                      className={`w-full flex items-center gap-2.5 text-left rounded-md border px-3 py-2 transition-colors ${
                        isSelected
                          ? 'border-brand bg-brand-soft'
                          : 'border-line-strong bg-surface hover:bg-surface-raised'
                      }`}
                    >
                      {isDocx ? (
                        <FaRegFileWord className="w-4 h-4 text-ink-faint shrink-0" />
                      ) : (
                        <FaRegFilePdf className="w-4 h-4 text-ink-faint shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink truncate">{file.name}</p>
                        <p className="text-[11px] text-ink-faint">
                          {formatBytes(file.size)} &middot;{' '}
                          {isDocx ? 'DOCX — tracked-changes export' : 'PDF — reconstructed redline'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs text-redline">{error}</p>
        )}
      </div>
    </Modal>
  );
}
