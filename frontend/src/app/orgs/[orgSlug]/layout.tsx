'use client';

import Link from 'next/link';
import Image from 'next/image';
import { AuthGuard } from '@/components/Auth/AuthGuard';
import { RequireOrgRole } from '@/components/Auth/RequireOrgRole';
import UserMenu from '@/components/Auth/UserMenu';
import { OrgSwitcher } from '@/components/Layout/OrgSwitcher';

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <RequireOrgRole minRole="member">
        <div className="relative min-h-screen bg-surface bg-noise text-white overflow-hidden">
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

          {children}
        </div>
      </RequireOrgRole>
    </AuthGuard>
  );
}
