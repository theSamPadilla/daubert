'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { AuthGuard } from '@/components/Auth/AuthGuard';
import UserMenu from '@/components/Auth/UserMenu';
import { apiClient, type Case } from '@/lib/api-client';
import { Loader } from '@/components/Common/Loader';

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
    <div className="relative min-h-screen bg-surface text-white overflow-hidden">
      {/* Subtle decorative gradient + watermark */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(900px 500px at 15% -10%, rgba(59, 130, 246, 0.08), transparent 60%), radial-gradient(700px 400px at 95% 110%, rgba(168, 85, 247, 0.06), transparent 60%)',
        }}
      />
      <div className="pointer-events-none absolute -right-24 top-24 -z-10 opacity-[0.035] select-none">
        <Image src="/logo-light.png" alt="" width={520} height={520} priority />
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-line">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo-light.png"
            alt="Daubert"
            width={28}
            height={28}
            priority
            className="opacity-90"
          />
          <h1 className="text-lg font-bold tracking-tight">Daubert</h1>
        </div>
        <UserMenu />
      </header>

      {/* Case grid */}
      <main className="max-w-4xl mx-auto px-6 py-10">
        <h2 className="text-xl font-semibold mb-6">Your Cases</h2>

        {loading ? (
          <Loader inline />
        ) : cases.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-ink-muted">No cases assigned to your account yet.</p>
            <p className="text-ink-faint text-sm mt-2">Contact your administrator to get access to a case.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cases.map((c) => (
              <button
                key={c.id}
                onClick={() => router.push(`/cases/${c.id}/investigations`)}
                className="text-left p-4 bg-surface-panel border border-line-strong rounded-lg hover:border-gray-500 hover:bg-surface-raised/80 transition-colors group"
              >
                <h3 className="font-medium text-white group-hover:text-brand transition-colors">
                  {c.name}
                </h3>
                {c.startDate && (
                  <p className="text-xs text-ink-faint mt-1">
                    Started {new Date(c.startDate).toLocaleDateString()}
                  </p>
                )}
                {c.role && (
                  <span className="inline-block mt-2 text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-ink-muted uppercase tracking-wider">
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
