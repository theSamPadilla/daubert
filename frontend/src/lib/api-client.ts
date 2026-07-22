import { getFirebaseAuth } from './firebase';
import type { components } from '../generated/api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = RequestInit & { unauthed?: boolean };

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  // Attach Firebase auth token if signed in (skip for unauthenticated endpoints)
  if (!options?.unauthed) {
    try {
      const currentUser = getFirebaseAuth().currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      // Firebase not initialized or token refresh failed — proceed without auth
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(err.message || `API error ${res.status}`, res.status);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  return res.json();
}

/**
 * Variant of `request<T>` that translates HTTP 404 into `null` instead of an
 * error. Use for endpoints whose OpenAPI contract returns 404 for "resource
 * not present" (vs. 404 for "wrong URL"). Keeps consumer code free of
 * try/catch boilerplate around an expected absence.
 */
async function requestNullable404<T>(path: string, options?: RequestInit): Promise<T | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  try {
    const currentUser = getFirebaseAuth().currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(err.message || `API error ${res.status}`, res.status);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return null;
  return res.json();
}

/**
 * Variant of `request<T>` for endpoints that return `text/html` (or any
 * non-JSON body) rather than JSON. Same auth handling as `request`, but the
 * body is read with `res.text()` and returned as a string. Errors are still
 * surfaced as `ApiError`.
 */
async function requestText(path: string, options?: RequestInit): Promise<string> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  try {
    const currentUser = getFirebaseAuth().currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(err.message || `API error ${res.status}`, res.status);
  }
  return res.text();
}

async function downloadFile(path: string, filename: string, options?: RequestInit): Promise<void> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  try {
    const currentUser = getFirebaseAuth().currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(err.message || `Export error ${res.status}`, res.status);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Types matching the backend entities
export type OrgMemberRole = components['schemas']['OrgMemberRole'];

export interface UserSelf {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  isSuperAdmin: boolean;
  orgs: Array<{ id: string; slug: string; name: string; role: OrgMemberRole }>;
}

/** @deprecated Use UserSelf */
export type User = UserSelf;

export interface Case {
  id: string;
  name: string;
  summary: string | null;
  orgId: string;
  createdAt: string;
  updatedAt: string;
  role?: CaseRole;
  investigations?: Investigation[];
}

export interface Investigation {
  id: string;
  name: string;
  notes: string | null;
  caseId: string;
  createdAt: string;
  updatedAt: string;
  traces?: Trace[];
}

export interface Trace {
  id: string;
  name: string;
  color: string | null;
  visible: boolean;
  collapsed: boolean;
  data: Record<string, unknown>;
  investigationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  caseId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  createdAt: string;
}

export interface ScriptRun {
  id: string;
  name: string;
  code: string;
  output: string | null;
  status: 'success' | 'error' | 'timeout';
  durationMs: number;
  investigationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LabeledEntity {
  id: string;
  name: string;
  category: string;
  description: string | null;
  wallets: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Production {
  id: string;
  name: string;
  type: 'report' | 'chart' | 'chronology' | 'declaration';
  data: Record<string, unknown>;
  caseId: string;
  createdAt: string;
  updatedAt: string;
}

export type DeclarationFormat = components['schemas']['DeclarationFormat'];

// Data Room
export interface DataRoomFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  uploadedByUserId: string;
  createdAt: string;
}

export interface DataRoomFolder {
  id: string;
  caseId: string;
  parentFolderId: string | null;
  name: string;
  createdByUserId: string;
  createdAt: string;
}

export interface DataRoomContents {
  breadcrumb: { id: string; name: string }[];
  folders: DataRoomFolder[];
  files: DataRoomFile[];
}

// Invites
export interface CaseInvite {
  id: string;
  caseId: string;
  email: string;
  role: 'editor' | 'viewer';
  code: string;
  message?: string | null;
  createdByUserId: string;
  expiresAt: string;
  usedAt?: string | null;
  usedByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseInviteLookup {
  status: 'pending' | 'used' | 'expired' | 'revoked';
  caseName?: string;
  inviterName?: string;
  role?: 'editor' | 'viewer';
  email?: string;
  message?: string | null;
}

// Admin
export type CaseRole = 'owner' | 'editor' | 'viewer';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  linked: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CaseMember {
  id: string;
  userId: string;
  caseId: string;
  role: CaseRole;
  user?: AdminUser;
  createdAt: string;
  updatedAt: string;
}

export const apiClient = {
  // Auth
  getMe: () => request<UserSelf>('/auth/me'),
  updateMe: (dto: components['schemas']['UpdateMeRequest']) =>
    request<UserSelf>('/auth/me', { method: 'PATCH', body: JSON.stringify(dto) }),

  // Email auth
  sendEmailOtp: (dto: components['schemas']['SendOtpRequest']) =>
    request<components['schemas']['SendOtpResponse']>('/auth/email/otp/send', {
      method: 'POST',
      body: JSON.stringify(dto),
      unauthed: true,
    }),
  verifyEmailOtp: (dto: components['schemas']['VerifyOtpRequest']) =>
    request<components['schemas']['VerifyOtpResponse']>('/auth/email/otp/verify', {
      method: 'POST',
      body: JSON.stringify(dto),
      unauthed: true,
    }),

  // Cases
  listCases: () => request<Case[]>('/cases'),
  createCase: (dto: { name: string; orgId: string; summary?: string }) =>
    request<Case>('/cases', { method: 'POST', body: JSON.stringify(dto) }),
  getCase: (id: string) => request<Case>(`/cases/${id}`),
  updateCase: (id: string, body: Partial<{ name: string; summary: string | null }>) =>
    request<Case>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCase: (id: string) => request<void>(`/cases/${id}`, { method: 'DELETE' }),

  // Case Members (member-facing)
  listCaseMembers: (caseId: string) =>
    request<CaseMember[]>(`/cases/${caseId}/members`),
  addCaseMember: (caseId: string, dto: { email: string; role: CaseRole }) =>
    request<CaseMember>(`/cases/${caseId}/members`, { method: 'POST', body: JSON.stringify(dto) }),
  updateCaseMemberRole: (caseId: string, userId: string, role: CaseRole) =>
    request<CaseMember>(`/cases/${caseId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeCaseMember: (caseId: string, userId: string) =>
    request<void>(`/cases/${caseId}/members/${userId}`, { method: 'DELETE' }),
  leaveCase: (caseId: string) =>
    request<void>(`/cases/${caseId}/members/me/leave`, { method: 'POST' }),

  // Invites
  createInvite: (caseId: string, dto: { email: string; role: 'owner' | 'editor' | 'viewer'; name?: string; message?: string }) =>
    request<CaseInvite>(`/cases/${caseId}/invites`, { method: 'POST', body: JSON.stringify(dto) }),
  listInvites: (caseId: string) =>
    request<CaseInvite[]>(`/cases/${caseId}/invites`),
  revokeInvite: (caseId: string, inviteId: string) =>
    request<void>(`/cases/${caseId}/invites/${inviteId}`, { method: 'DELETE' }),
  lookupInvite: (code: string) =>
    request<CaseInviteLookup>(`/invites/${code}`),
  acceptInvite: (code: string) =>
    request<{ caseId: string; alreadyMember: boolean }>(`/invites/${code}/accept`, { method: 'POST' }),

  // Investigations
  listInvestigations: (caseId: string) =>
    request<Investigation[]>(`/cases/${caseId}/investigations`),
  getInvestigation: (id: string) =>
    request<Investigation>(`/investigations/${id}`),
  createInvestigation: (caseId: string, body: { name: string; notes?: string }) =>
    request<Investigation>(`/cases/${caseId}/investigations`, { method: 'POST', body: JSON.stringify(body) }),
  updateInvestigation: (id: string, body: Partial<{ name: string; notes: string }>) =>
    request<Investigation>(`/investigations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteInvestigation: (id: string) =>
    request<void>(`/investigations/${id}`, { method: 'DELETE' }),
  duplicateInvestigation: (id: string) =>
    request<Investigation>(`/investigations/${id}/duplicate`, { method: 'POST' }),

  // Traces
  listTraces: (investigationId: string) =>
    request<Trace[]>(`/investigations/${investigationId}/traces`),
  getTrace: (id: string) => request<Trace>(`/traces/${id}`),
  createTrace: (investigationId: string, body: { name: string; color?: string; visible?: boolean; collapsed?: boolean; data?: Record<string, unknown> }) =>
    request<Trace>(`/investigations/${investigationId}/traces`, { method: 'POST', body: JSON.stringify(body) }),
  updateTrace: (id: string, body: Partial<{ name: string; color: string | null; visible: boolean; collapsed: boolean; data: Record<string, unknown> }>) =>
    request<Trace>(`/traces/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTrace: (id: string) => request<void>(`/traces/${id}`, { method: 'DELETE' }),
  searchBetween: (
    investigationId: string,
    payload: components['schemas']['SearchBetweenRequest'],
    signal?: AbortSignal,
  ) =>
    request<components['schemas']['SearchBetweenResponse']>(`/investigations/${investigationId}/search-between`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),
  importTransactions: (
    traceId: string,
    transactions: components['schemas']['ImportTransactionItem'][],
  ) =>
    request<{ added: { nodes: number; edges: number } }>(`/traces/${traceId}/import-transactions`, {
      method: 'POST',
      body: JSON.stringify({ transactions }),
    }),

  // Blockchain
  fetchHistory: (address: string, chain: string, options?: { startBlock?: number; endBlock?: number; startDate?: string; endDate?: string; page?: number; offset?: number; sort?: 'asc' | 'desc' }) =>
    request<{ transactions: any[]; chain: string; address: string }>('/blockchain/fetch-history', {
      method: 'POST',
      body: JSON.stringify({ address, chain, options }),
    }),

  getTransaction: (txHash: string, chain: string) =>
    request<{
      txHash: string;
      from: string;
      to: string;
      chain: string;
      amount: string;
      timestamp: string;
      blockNumber: number;
      token: { address: string; symbol: string; decimals: number };
      tokenTransfers: Array<{
        from: string;
        to: string;
        amount: string;
        token: { address: string; symbol: string; decimals: number };
      }>;
      isError: boolean;
    }>('/blockchain/get-transaction', {
      method: 'POST',
      body: JSON.stringify({ txHash, chain }),
    }),

  getAddressInfo: (address: string, chain: string) =>
    request<{
      address: string;
      addressType: 'wallet' | 'contract';
      balance: string;
      label?: string;
    }>('/blockchain/get-address-info', {
      method: 'POST',
      body: JSON.stringify({ address, chain }),
    }),

  // AI
  chat: (message: string) =>
    request<{ message: string }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  // Conversations
  listConversations: (caseId: string) =>
    request<Conversation[]>(`/cases/${caseId}/conversations`),
  createConversation: (caseId: string) =>
    request<Conversation>(`/cases/${caseId}/conversations`, { method: 'POST' }),
  getConversationMessages: (conversationId: string) =>
    request<ChatMessage[]>(`/conversations/${conversationId}/messages`),
  deleteConversation: (conversationId: string) =>
    request<void>(`/conversations/${conversationId}`, { method: 'DELETE' }),

  // Script Runs
  listScriptRuns: (investigationId: string) =>
    request<ScriptRun[]>(`/investigations/${investigationId}/script-runs`),
  rerunScript: (scriptRunId: string) =>
    request<ScriptRun>(`/script-runs/${scriptRunId}/rerun`, { method: 'POST' }),

  // Labeled Entities
  listLabeledEntities: (filters?: { category?: string; search?: string }) => {
    const params = new URLSearchParams();
    if (filters?.category) params.set('category', filters.category);
    if (filters?.search) params.set('search', filters.search);
    const qs = params.toString();
    return request<LabeledEntity[]>(`/labeled-entities${qs ? `?${qs}` : ''}`);
  },
  getLabeledEntity: (id: string) =>
    request<LabeledEntity>(`/labeled-entities/${id}`),
  lookupLabeledEntity: (address: string) =>
    request<LabeledEntity[]>(`/labeled-entities/lookup?address=${encodeURIComponent(address)}`),
  // (CUD has moved to /superadmin/labeled-entities/* — see superadminCreateLabeledEntity below)

  // Organizations
  getOrg: (slug: string) =>
    request<components['schemas']['Organization']>(`/orgs/${slug}`),
  updateOrg: (slug: string, dto: components['schemas']['UpdateOrgRequest']) =>
    request<components['schemas']['Organization']>(`/orgs/${slug}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  listOrgMembers: (slug: string) =>
    request<components['schemas']['OrganizationMember'][]>(`/orgs/${slug}/members`),
  addOrgMember: (slug: string, dto: components['schemas']['AddOrgMemberRequest']) =>
    request<components['schemas']['OrganizationMember']>(`/orgs/${slug}/members`, { method: 'POST', body: JSON.stringify(dto) }),
  updateOrgMemberRole: (slug: string, userId: string, dto: components['schemas']['UpdateOrgMemberRoleRequest']) =>
    request<components['schemas']['OrganizationMember']>(`/orgs/${slug}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  removeOrgMember: (slug: string, userId: string) =>
    request<void>(`/orgs/${slug}/members/${userId}`, { method: 'DELETE' }),
  leaveOrg: (slug: string) =>
    request<void>(`/orgs/${slug}/members/me/leave`, { method: 'POST' }),
  listOrgInvites: (slug: string) =>
    request<components['schemas']['OrganizationInvite'][]>(`/orgs/${slug}/invites`),
  createOrgInvite: (slug: string, dto: components['schemas']['CreateOrgInviteRequest']) =>
    request<components['schemas']['OrganizationInvite']>(`/orgs/${slug}/invites`, { method: 'POST', body: JSON.stringify(dto) }),
  revokeOrgInvite: (slug: string, inviteId: string) =>
    request<void>(`/orgs/${slug}/invites/${inviteId}`, { method: 'DELETE' }),
  lookupOrgInvite: (code: string) =>
    request<components['schemas']['OrganizationInviteLookup']>(`/org-invites/${code}`),
  acceptOrgInvite: (code: string) =>
    request<components['schemas']['AcceptOrgInviteResponse']>(`/org-invites/${code}/accept`, { method: 'POST' }),

  // Superadmin — Orgs
  superadminListOrgs: () =>
    request<components['schemas']['OrgSummary'][]>('/superadmin/orgs'),
  superadminListTrashedOrgs: () =>
    request<components['schemas']['OrgSummary'][]>('/superadmin/orgs/trash'),
  superadminCreateOrg: (dto: components['schemas']['CreateOrgRequest']) =>
    request<components['schemas']['Organization']>('/superadmin/orgs', { method: 'POST', body: JSON.stringify(dto) }),
  superadminDeleteOrg: (id: string) =>
    request<void>(`/superadmin/orgs/${id}`, { method: 'DELETE' }),
  superadminRestoreOrg: (id: string) =>
    request<components['schemas']['Organization']>(`/superadmin/orgs/${id}/restore`, { method: 'POST' }),
  superadminPurgeOrg: (id: string) =>
    request<void>(`/superadmin/orgs/${id}/purge`, { method: 'DELETE' }),

  // Superadmin — Users
  superadminListUsers: () =>
    request<components['schemas']['UserSummary'][]>('/superadmin/users'),
  superadminCreateUser: (dto: components['schemas']['CreateSuperadminUserRequest']) =>
    request<components['schemas']['UserSummary']>('/superadmin/users', { method: 'POST', body: JSON.stringify(dto) }),
  superadminDeleteUser: (id: string) =>
    request<void>(`/superadmin/users/${id}`, { method: 'DELETE' }),
  superadminSetSuperAdmin: (id: string, value: boolean) =>
    request<components['schemas']['UserSummary']>(`/superadmin/users/${id}/superadmin`, { method: 'PATCH', body: JSON.stringify({ value }) }),

  // Superadmin — Cases
  superadminListCases: () =>
    request<components['schemas']['CaseSummary'][]>('/superadmin/cases'),

  // Superadmin — Token Usage
  superadminTokenUsageOverview: (days: 7 | 30 | 90 = 30) =>
    request<components['schemas']['TokenUsageOverview']>(`/superadmin/token-usage/overview?days=${days}`),
  superadminTokenUsageByOrg: (days: 7 | 30 | 90 = 30, limit = 10) =>
    request<components['schemas']['TokenUsageByOrgRow'][]>(`/superadmin/token-usage/by-org?days=${days}&limit=${limit}`),
  superadminTokenUsageByUser: (days: 7 | 30 | 90 = 30, limit = 10) =>
    request<components['schemas']['TokenUsageByUserRow'][]>(`/superadmin/token-usage/by-user?days=${days}&limit=${limit}`),
  superadminTokenUsageByCase: (days: 7 | 30 | 90 = 30, limit = 10) =>
    request<components['schemas']['TokenUsageByCaseRow'][]>(`/superadmin/token-usage/by-case?days=${days}&limit=${limit}`),
  superadminTokenUsageByConversation: (days: 7 | 30 | 90 = 30, limit = 10) =>
    request<components['schemas']['TokenUsageByConversationRow'][]>(`/superadmin/token-usage/by-conversation?days=${days}&limit=${limit}`),
  superadminTokenUsageOrgModelMatrix: (days: 7 | 30 | 90 = 30) =>
    request<components['schemas']['TokenUsageOrgModelMatrixRow'][]>(`/superadmin/token-usage/org-model-matrix?days=${days}`),
  superadminTokenUsageCacheEffectiveness: (days: 7 | 30 | 90 = 30) =>
    request<components['schemas']['TokenUsageCacheEffectiveness']>(`/superadmin/token-usage/cache-effectiveness?days=${days}`),

  // Superadmin — Labeled Entities (CUD only; reads stay on /labeled-entities)
  superadminCreateLabeledEntity: (body: { name: string; category: string; wallets: string[]; description?: string; metadata?: Record<string, unknown> }) =>
    request<LabeledEntity>('/superadmin/labeled-entities', { method: 'POST', body: JSON.stringify(body) }),
  superadminUpdateLabeledEntity: (id: string, body: Partial<{ name: string; category: string; description: string; wallets: string[]; metadata: Record<string, unknown> }>) =>
    request<LabeledEntity>(`/superadmin/labeled-entities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  superadminDeleteLabeledEntity: (id: string) =>
    request<void>(`/superadmin/labeled-entities/${id}`, { method: 'DELETE' }),

  // Productions
  listProductions: (caseId: string, type?: string) => {
    const qs = type ? `?type=${type}` : '';
    return request<Production[]>(`/cases/${caseId}/productions${qs}`);
  },
  getProduction: (id: string) =>
    request<Production>(`/productions/${id}`),
  createProduction: (caseId: string, body: { name: string; type: string; data: Record<string, unknown> }) =>
    request<Production>(`/cases/${caseId}/productions`, { method: 'POST', body: JSON.stringify(body) }),
  updateProduction: (id: string, body: Partial<{ name: string; type: string; data: Record<string, unknown>; ops: Record<string, unknown>[] }>) =>
    request<Production>(`/productions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProduction: (id: string) =>
    request<void>(`/productions/${id}`, { method: 'DELETE' }),

  // Declaration formats + preview
  listDeclarationFormats: () =>
    request<DeclarationFormat[]>('/declaration-formats'),
  getDeclarationPreview: (productionId: string) =>
    requestText(`/productions/${productionId}/declaration-preview`),

  // Export
  exportProduction: (
    id: string,
    format: 'pdf' | 'png' | 'docx' | 'csv',
    filename: string,
    opts?: {
      imageDataUrl?: string;
      fontFamily?: string;
      fontSize?: number;
      orientation?: 'portrait' | 'landscape';
    },
  ) => {
    const safeStem = filename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'export';
    return downloadFile(`/exports/productions/${id}`, `${safeStem}.${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format,
        filename: safeStem,
        imageDataUrl: opts?.imageDataUrl,
        fontFamily: opts?.fontFamily,
        fontSize: opts?.fontSize,
        orientation: opts?.orientation,
      }),
    });
  },
  exportGraph: (
    name: string,
    filename: string,
    imageDataUrl: string,
    opts?: { orientation?: 'portrait' | 'landscape' },
  ) => {
    const safeStem = filename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'graph';
    return downloadFile('/exports/graph', `${safeStem}.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filename: safeStem, imageDataUrl, orientation: opts?.orientation }),
    });
  },
  exportExhibit: (
    filename: string,
    items: Array<{
      refType: 'production' | 'investigation';
      refId: string;
      title: string;
      subtitle?: string;
      imageDataUrl?: string;
    }>,
    opts?: { fontFamily?: string; fontSize?: number },
  ) => {
    const safeStem = filename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'exhibit';
    return downloadFile('/exports/exhibit', `${safeStem}.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: safeStem,
        items,
        fontFamily: opts?.fontFamily,
        fontSize: opts?.fontSize,
      }),
    });
  },

  // Data Room
  dataRoomListFiles: (caseId: string) =>
    request<DataRoomFile[]>(`/cases/${caseId}/data-room/files`),
  dataRoomDownload: (caseId: string, fileId: string, filename: string) =>
    downloadFile(`/cases/${caseId}/data-room/files/${fileId}/download`, filename),
  dataRoomDeleteFile: (caseId: string, fileId: string): Promise<void> =>
    request<void>(`/cases/${caseId}/data-room/files/${fileId}`, { method: 'DELETE' }),

  dataRoomContents: (caseId: string, folderId?: string | null) =>
    request<DataRoomContents>(
      `/cases/${caseId}/data-room/contents${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`,
    ),
  dataRoomCreateFolder: (caseId: string, name: string, parentFolderId: string | null) =>
    request<DataRoomFolder>(`/cases/${caseId}/data-room/folders`, {
      method: 'POST',
      body: JSON.stringify({ name, parentFolderId }),
    }),
  dataRoomDeleteFolder: (caseId: string, folderId: string): Promise<void> =>
    request<void>(`/cases/${caseId}/data-room/folders/${folderId}`, { method: 'DELETE' }),
  dataRoomMoveFile: (caseId: string, fileId: string, targetFolderId: string | null): Promise<void> =>
    request<void>(`/cases/${caseId}/data-room/files/${fileId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ targetFolderId }),
    }),
  dataRoomMoveFolder: (caseId: string, folderId: string, targetFolderId: string | null): Promise<void> =>
    request<void>(`/cases/${caseId}/data-room/folders/${folderId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ targetFolderId }),
    }),

  dataRoomImportFromDrive: (caseId: string, accessToken: string, fileIds: string[], folderId?: string | null) =>
    request<{ imported: DataRoomFile[]; failed: { fileId: string; error: string }[] }>(
      `/cases/${caseId}/data-room/import/google-drive`,
      { method: 'POST', body: JSON.stringify({ accessToken, fileIds, folderId }) },
    ),

  dataRoomExportToDrive: (
    caseId: string,
    accessToken: string,
    fileIds: string[],
    destinationFolderId?: string | null,
  ) =>
    request<{ exported: { fileId: string; name: string; webViewLink: string | null }[]; failed: { fileId: string; error: string }[] }>(
      `/cases/${caseId}/data-room/export/google-drive`,
      { method: 'POST', body: JSON.stringify({ accessToken, fileIds, destinationFolderId }) },
    ),

  /**
   * Upload a file to the built-in data room. Uses XMLHttpRequest because
   * `fetch` doesn't expose upload progress events. Resolves with the created
   * file metadata.
   */
  dataRoomUpload: async (
    caseId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
    folderId?: string | null,
  ): Promise<DataRoomFile> => {
    let token: string | null = null;
    try {
      const currentUser = getFirebaseAuth().currentUser;
      if (currentUser) token = await currentUser.getIdToken();
    } catch {
      // proceed unauthenticated; backend will reject
    }

    const form = new FormData();
    form.append('file', file, file.name);

    return new Promise<DataRoomFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const uploadUrl = folderId
        ? `${API_BASE}/cases/${caseId}/data-room/files?folderId=${encodeURIComponent(folderId)}`
        : `${API_BASE}/cases/${caseId}/data-room/files`;
      xhr.open('POST', uploadUrl);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      if (onProgress) {
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as DataRoomFile);
          } catch {
            reject(new Error('Malformed upload response'));
          }
        } else {
          let message = `Upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText);
            if (body?.message) message = body.message;
          } catch {}
          reject(new Error(message));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new Error('Upload aborted'));

      xhr.send(form);
    });
  },

  // OAuth authorize bridge
  /**
   * Bridge call for `GET /oauth/authorize`. Used by `app/oauth/authorize/page.tsx`
   * to recover the OAuth flow when an MCP client navigated to the backend
   * authorize endpoint in a browser (which never carries a Bearer token).
   *
   * The bridge page:
   *   1. Mounts in the FE at `/oauth/authorize?...` (same query as the BE).
   *   2. Reads the Firebase session via `useAuth`.
   *   3. Calls this method with the raw query string (including `?`).
   *
   * The BE returns `{ redirectUrl }` when authenticated — the FE then sets
   * `window.location.href = redirectUrl` to hop to `/oauth/consent`.
   *
   * `search` MUST be the raw `window.location.search` (including the leading
   * `?` if present) — do not re-encode the params here; the BE expects the
   * exact same query string the OAuth client sent.
   *
   * The `Accept: application/json` header is what flips the BE into JSON
   * mode (vs. its default 302-redirect behavior for browser navigations).
   */
  authorizeAgent: (search: string) =>
    request<{ redirectUrl: string }>(`/oauth/authorize${search}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),

  // OAuth consent flow
  previewConsent: (bag: string) =>
    request<components['schemas']['OAuthConsentPreview']>('/oauth/authorize/preview', {
      method: 'POST',
      body: JSON.stringify({ bag }),
    }),
  completeConsent: (bag: string, organizationId: string) =>
    request<{ redirectUrl: string }>('/oauth/authorize/complete', {
      method: 'POST',
      body: JSON.stringify({ bag, organizationId }),
    }),
  denyConsent: (bag: string) =>
    request<{ redirectUrl: string }>('/oauth/authorize/deny', {
      method: 'POST',
      body: JSON.stringify({ bag }),
    }),

  // User OAuth sessions
  listOauthSessions: () =>
    request<components['schemas']['OAuthSessionSummary'][]>('/me/oauth-sessions'),
  revokeOauthSession: (id: string) =>
    request<void>(`/me/oauth-sessions/${id}/revoke`, { method: 'POST' }),
  startConnect: () =>
    request<components['schemas']['StartConnectResponse']>('/me/oauth/start-connect', {
      method: 'POST',
    }),
  listAgentActions: () =>
    request<components['schemas']['AgentActionSummary'][]>('/me/agent-actions'),

  // Declaration Library
  listDeclarationLibrary: (orgSlug: string, kind?: components['schemas']['DeclarationLibraryBlockKind']) => {
    const qs = kind ? `?kind=${kind}` : '';
    return request<components['schemas']['DeclarationLibraryBlock'][]>(`/orgs/${orgSlug}/declaration-library${qs}`);
  },
  createDeclarationLibraryBlock: (orgSlug: string, dto: components['schemas']['CreateDeclarationLibraryBlockRequest']) =>
    request<components['schemas']['DeclarationLibraryBlock']>(`/orgs/${orgSlug}/declaration-library`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  updateDeclarationLibraryBlock: (orgSlug: string, blockId: string, dto: components['schemas']['UpdateDeclarationLibraryBlockRequest']) =>
    request<components['schemas']['DeclarationLibraryBlock']>(`/orgs/${orgSlug}/declaration-library/${blockId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  deleteDeclarationLibraryBlock: (orgSlug: string, blockId: string) =>
    request<void>(`/orgs/${orgSlug}/declaration-library/${blockId}`, { method: 'DELETE' }),

  // Declarants
  listDeclarants: (orgSlug: string) =>
    request<components['schemas']['Declarant'][]>(`/orgs/${orgSlug}/declarants`),
  createDeclarant: (orgSlug: string, dto: components['schemas']['CreateDeclarantRequest']) =>
    request<components['schemas']['Declarant']>(`/orgs/${orgSlug}/declarants`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  updateDeclarant: (orgSlug: string, declarantId: string, dto: components['schemas']['UpdateDeclarantRequest']) =>
    request<components['schemas']['Declarant']>(`/orgs/${orgSlug}/declarants/${declarantId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  deleteDeclarant: (orgSlug: string, declarantId: string) =>
    request<void>(`/orgs/${orgSlug}/declarants/${declarantId}`, { method: 'DELETE' }),
};
