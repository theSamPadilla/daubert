'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useParams, usePathname } from 'next/navigation';
import { AuthGuard } from '@/components/Auth/AuthGuard';
import { RequireOrgRole } from '@/components/Auth/RequireOrgRole';
import UserMenu from '@/components/Auth/UserMenu';
import { OrgSwitcher } from '@/components/Layout/OrgSwitcher';
import { FaGear, FaArrowLeft } from 'react-icons/fa6';

const NAV = [
  { href: 'settings', label: 'Settings', icon: FaGear },
];

function OrgSidebar({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-line-strong bg-surface px-3 py-6">
      <Link
        href="/"
        className="mb-6 flex items-center gap-2 rounded px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-panel hover:text-gray-200"
      >
        <FaArrowLeft className="h-3.5 w-3.5" />
        Back to Cases
      </Link>

      <h2 className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">
        Organization
      </h2>
      <ul className="space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const fullHref = `/orgs/${orgSlug}/${item.href}`;
          const active = pathname === fullHref || pathname.startsWith(fullHref + '/');
          return (
            <li key={item.href}>
              <Link
                href={fullHref}
                className={`flex items-center gap-2 rounded px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-blue-900/40 text-blue-200'
                    : 'text-ink-muted hover:bg-surface-panel hover:text-gray-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  return (
    <AuthGuard>
      <RequireOrgRole minRole="member">
        <div className="flex min-h-screen flex-col bg-surface">
          <header className="bg-[#F7F8FB] border-b border-[#E5E7EB] h-12 px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Image src="/logo.png" alt="Daubert" width={22} height={22} />
                <span className="text-[15px] font-semibold tracking-tight text-[#0B1220]">Daubert</span>
              </Link>
              <OrgSwitcher variant="light" />
            </div>
            <UserMenu variant="light" />
          </header>
          <div className="flex flex-1">
            <OrgSidebar orgSlug={orgSlug} />
            <div className="flex-1">{children}</div>
          </div>
        </div>
      </RequireOrgRole>
    </AuthGuard>
  );
}
