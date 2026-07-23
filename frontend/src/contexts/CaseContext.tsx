'use client';

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { ReactNode, Dispatch, SetStateAction } from 'react';
import { apiClient, type Investigation as ApiInvestigation, type ScriptRun, type Production, type CaseRole } from '@/lib/api-client';
import type { Trace } from '@/types/investigation';
import { useAuth } from '@/components/Auth/AuthProvider';

/**
 * Data that the sidebar needs from whichever page is active.
 * Pages call `updateSidebar(...)` to push their data here.
 * Undefined callbacks mean the sidebar disables the corresponding UI.
 */
interface SidebarSlice {
  activeInvestigationId: string | null;
  traces?: Trace[];
  selectedTraceId?: string;
  onAddTrace?: () => void;
  onSelectTrace?: (trace: Trace) => void;
  onToggleVisibility?: (traceId: string) => void;
  onToggleCollapsed?: (traceId: string) => void;
  scriptRuns?: ScriptRun[];
  selectedScriptRunId?: string;
  onSelectScriptRun?: (run: ScriptRun) => void;
  onEditInvestigation?: (inv: ApiInvestigation) => void;
}

const EMPTY_SIDEBAR: SidebarSlice = {
  activeInvestigationId: null,
};

export interface CaseContextValue {
  caseId: string;
  /** Owning org id for this case (from getCase). Null until loaded. */
  orgId: string | null;

  // --- Sidebar data (pages push into this) ---
  sidebar: SidebarSlice;
  updateSidebar: (partial: Partial<SidebarSlice>) => void;

  // --- Layout chrome ---
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  sidebarWidth: number;
  setSidebarWidth: (w: number | ((prev: number) => number)) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  chatWidth: number;
  setChatWidth: (w: number | ((prev: number) => number)) => void;

  // --- Productions (fetched by provider, shared across all pages) ---
  productions: Production[];
  setProductions: Dispatch<SetStateAction<Production[]>>;

  // --- Investigations list refresh (sidebar watches this) ---
  investigationsVersion: number;
  reloadInvestigations: () => void;

  // --- New Primary modal ---
  newPrimaryOpen: boolean;
  newPrimaryDefault: 'investigation' | 'production';
  openNewPrimary: (defaultType?: 'investigation' | 'production') => void;
  closeNewPrimary: () => void;

  // --- Viewer role ---
  viewerRole: CaseRole | null;

  // --- Case metadata (fetched by provider) ---
  caseSummary: string | null;
  caseInvestigations: ApiInvestigation[] | null;
  refreshCase: () => void;

  // --- Org resolution (derived from viewer's org memberships, never a globally active org) ---
  orgSlug: string | null;
  isOrgAdmin: boolean;

  // --- Chat prompt injection ---
  pendingChatPrompt: string | null;
  requestChatPrompt: (prompt: string) => void;
  consumeChatPrompt: () => void;

  // --- Chat needs these ---
  activeInvestigationId: string | null;
  onGraphUpdated?: () => void;
  setOnGraphUpdated: (fn: (() => void) | undefined) => void;
  onProductionUpdated: () => void;
}

const CaseContext = createContext<CaseContextValue | null>(null);

export function CaseProvider({ caseId, children }: { caseId: string; children: ReactNode }) {
  const { user } = useAuth();
  const [sidebar, setSidebar] = useState<SidebarSlice>(EMPTY_SIDEBAR);
  const [productions, setProductions] = useState<Production[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(480);
  const [newPrimaryOpen, setNewPrimaryOpen] = useState(false);
  const [newPrimaryDefault, setNewPrimaryDefault] = useState<'investigation' | 'production'>('investigation');
  const [investigationsVersion, setInvestigationsVersion] = useState(0);
  const reloadInvestigations = useCallback(() => setInvestigationsVersion((n) => n + 1), []);
  const [viewerRole, setViewerRole] = useState<CaseRole | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [caseSummary, setCaseSummary] = useState<string | null>(null);
  const [caseInvestigations, setCaseInvestigations] = useState<ApiInvestigation[] | null>(null);
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);

  // Store graph callback in a ref so chat doesn't re-render on every callback change
  const graphUpdatedRef = useRef<(() => void) | undefined>(undefined);
  const [, forceGraphUpdate] = useState(0);


  // Fetch productions once on mount — shared across all pages
  useEffect(() => {
    apiClient.listProductions(caseId).then(setProductions).catch(() => setProductions([]));
  }, [caseId]);

  // Fetch caller's role, owning org, summary, and investigations on this case.
  // Extracted as a callback so consumers (e.g. the onboarding wizard) can re-pull
  // after seeding data, without disturbing the sidebar's own reloadInvestigations.
  const refreshCase = useCallback(() => {
    apiClient.getCase(caseId)
      .then(c => {
        setViewerRole(c.role ?? null);
        setOrgId(c.orgId ?? null);
        setCaseSummary(c.summary ?? null);
        setCaseInvestigations(c.investigations ?? []);
      })
      .catch(() => {
        setViewerRole(null);
        setOrgId(null);
        setCaseSummary(null);
        setCaseInvestigations(null);
      });
  }, [caseId]);

  useEffect(() => {
    refreshCase();
  }, [refreshCase]);

  const updateSidebar = useCallback((partial: Partial<SidebarSlice>) => {
    setSidebar((prev) => ({ ...prev, ...partial }));
  }, []);

  const openNewPrimary = useCallback((defaultType: 'investigation' | 'production' = 'investigation') => {
    setNewPrimaryDefault(defaultType);
    setNewPrimaryOpen(true);
  }, []);

  const closeNewPrimary = useCallback(() => {
    setNewPrimaryOpen(false);
  }, []);

  const setOnGraphUpdated = useCallback((fn: (() => void) | undefined) => {
    graphUpdatedRef.current = fn;
    forceGraphUpdate((n) => n + 1);
  }, []);

  const refreshProductions = useCallback(() => {
    apiClient.listProductions(caseId).then(setProductions).catch(console.error);
  }, [caseId]);

  // Resolve the case's own org slug/admin status from the viewer's org memberships.
  // Never fall back to a globally "active" org — a wrong org would leak another org's data.
  const orgSlug = useMemo(
    () => (orgId ? user?.orgs.find((o) => o.id === orgId)?.slug ?? null : null),
    [user, orgId],
  );
  const isOrgAdmin = useMemo(
    () => (orgId ? user?.orgs.find((o) => o.id === orgId)?.role === 'admin' : false),
    [user, orgId],
  );

  const requestChatPrompt = useCallback((prompt: string) => setPendingChatPrompt(prompt), []);
  const consumeChatPrompt = useCallback(() => setPendingChatPrompt(null), []);

  const value: CaseContextValue = {
    caseId,
    orgId,
    viewerRole,
    caseSummary,
    caseInvestigations,
    refreshCase,
    orgSlug,
    isOrgAdmin,
    pendingChatPrompt,
    requestChatPrompt,
    consumeChatPrompt,
    sidebar,
    updateSidebar,
    productions,
    setProductions,
    investigationsVersion,
    reloadInvestigations,
    sidebarOpen,
    setSidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    chatOpen,
    setChatOpen,
    chatWidth,
    setChatWidth,
    newPrimaryOpen,
    newPrimaryDefault,
    openNewPrimary,
    closeNewPrimary,
    activeInvestigationId: sidebar.activeInvestigationId,
    onGraphUpdated: graphUpdatedRef.current,
    setOnGraphUpdated,
    onProductionUpdated: refreshProductions,
  };

  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>;
}

export function useCaseContext(): CaseContextValue {
  const ctx = useContext(CaseContext);
  if (!ctx) throw new Error('useCaseContext must be used within CaseProvider');
  return ctx;
}
