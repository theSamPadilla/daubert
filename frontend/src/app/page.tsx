'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/AuthGuard';
import UserMenu from '@/components/UserMenu';
import { apiClient, type Case } from '@/lib/api-client';
import { Loader } from '@/components/Loader';

function CaseSelector() {
  const router = useRouter();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.listCases().then((data) => {
      setCases(data);
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to load cases:', err);
      setLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-bold">Daubert</h1>
        <UserMenu />
      </header>

      {/* Case grid */}
      <main className="max-w-4xl mx-auto px-6 py-10">
        <h2 className="text-xl font-semibold mb-6">Your Cases</h2>

        {loading ? (
          <Loader inline />
        ) : cases.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No cases assigned to your account yet.</p>
            <p className="text-gray-500 text-sm mt-2">Contact your administrator to get access to a case.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cases.map((c) => (
              <button
                key={c.id}
                onClick={() => router.push(`/cases/${c.id}/investigations`)}
                className="text-left p-4 bg-gray-800 border border-gray-700 rounded-lg hover:border-gray-500 hover:bg-gray-750 transition-colors group"
              >
                <h3 className="font-medium text-white group-hover:text-blue-300 transition-colors">
                  {c.name}
                </h3>
                {c.startDate && (
                  <p className="text-xs text-gray-500 mt-1">
                    Started {new Date(c.startDate).toLocaleDateString()}
                  </p>
                )}
                {c.role && (
                  <span className="inline-block mt-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 uppercase tracking-wider">
                    {c.role}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <AuthGuard>
      <CaseSelector />
    </AuthGuard>
  );
}
