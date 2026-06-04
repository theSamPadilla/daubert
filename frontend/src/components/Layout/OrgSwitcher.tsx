'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaChevronDown, FaBuilding, FaGear } from 'react-icons/fa6';
import { useOrgContext } from '@/contexts/OrgContext';
import { useAuth } from '@/components/Auth/AuthProvider';

export function OrgSwitcher({ variant = 'dark' }: { variant?: 'dark' | 'light' } = {}) {
  const { orgs, activeOrg, setActiveOrgSlug } = useOrgContext();
  const { refreshMe } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isLight = variant === 'light';

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void refreshMe();
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (orgs.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleToggle}
        title={activeOrg?.name ?? 'Select organization'}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
          isLight
            ? 'border-[#E5E7EB] bg-white hover:bg-[#F7F8FB]'
            : 'border-line-strong/60 bg-surface-panel/60 hover:bg-surface-raised hover:border-line-strong'
        }`}
      >
        <FaBuilding className={`w-3.5 h-3.5 ${isLight ? 'text-brand' : 'text-brand-ink'}`} />
        <span className={`text-sm font-medium truncate max-w-[180px] ${isLight ? 'text-[#0B1220]' : 'text-white'}`}>
          {activeOrg?.name ?? 'Select org'}
        </span>
        <FaChevronDown className={`w-3 h-3 ${isLight ? 'text-[#5B6473]' : 'text-ink-muted'}`} />
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-56 bg-surface-panel border border-line-strong rounded-lg shadow-xl z-50 overflow-hidden">
          {orgs.map((org) => {
            const isActive = org.slug === activeOrg?.slug;
            return (
              <div
                key={org.slug}
                className={`flex items-stretch transition-colors ${
                  isActive ? 'bg-surface-raised' : 'hover:bg-surface-raised/60'
                }`}
              >
                <button
                  onClick={() => {
                    setActiveOrgSlug(org.slug);
                    setOpen(false);
                  }}
                  className={`flex-1 min-w-0 text-left pl-3 pr-2 py-2 text-sm truncate transition-colors ${
                    isActive ? 'text-ink font-medium' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {org.name}
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    router.push(`/orgs/${org.slug}/settings`);
                  }}
                  title={`${org.name} settings`}
                  aria-label={`${org.name} settings`}
                  className="px-3 flex items-center text-ink-faint hover:text-ink hover:bg-surface-raised transition-colors"
                >
                  <FaGear className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
