'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { FaArrowLeft } from 'react-icons/fa6';
import { useAuth } from '@/components/Auth/AuthProvider';
import { Kicker } from '@/components/ui/Kicker';

const TABS = [
  { href: 'settings', label: 'Settings', adminOnly: false },
  { href: 'declarants', label: 'Declarants', adminOnly: false },
  { href: 'library', label: 'Library', adminOnly: false },
  { href: 'cases', label: 'Cases', adminOnly: true },
];

export default function OrgWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const pathname = usePathname();
  const { user } = useAuth();
  const orgForThisPage = user?.orgs.find((o) => o.slug === orgSlug);
  const isAdmin = orgForThisPage?.role === 'admin';
  const orgName = orgForThisPage?.name;

  return (
    <main className="relative max-w-3xl mx-auto px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors mb-8"
      >
        <FaArrowLeft size={10} />
        Back to cases
      </Link>

      <div className="mb-8">
        <Kicker className="block mb-3">Organization</Kicker>
        <h2 className="mt-1 text-3xl font-bold tracking-tight text-ink">
          {orgName ?? 'Organization'}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Manage {orgName ? <span className="text-ink font-medium">{orgName}</span> : 'your organization'}
          &apos;s profile, members, declarants, and library.
        </p>
      </div>

      <nav className="flex items-center gap-1 border-b border-line mb-8">
        {TABS.filter((tab) => !tab.adminOnly || isAdmin).map((tab) => {
          const href = `/orgs/${orgSlug}/${tab.href}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={tab.href}
              href={href}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-brand text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </main>
  );
}
