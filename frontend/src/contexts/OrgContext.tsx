'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from '@/components/Auth/AuthProvider';
import type { OrgMemberRole } from '@/lib/api-client';

interface OrgEntry {
  id: string;
  slug: string;
  name: string;
  role: OrgMemberRole;
}

interface OrgContextValue {
  orgs: OrgEntry[];
  activeOrgSlug: string | null;
  setActiveOrgSlug: (slug: string | null) => void;
  activeOrg: OrgEntry | null;
}

const LS_KEY = 'daubert-active-org-slug';

const OrgContext = createContext<OrgContextValue>({
  orgs: [],
  activeOrgSlug: null,
  setActiveOrgSlug: () => {},
  activeOrg: null,
});

export function useOrgContext(): OrgContextValue {
  return useContext(OrgContext);
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const orgs: OrgEntry[] = user?.orgs ?? [];

  const [activeOrgSlug, setActiveOrgSlugState] = useState<string | null>(() => {
    // Initializer runs only on the client (this is a 'use client' component).
    // On SSR the closure will not run, but Next.js hydration will re-run it client-side.
    if (typeof window === 'undefined') return null;
    const persisted = localStorage.getItem(LS_KEY);
    return persisted ?? null;
  });

  // When the user's org list changes, reconcile the active slug.
  useEffect(() => {
    if (orgs.length === 0) {
      setActiveOrgSlugState(null);
      return;
    }
    const persisted = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (persisted && orgs.some((o) => o.slug === persisted)) {
      setActiveOrgSlugState(persisted);
    } else {
      // Persisted slug no longer in orgs (e.g., removed from org); fall back to first.
      setActiveOrgSlugState(orgs[0].slug);
    }
  }, [user]);

  const setActiveOrgSlug = (slug: string | null) => {
    setActiveOrgSlugState(slug);
    if (typeof window !== 'undefined') {
      if (slug === null) {
        localStorage.removeItem(LS_KEY);
      } else {
        localStorage.setItem(LS_KEY, slug);
      }
    }
  };

  const activeOrg = activeOrgSlug ? (orgs.find((o) => o.slug === activeOrgSlug) ?? null) : null;

  return (
    <OrgContext.Provider value={{ orgs, activeOrgSlug, setActiveOrgSlug, activeOrg }}>
      {children}
    </OrgContext.Provider>
  );
}
