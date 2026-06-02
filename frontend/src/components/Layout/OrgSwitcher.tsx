'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaChevronDown, FaBuilding, FaGear } from 'react-icons/fa6';
import { useOrgContext } from '@/contexts/OrgContext';

export function OrgSwitcher({ variant = 'dark' }: { variant?: 'dark' | 'light' } = {}) {
  const { orgs, activeOrg, setActiveOrgSlug } = useOrgContext();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isLight = variant === 'light';

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
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-2 py-1 rounded transition-colors ${
          isLight ? 'hover:bg-[#F1F4FA]' : 'hover:bg-surface-raised'
        }`}
      >
        <FaBuilding className={`w-3.5 h-3.5 ${isLight ? 'text-[#5B6473]' : 'text-ink-muted'}`} />
        <span className={`text-sm truncate max-w-[160px] ${isLight ? 'text-[#0B1220]' : 'text-ink'}`}>
          {activeOrg?.name ?? 'Select org'}
        </span>
        <FaChevronDown className={`w-3 h-3 ${isLight ? 'text-[#5B6473]' : 'text-ink-muted'}`} />
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-56 bg-surface-panel border border-line-strong rounded-lg shadow-xl z-50">
          {orgs.map((org) => (
            <button
              key={org.slug}
              onClick={() => {
                setActiveOrgSlug(org.slug);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors first:rounded-t-lg flex items-center gap-2 ${
                org.slug === activeOrg?.slug
                  ? 'bg-surface-raised text-ink font-medium'
                  : 'text-ink-muted hover:bg-surface-raised'
              }`}
            >
              <FaBuilding className="w-3 h-3 text-ink-faint shrink-0" />
              <span className="truncate">{org.name}</span>
            </button>
          ))}
          {activeOrg && (
            <button
              onClick={() => {
                setOpen(false);
                router.push(`/orgs/${activeOrg.slug}/settings`);
              }}
              className="w-full text-left px-3 py-2 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink transition-colors rounded-b-lg flex items-center gap-2 border-t border-line-strong"
            >
              <FaGear className="w-3 h-3 text-ink-faint shrink-0" />
              <span className="truncate">{activeOrg.name} settings</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
