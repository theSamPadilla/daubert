'use client';

import { useEffect } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { FaFileLines, FaChartLine, FaTableList } from 'react-icons/fa6';
import { useCaseContext } from '@/contexts/CaseContext';
import { ProductionViewer } from '@/components/ProductionViewer';
import type { Production } from '@/lib/api-client';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  report: <FaFileLines className="w-3.5 h-3.5" />,
  chart: <FaChartLine className="w-3.5 h-3.5" />,
  chronology: <FaTableList className="w-3.5 h-3.5" />,
};

const TYPE_COLORS: Record<string, string> = {
  report: 'bg-blue-900/50 text-blue-300',
  chart: 'bg-green-900/50 text-green-300',
  chronology: 'bg-purple-900/50 text-purple-300',
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
  const { productions, setProductions } = useCaseContext();

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
        onUpdate={(updated) => {
          setProductions((prev) => prev.map((p) => p.id === updated.id ? updated : p));
        }}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Productions</h1>

        {productions.length === 0 ? (
          <div className="rounded-lg bg-gray-800 border border-gray-700 p-8 text-center">
            <p className="text-gray-400 text-sm">
              No productions yet. Use the AI assistant to create reports, charts, or chronologies.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {productions.map((prod) => (
              <div
                key={prod.id}
                onClick={() => handleSelect(prod)}
                className="flex items-center gap-4 px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 cursor-pointer transition-colors"
              >
                <div className={`p-2 rounded ${TYPE_COLORS[prod.type] || 'bg-gray-700 text-gray-300'}`}>
                  {TYPE_ICONS[prod.type] || <FaFileLines className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{prod.name}</p>
                  <p className="text-xs text-gray-500">{prod.type} &middot; {formatDate(prod.updatedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
