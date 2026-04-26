'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AdminGuard } from '@/components/AdminGuard';
import { FaUsers, FaFolderOpen, FaTags, FaHouse, FaArrowLeft } from 'react-icons/fa6';

const NAV = [
  { href: '/admin', label: 'Home', icon: FaHouse, exact: true },
  { href: '/admin/users', label: 'Users', icon: FaUsers, exact: false },
  { href: '/admin/cases', label: 'Cases', icon: FaFolderOpen, exact: false },
  { href: '/admin/entities', label: 'Entities', icon: FaTags, exact: false },
];

function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-gray-700 bg-gray-900 px-3 py-6">
      <Link
        href="/"
        className="mb-6 flex items-center gap-2 rounded px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
      >
        <FaArrowLeft className="h-3.5 w-3.5" />
        Back to Cases
      </Link>

      <h2 className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Admin
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
                className={`flex items-center gap-2 rounded px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-blue-900/40 text-blue-200'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
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

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <div className="flex min-h-screen bg-gray-900">
        <Sidebar />
        <div className="flex-1">{children}</div>
      </div>
    </AdminGuard>
  );
}
