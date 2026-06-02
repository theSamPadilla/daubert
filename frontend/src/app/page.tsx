'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { AuthGuard } from '@/components/Auth/AuthGuard';
import UserMenu from '@/components/Auth/UserMenu';
import { useOrgContext } from '@/contexts/OrgContext';
import { OrgSwitcher } from '@/components/Layout/OrgSwitcher';
import { apiClient, type Case } from '@/lib/api-client';
import { Loader } from '@/components/Common/Loader';
import { NewCaseModal } from '@/components/Cases/NewCaseModal';
import { FaGear, FaPlus } from 'react-icons/fa6';

function CaseSelector() {
  const router = useRouter();
  const { activeOrg, activeOrgSlug } = useOrgContext();
  const canCreate = activeOrg?.role === 'admin' || activeOrg?.role === 'member';
  const [allCases, setAllCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  useEffect(() => {
    apiClient.listCases().then((data) => {
      setAllCases(data);
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to load cases:', err);
      setLoading(false);
    });
  }, []);

  const cases =
    activeOrgSlug !== null && activeOrg
      ? allCases.filter((c) => (c as any).orgId === activeOrg.id)
      : allCases;

  return (
    <div className="relative min-h-screen bg-surface bg-hero-dark text-white overflow-hidden">
      <div className="pointer-events-none absolute -right-32 top-16 -z-10 opacity-[0.06] select-none">
        <Image src="/logo-light.png" alt="" width={720} height={720} priority />
      </div>

      {/* Header */}
      <header className="bg-[#F7F8FB] border-b border-[#E5E7EB] h-12 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Image
              src="/logo.png"
              alt="Daubert"
              width={22}
              height={22}
              priority
            />
            <h1 className="text-[15px] font-semibold tracking-tight text-[#0B1220]">Daubert</h1>
          </Link>
          <OrgSwitcher variant="light" />
        </div>
        <UserMenu variant="light" />
      </header>

      {/* Case grid */}
      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand">
            Workspace
          </span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Your cases
          </h2>
          {!loading && (
            <p className="mt-2 text-sm text-ink-muted">
              {cases.length === 0
                ? canCreate
                  ? 'Start a new investigation.'
                  : 'No cases assigned yet.'
                : `${cases.length} active ${cases.length === 1 ? 'investigation' : 'investigations'}`}
            </p>
          )}
        </div>

        {loading ? (
          <Loader inline />
        ) : cases.length === 0 && !canCreate ? (
          <div className="text-center py-24 max-w-md mx-auto">
            <p className="text-base text-ink-muted">No cases assigned to your account yet.</p>
            <p className="text-sm text-ink-faint mt-2">Contact your administrator to get access.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cases.map((c) => {
              const canAccessSettings = c.role === 'owner' || c.role === 'editor';
              return (
                <div key={c.id} className="relative group">
                  <button
                    onClick={() => router.push(`/cases/${c.id}/investigations`)}
                    className="w-full text-left p-5 bg-surface-panel border border-line-strong/50 rounded-lg hover:border-brand/40 hover:bg-surface-raised/60 hover:-translate-y-px hover:shadow-lg hover:shadow-brand/5 transition-all duration-150"
                  >
                    <h3 className="font-medium text-white group-hover:text-brand transition-colors pr-7">
                      {c.name}
                    </h3>
                    {c.summary && (
                      <p className="text-xs text-ink-faint mt-1 line-clamp-2">
                        {c.summary}
                      </p>
                    )}
                    {c.role && (
                      <span className="inline-block mt-2 text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-ink-muted uppercase tracking-wider">
                        {c.role}
                      </span>
                    )}
                  </button>
                  {canAccessSettings && (
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(`/cases/${c.id}/settings`); }}
                      title="Case settings"
                      className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center text-ink-faint hover:text-ink opacity-0 group-hover:opacity-100 transition-all rounded"
                    >
                      <FaGear size={13} />
                    </button>
                  )}
                </div>
              );
            })}
            {canCreate && (
              <button
                onClick={() => setNewCaseOpen(true)}
                className="flex flex-col items-center justify-center gap-1.5 p-5 h-full min-h-[100px] bg-surface-panel/60 border border-dashed border-brand/25 rounded-lg hover:border-brand/60 hover:bg-brand/5 transition-colors text-ink-muted hover:text-brand"
              >
                <FaPlus size={22} />
                <span className="text-sm font-medium">New case</span>
                <span className="text-xs text-ink-faint">Start a new investigation</span>
              </button>
            )}
          </div>
        )}
      </main>

      <NewCaseModal
        open={newCaseOpen && !!activeOrg}
        orgId={activeOrg?.id ?? ''}
        onClose={() => setNewCaseOpen(false)}
        onCreated={(created /*, results */) => router.push(`/cases/${created.id}/investigations`)}
      />
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
