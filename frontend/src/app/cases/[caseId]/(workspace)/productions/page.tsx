'use client';

import { useEffect } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { FaFileLines, FaChartLine, FaTableList, FaFileSignature, FaFilePen } from 'react-icons/fa6';
import { useCaseContext } from '@/contexts/CaseContext';
import { ProductionViewer } from '@/components/Productions/ProductionViewer';
import { PageHeader } from '@/components/Common/PageHeader';
import UserMenu from '@/components/Auth/UserMenu';
import { apiClient, type Production } from '@/lib/api-client';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  report: <FaFileLines className="w-3.5 h-3.5" />,
  chart: <FaChartLine className="w-3.5 h-3.5" />,
  chronology: <FaTableList className="w-3.5 h-3.5" />,
  declaration: <FaFileSignature className="w-3.5 h-3.5" />,
  redline: <FaFilePen className="w-3.5 h-3.5" />,
};

const TYPE_COLORS: Record<string, string> = {
  report: 'bg-brand-soft text-brand',
  chart: 'bg-accent/10 text-accent',
  chronology: 'bg-surface-raised text-ink-muted',
  declaration: 'bg-amber-100 text-amber-700',
  redline: 'bg-redline/10 text-redline',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProductionsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const caseId = params.caseId as string;
  const selectedId = searchParams.get('id');
  const { productions, setProductions, viewerRole } = useCaseContext();
  const canMutate = viewerRole === 'owner' || viewerRole === 'editor';

  const selected = selectedId ? productions.find((p) => p.id === selectedId) ?? null : null;

  // If ?id= doesn't match any production (deleted, stale link), clear it
  useEffect(() => {
    if (selectedId && productions.length > 0 && !selected) {
      router.replace(`/cases/${caseId}/productions`, { scroll: false });
    }
  }, [selectedId, productions, selected, router, caseId]);

  const handleSelect = (prod: Production) => {
    router.push(`/cases/${caseId}/productions?id=${prod.id}`, { scroll: false });
  };

  if (selected) {
    return (
      <ProductionViewer
        production={selected}
        onUpdate={canMutate ? (updated) => {
          setProductions((prev) => prev.map((p) => p.id === updated.id ? updated : p));
        } : undefined}
        onDelete={canMutate ? async () => {
          await apiClient.deleteProduction(selected.id);
          setProductions((prev) => prev.filter((p) => p.id !== selected.id));
          router.replace(`/cases/${caseId}/productions`, { scroll: false });
        } : undefined}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader title="Productions" rightContent={<UserMenu />} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
        {productions.length === 0 ? (
          <div className="rounded-xl bg-surface-panel border border-line p-8 text-center">
            <p className="text-ink-muted text-sm">
              No productions yet. Use the AI assistant to create reports, charts, or chronologies.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {productions.map((prod) => (
              <div
                key={prod.id}
                onClick={() => handleSelect(prod)}
                className="flex items-center gap-4 px-4 py-3 rounded-xl bg-surface-panel border border-line hover:border-line-strong cursor-pointer transition-colors"
              >
                <div className={`p-2 rounded-lg ${TYPE_COLORS[prod.type] || 'bg-surface-raised text-ink-muted'}`}>
                  {TYPE_ICONS[prod.type] || <FaFileLines className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{prod.name}</p>
                  <p className="text-xs text-ink-faint">{prod.type} &middot; {formatDate(prod.updatedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
