'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { FaChevronDown, FaGear } from 'react-icons/fa6';

export default function UserMenu({ variant = 'dark' }: { variant?: 'dark' | 'light' } = {}) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isAdmin = user?.orgRole === 'admin';

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
        className={`flex items-center gap-2 px-2 py-1 rounded transition-colors ${
          variant === 'light'
            ? 'hover:bg-[#F1F4FA]'
            : 'hover:bg-surface-raised'
        }`}
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name}
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-full"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-xs font-medium">
            {initials}
          </div>
        )}
        <span className={`text-sm hidden sm:inline ${variant === 'light' ? 'text-[#0B1220]' : 'text-ink-muted'}`}>{user.name}</span>
        <FaChevronDown className={`w-3 h-3 ${variant === 'light' ? 'text-[#5B6473]' : 'text-ink-muted'}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-surface-panel border border-line-strong rounded-lg shadow-xl z-50">
          <div className="px-3 py-2 border-b border-line-strong">
            <p className="text-sm font-medium text-ink truncate">{user.name}</p>
            <p className="text-xs text-ink-muted truncate">{user.email}</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setOpen(false); router.push('/admin/entities'); }}
              className="w-full text-left px-3 py-2 text-sm text-ink-muted hover:bg-surface-raised transition-colors flex items-center gap-2"
            >
              <FaGear className="w-3 h-3 text-ink-faint" />
              Admin
            </button>
          )}
          <button
            onClick={() => { setOpen(false); signOut(); }}
            className="w-full text-left px-3 py-2 text-sm text-ink-muted hover:bg-surface-raised rounded-b-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
