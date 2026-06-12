'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { SuperAdminGuard } from '@/components/Auth/SuperAdminGuard';
import UserMenu from '@/components/Auth/UserMenu';
import { FaUsers, FaFolderOpen, FaTags, FaArrowLeft, FaBuilding, FaChartLine } from 'react-icons/fa6';

const NAV = [
  { href: '/superadmin/orgs', label: 'Orgs', icon: FaBuilding, exact: false },
  { href: '/superadmin/users', label: 'Users', icon: FaUsers, exact: false },
  { href: '/superadmin/cases', label: 'Cases', icon: FaFolderOpen, exact: false },
  { href: '/superadmin/entities', label: 'Entities', icon: FaTags, exact: false },
  { href: '/superadmin/token-usage', label: 'Token Usage', icon: FaChartLine, exact: false },
];

function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="relative z-10 flex w-56 shrink-0 flex-col bg-surface-panel border-r border-line px-3 py-6">
      <Link
        href="/"
        className="mb-6 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
      >
        <FaArrowLeft className="h-3 w-3" />
        Back to Cases
      </Link>

      <h2 className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
        Superadmin
      </h2>
      <ul className="space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-brand-soft text-brand border border-brand/20'
                    : 'text-ink-muted border border-transparent hover:bg-surface-raised hover:text-ink'
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

export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SuperAdminGuard>
      <div className="relative min-h-screen bg-surface-panel text-ink overflow-hidden">
        {/* Header */}
        <header className="relative z-10 bg-surface border-b border-line h-14 px-5 flex items-center justify-between shrink-0">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <Image src="/logo.png" alt="Daubert" width={26} height={26} priority />
            <h1 className="text-base font-semibold tracking-tight text-ink">Daubert</h1>
          </Link>
          <UserMenu />
        </header>

        <div className="flex">
          <Sidebar />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </div>
    </SuperAdminGuard>
  );
}
