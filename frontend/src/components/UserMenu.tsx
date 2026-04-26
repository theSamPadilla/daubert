'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { FaChevronDown, FaGear } from 'react-icons/fa6';
import { ADMIN_EMAIL_DOMAIN } from '@/lib/admin';

export default function UserMenu() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isAdmin = user?.email?.split('@')[1] === ADMIN_EMAIL_DOMAIN;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name}
            className="w-7 h-7 rounded-full"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-medium">
            {initials}
          </div>
        )}
        <span className="text-sm text-gray-300 hidden sm:inline">{user.name}</span>
        <FaChevronDown className="w-3 h-3 text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
          <div className="px-3 py-2 border-b border-gray-700">
            <p className="text-sm font-medium text-white truncate">{user.name}</p>
            <p className="text-xs text-gray-400 truncate">{user.email}</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setOpen(false); router.push('/admin/entities'); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              <FaGear className="w-3 h-3 text-gray-500" />
              Admin
            </button>
          )}
          <button
            onClick={() => { setOpen(false); signOut(); }}
            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-b-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
