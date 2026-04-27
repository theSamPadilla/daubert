'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { ReactNode, Dispatch, SetStateAction } from 'react';
import { apiClient, type Investigation as ApiInvestigation, type ScriptRun, type Production } from '@/lib/api-client';
import type { Trace } from '@/types/investigation';

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
  selectedProductionId?: string;
  onSelectProduction?: (prod: Production) => void;
  onEditInvestigation?: (inv: ApiInvestigation) => void;
}

const EMPTY_SIDEBAR: SidebarSlice = {
  activeInvestigationId: null,
};

export interface CaseContextValue {
  caseId: string;

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

  // --- New Primary modal ---
  newPrimaryOpen: boolean;
  newPrimaryDefault: 'investigation' | 'production';
  openNewPrimary: (defaultType?: 'investigation' | 'production') => void;
  closeNewPrimary: () => void;

  // --- Chat needs these ---
  activeInvestigationId: string | null;
  onGraphUpdated?: () => void;
  setOnGraphUpdated: (fn: (() => void) | undefined) => void;
}

const CaseContext = createContext<CaseContextValue | null>(null);

export function CaseProvider({ caseId, children }: { caseId: string; children: ReactNode }) {
  const [sidebar, setSidebar] = useState<SidebarSlice>(EMPTY_SIDEBAR);
  const [productions, setProductions] = useState<Production[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(480);
  const [newPrimaryOpen, setNewPrimaryOpen] = useState(false);
  const [newPrimaryDefault, setNewPrimaryDefault] = useState<'investigation' | 'production'>('investigation');

  // Store onGraphUpdated in a ref so chat doesn't re-render on every callback change
  const graphUpdatedRef = useRef<(() => void) | undefined>(undefined);
  const [, forceGraphUpdate] = useState(0);

  // Fetch productions once on mount — shared across all pages
  useEffect(() => {
    apiClient.listProductions(caseId).then(setProductions).catch(() => setProductions([]));
  }, [caseId]);

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

  const value: CaseContextValue = {
    caseId,
    sidebar,
    updateSidebar,
    productions,
    setProductions,
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
  };

  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>;
}

export function useCaseContext(): CaseContextValue {
  const ctx = useContext(CaseContext);
  if (!ctx) throw new Error('useCaseContext must be used within CaseProvider');
  return ctx;
}
