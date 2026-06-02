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
      {/* faint grid overlay — adds texture without competing with content */}
      <div className="pointer-events-none absolute inset-0 bg-grid-faint -z-10" />
      <div className="pointer-events-none absolute -right-32 top-16 -z-10 opacity-[0.06] select-none">
        <Image src="/logo-light.png" alt="" width={720} height={720} priority />
      </div>

      {/* Header */}
      <header className="relative z-10 bg-surface-panel/70 backdrop-blur-md border-b border-line/60 h-14 px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <Image
              src="/logo-light.png"
              alt="Daubert"
              width={26}
              height={26}
              priority
            />
            <h1 className="text-base font-semibold tracking-tight text-white">Daubert</h1>
          </Link>
          <OrgSwitcher />
        </div>
        <UserMenu />
      </header>

      {/* Case grid */}
      <main className="relative max-w-5xl mx-auto px-6 py-14">
        <div className="mb-10">
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-gradient-to-r from-brand to-transparent" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              Workspace
            </span>
          </div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-white">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {cases.map((c) => {
              const canAccessSettings = c.role === 'owner' || c.role === 'editor';
              const isOwner = c.role === 'owner';
              return (
                <div key={c.id} className="relative group">
                  <button
                    onClick={() => router.push(`/cases/${c.id}/investigations`)}
                    className="w-full text-left p-5 min-h-[128px] rounded-xl
                      bg-surface-panel border border-line-strong/60
                      shadow-[0_2px_12px_rgba(0,0,0,0.35)]
                      hover:bg-surface-raised hover:border-brand/50
                      hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(84,104,198,0.22)]
                      transition-all duration-200 relative overflow-hidden"
                  >
                    {/* subtle top inner-highlight to give the card a raised edge */}
                    <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />

                    <div className="flex items-start justify-between gap-3 pr-7">
                      <h3 className="font-semibold text-base text-white group-hover:text-brand transition-colors line-clamp-1 flex-1">
                        {c.name}
                      </h3>
                      {c.role && (
                        <span
                          className={
                            'text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold flex-shrink-0 ' +
                            (isOwner
                              ? 'bg-brand text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]'
                              : 'bg-surface text-ink-muted border border-line-strong')
                          }
                        >
                          {c.role}
                        </span>
                      )}
                    </div>
                    {c.summary && (
                      <p className="text-sm text-ink-muted mt-2 line-clamp-2 leading-relaxed">
                        {c.summary}
                      </p>
                    )}
                  </button>
                  {canAccessSettings && (
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(`/cases/${c.id}/settings`); }}
                      title="Case settings"
                      className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center text-ink-faint hover:text-white opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-white/5"
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
                className="group flex flex-col items-center justify-center gap-2 p-5 min-h-[128px] rounded-xl border-2 border-dashed border-line-strong/70 hover:border-brand/60 hover:bg-brand/5 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-brand/10 group-hover:bg-brand/20 flex items-center justify-center transition-colors">
                  <FaPlus size={16} className="text-brand" />
                </div>
                <span className="text-sm font-medium text-ink group-hover:text-white transition-colors">New case</span>
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
