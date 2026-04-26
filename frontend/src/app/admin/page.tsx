'use client';

import Link from 'next/link';
import { FaUsers, FaFolderOpen, FaTags } from 'react-icons/fa6';
import type { IconType } from 'react-icons';

const CARDS: Array<{ href: string; label: string; description: string; icon: IconType }> = [
  {
    href: '/admin/users',
    label: 'Users',
    description: 'Create user shells, list members, hard-delete accounts.',
    icon: FaUsers,
  },
  {
    href: '/admin/cases',
    label: 'Cases',
    description: 'Create cases, assign owners and guests, change roles.',
    icon: FaFolderOpen,
  },
  {
    href: '/admin/entities',
    label: 'Entities',
    description: 'Manage the labeled-entity registry surfaced in the graph.',
    icon: FaTags,
  },
];

export default function AdminHomePage() {
  return (
    <div className="p-8">
      <h1 className="mb-2 text-2xl font-bold text-white">Admin</h1>
      <p className="mb-8 text-sm text-gray-400">
        Internal admin management dashboard.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-lg border border-gray-700 bg-gray-800/50 p-5 transition-colors hover:border-blue-500 hover:bg-gray-800"
            >
              <div className="mb-3 flex items-center gap-3">
                <Icon className="h-5 w-5 text-blue-400" />
                <h2 className="text-lg font-semibold text-white">{card.label}</h2>
              </div>
              <p className="text-sm text-gray-400">{card.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
