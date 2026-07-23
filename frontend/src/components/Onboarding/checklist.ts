export interface OnboardingRecord {
  wizardDismissed?: boolean;
  railDismissed?: boolean;
  seedNodeCount?: number;
  seededInvestigationId?: string;
  draftRequested?: boolean;
}

const key = (caseId: string) => `daubert:onboarding:${caseId}`;

export function readOnboardingRecord(caseId: string): OnboardingRecord {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(key(caseId)) ?? '{}'); }
  catch { return {}; }
}

export function writeOnboardingRecord(caseId: string, patch: OnboardingRecord): OnboardingRecord {
  const next = { ...readOnboardingRecord(caseId), ...patch };
  try { window.localStorage.setItem(key(caseId), JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

const SHORTENED_RE = /^(0x)?[0-9a-f]{2,6}(…|\.{3})[0-9a-f]{2,6}$/i;

export function isNodeLabeled(node: { label?: string; address?: string }): boolean {
  const label = (node.label ?? '').trim();
  if (!label) return false;
  if (label.toLowerCase() === (node.address ?? '').toLowerCase()) return false;
  if (SHORTENED_RE.test(label)) return false;
  return true;
}

export interface ChecklistState {
  seeded: boolean; labeled: boolean; expanded: boolean; draftRequested: boolean;
}

export function deriveChecklist(args: {
  investigationCount: number;
  nodes: { label?: string; address?: string }[];
  seedNodeCount: number | null;
  draftRequested: boolean;
}): ChecklistState {
  return {
    seeded: args.investigationCount > 0,
    labeled: args.nodes.some(isNodeLabeled),
    expanded: args.seedNodeCount == null ? true : args.nodes.length > args.seedNodeCount,
    draftRequested: args.draftRequested,
  };
}
