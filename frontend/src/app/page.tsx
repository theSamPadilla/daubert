'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { AuthGuard } from '@/components/Auth/AuthGuard';
import UserMenu from '@/components/Auth/UserMenu';
import { AgentStatusButton } from '@/components/Agents/AgentStatusButton';
import { useOrgContext } from '@/contexts/OrgContext';
import { OrgSwitcher } from '@/components/Layout/OrgSwitcher';
import { apiClient, type Case } from '@/lib/api-client';
import { Loader } from '@/components/Common/Loader';
import { NewCaseModal } from '@/components/Cases/NewCaseModal';
import { Badge, Button, Kicker } from '@/components/ui';
import { FaBuilding, FaGear, FaLock, FaPlus } from 'react-icons/fa6';

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
      ? allCases.filter((c) => c.orgId === activeOrg.id)
      : allCases;

  return (
    <div className="relative min-h-screen bg-surface overflow-hidden">
      {/* Sticky top nav — website nav pattern */}
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-md border-b border-line h-14 px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <Image
              src="/logo.png"
              alt="Daubert"
              width={26}
              height={26}
              priority
            />
            <h1 className="text-base font-semibold tracking-tight text-ink">Daubert</h1>
          </Link>
          <OrgSwitcher />
        </div>
        <div className="flex items-center gap-3">
          <AgentStatusButton />
          <UserMenu />
        </div>
      </header>

      {/* Case grid */}
      <main className="relative max-w-5xl mx-auto px-6 py-14">
        {activeOrg && (
          <div className="mb-8 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3">
            <Link
              href={`/orgs/${activeOrg.slug}/declarations`}
              className="group flex min-w-0 items-center gap-2.5"
            >
              <FaBuilding className="h-3.5 w-3.5 shrink-0 text-brand" />
              <span className="truncate text-sm font-medium text-ink transition-colors group-hover:text-brand">
                {activeOrg.name}
              </span>
            </Link>
            <nav className="flex shrink-0 items-center gap-4">
              <Link
                href={`/orgs/${activeOrg.slug}/declarations`}
                className="text-sm text-ink-muted transition-colors hover:text-ink"
              >
                Declarations
              </Link>
              <Link
                href={`/orgs/${activeOrg.slug}/files`}
                className="text-sm text-ink-muted transition-colors hover:text-ink"
              >
                Files
              </Link>
              <Link
                href={`/orgs/${activeOrg.slug}/settings`}
                className="text-sm text-ink-muted transition-colors hover:text-ink"
              >
                Members
              </Link>
            </nav>
          </div>
        )}
        <div className="mb-10">
          <Kicker className="block mb-3">Workspace</Kicker>
          <h2 className="text-4xl font-bold tracking-tight text-ink">
            Your{' '}
            <span className="bg-gradient-to-r from-brand to-accent bg-clip-text text-transparent">
              cases
            </span>
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
              const hasAccess = !!c.role;
              const canAccessSettings = c.role === 'owner' || c.role === 'editor';
              const isOwner = c.role === 'owner';

              if (!hasAccess) {
                return (
                  <div
                    key={c.id}
                    title="You're not a member of this case. Ask an org admin to add you."
                    className="relative p-5 min-h-[128px] rounded-xl
                      bg-surface-panel border border-dashed border-line
                      cursor-not-allowed overflow-hidden opacity-60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold text-base text-ink-muted line-clamp-1 flex-1">
                        {c.name}
                      </h3>
                      <span
                        className="flex-shrink-0 w-7 h-7 rounded-md bg-surface border border-line flex items-center justify-center"
                        aria-label="Locked"
                      >
                        <FaLock size={10} className="text-ink-faint" />
                      </span>
                    </div>
                    {c.summary && (
                      <p className="text-sm text-ink-faint mt-2 line-clamp-2 leading-relaxed">
                        {c.summary}
                      </p>
                    )}
                    <p className="text-[11px] text-ink-faint mt-3 italic">
                      Not a case member. Ask an admin to add you.
                    </p>
                  </div>
                );
              }

              return (
                <div key={c.id} className="relative group">
                  <button
                    onClick={() => router.push(`/cases/${c.id}/investigations`)}
                    className="w-full text-left p-5 min-h-[128px] rounded-xl
                      bg-surface border border-line
                      hover:border-line-strong hover:-translate-y-0.5
                      hover:shadow-[0_24px_60px_-30px_rgba(11,18,32,0.18)]
                      transition-all duration-200 relative overflow-hidden
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <div className="flex items-start justify-between gap-3 pr-7">
                      <h3 className="text-[15px] font-medium text-ink line-clamp-1 flex-1">
                        {c.name}
                      </h3>
                      <Badge tone={isOwner ? 'brand' : 'neutral'} className="flex-shrink-0 uppercase">
                        {c.role}
                      </Badge>
                    </div>
                    {c.summary && (
                      <p className="text-sm text-ink-muted mt-2 line-clamp-2 leading-relaxed">
                        {c.summary}
                      </p>
                    )}
                    <p className="font-mono text-[11px] text-ink-faint mt-3">
                      {c.id.slice(0, 8)}
                    </p>
                  </button>
                  {canAccessSettings && (
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(`/cases/${c.id}/settings`); }}
                      title="Case settings"
                      className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center text-ink-faint hover:text-ink opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      <FaGear size={13} />
                    </button>
                  )}
                </div>
              );
            })}
            {canCreate && (
              <Button
                variant="secondary"
                onClick={() => setNewCaseOpen(true)}
                className="group flex-col gap-2 min-h-[128px] rounded-xl border-dashed hover:border-brand/40 hover:bg-brand-soft"
              >
                <div className="w-10 h-10 rounded-full bg-surface-raised group-hover:bg-brand/10 flex items-center justify-center transition-colors">
                  <FaPlus size={16} className="text-ink-muted group-hover:text-brand" />
                </div>
                <span className="text-sm font-medium text-ink-muted group-hover:text-brand transition-colors">New case</span>
                <span className="text-xs text-ink-faint">Start a new investigation</span>
              </Button>
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
