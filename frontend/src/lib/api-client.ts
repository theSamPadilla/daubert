import { getFirebaseAuth } from './firebase';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  // Attach Firebase auth token if signed in
  try {
    const currentUser = getFirebaseAuth().currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // Firebase not initialized or token refresh failed — proceed without auth
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `API error ${res.status}`);
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
    throw new Error(err.message || `API error ${res.status}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return null;
  return res.json();
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
    throw new Error(err.message || `Export error ${res.status}`);
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
export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Case {
  id: string;
  name: string;
  startDate: string | null;
  links: { url: string; label: string }[];
  createdAt: string;
  updatedAt: string;
  role?: string;
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
  type: 'report' | 'chart' | 'chronology';
  data: Record<string, unknown>;
  caseId: string;
  createdAt: string;
  updatedAt: string;
}

// Data Room
export interface DataRoomConnection {
  id: string;
  caseId: string;
  provider: string;
  folderId: string | null;
  folderName: string | null;
  status: 'active' | 'broken';
  createdAt: string;
  updatedAt: string;
}

export interface DataRoomFile {
  id: string;
  name: string;
  mimeType: string;
  /** Drive returns size as a string; absent for native Google docs (Docs/Sheets/Slides). */
  size?: string;
  /** ISO timestamp; absent on some Drive file types. */
  modifiedTime?: string;
  /** Drive web viewer URL; absent on some file types — guard before rendering. */
  webViewLink?: string;
}

// Admin
export type CaseRole = 'owner' | 'guest';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  linked: boolean;
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
  getMe: () => request<User>('/auth/me'),

  // Cases
  listCases: () => request<Case[]>('/cases'),
  getCase: (id: string) => request<Case>(`/cases/${id}`),
  updateCase: (id: string, body: Partial<{ name: string; startDate: string | null; links: { url: string; label: string }[] }>) =>
    request<Case>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCase: (id: string) => request<void>(`/cases/${id}`, { method: 'DELETE' }),

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

  // Traces
  listTraces: (investigationId: string) =>
    request<Trace[]>(`/investigations/${investigationId}/traces`),
  getTrace: (id: string) => request<Trace>(`/traces/${id}`),
  createTrace: (investigationId: string, body: { name: string; color?: string; visible?: boolean; collapsed?: boolean; data?: Record<string, unknown> }) =>
    request<Trace>(`/investigations/${investigationId}/traces`, { method: 'POST', body: JSON.stringify(body) }),
  updateTrace: (id: string, body: Partial<{ name: string; color: string | null; visible: boolean; collapsed: boolean; data: Record<string, unknown> }>) =>
    request<Trace>(`/traces/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTrace: (id: string) => request<void>(`/traces/${id}`, { method: 'DELETE' }),

  // Blockchain
  fetchHistory: (address: string, chain: string, options?: { startBlock?: number; endBlock?: number; page?: number; offset?: number; sort?: 'asc' | 'desc' }) =>
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
  listConversations: () =>
    request<Conversation[]>('/conversations'),
  createConversation: (caseId: string) =>
    request<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ caseId }) }),
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
  // (CUD has moved to /admin/labeled-entities/* — see adminCreateLabeledEntity below)

  // Admin — Users
  adminListUsers: () => request<AdminUser[]>('/admin/users'),
  adminCreateUser: (body: { email: string; name: string; caseId?: string; caseRole?: CaseRole }) =>
    request<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  adminDeleteUser: (id: string) =>
    request<void>(`/admin/users/${id}`, { method: 'DELETE' }),

  // Admin — Cases
  adminListCases: () => request<Case[]>('/admin/cases'),
  adminCreateCase: (body: { name: string; ownerUserId: string; startDate?: string; links?: { url: string; label: string }[] }) =>
    request<Case>('/admin/cases', { method: 'POST', body: JSON.stringify(body) }),
  adminDeleteCase: (id: string) =>
    request<void>(`/admin/cases/${id}`, { method: 'DELETE' }),
  adminListCaseMembers: (caseId: string) =>
    request<CaseMember[]>(`/admin/cases/${caseId}/members`),
  adminAddCaseMember: (caseId: string, body: { userId: string; role: CaseRole }) =>
    request<CaseMember>(`/admin/cases/${caseId}/members`, { method: 'POST', body: JSON.stringify(body) }),
  adminUpdateCaseMemberRole: (caseId: string, userId: string, role: CaseRole) =>
    request<CaseMember>(`/admin/cases/${caseId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  adminRemoveCaseMember: (caseId: string, userId: string) =>
    request<void>(`/admin/cases/${caseId}/members/${userId}`, { method: 'DELETE' }),

  // Admin — Labeled Entities (CUD only; reads stay on /labeled-entities)
  adminCreateLabeledEntity: (body: { name: string; category: string; wallets: string[]; description?: string; metadata?: Record<string, unknown> }) =>
    request<LabeledEntity>('/admin/labeled-entities', { method: 'POST', body: JSON.stringify(body) }),
  adminUpdateLabeledEntity: (id: string, body: Partial<{ name: string; category: string; description: string; wallets: string[]; metadata: Record<string, unknown> }>) =>
    request<LabeledEntity>(`/admin/labeled-entities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  adminDeleteLabeledEntity: (id: string) =>
    request<void>(`/admin/labeled-entities/${id}`, { method: 'DELETE' }),

  // Productions
  listProductions: (caseId: string, type?: string) => {
    const qs = type ? `?type=${type}` : '';
    return request<Production[]>(`/cases/${caseId}/productions${qs}`);
  },
  getProduction: (id: string) =>
    request<Production>(`/productions/${id}`),
  createProduction: (caseId: string, body: { name: string; type: string; data: Record<string, unknown> }) =>
    request<Production>(`/cases/${caseId}/productions`, { method: 'POST', body: JSON.stringify(body) }),
  updateProduction: (id: string, body: Partial<{ name: string; type: string; data: Record<string, unknown> }>) =>
    request<Production>(`/productions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProduction: (id: string) =>
    request<void>(`/productions/${id}`, { method: 'DELETE' }),

  // Export
  exportProduction: (id: string, format: 'pdf' | 'html', filename: string, imageDataUrl?: string) =>
    downloadFile(`/exports/productions/${id}`, `${filename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, imageDataUrl }),
    }),
  exportGraph: (name: string, imageDataUrl: string) =>
    downloadFile('/exports/graph', `${name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, imageDataUrl }),
    }),

  // Data Room — Google Drive integration
  dataRoomConnect: (caseId: string) =>
    request<{ url: string }>(`/cases/${caseId}/data-room/connect`, { method: 'POST' }),
  /**
   * Per the OpenAPI contract, the backend returns 404 when no connection
   * exists for this case. Map that to `null` for ergonomic consumer code:
   * callers can `if (!conn)` check directly without try/catch around 404s.
   * Other failures (auth, network, 5xx) still throw via `requestNullable404`.
   */
  dataRoomGet: (caseId: string) =>
    requestNullable404<DataRoomConnection>(`/cases/${caseId}/data-room`),
  dataRoomSetFolder: (caseId: string, folderId: string) =>
    request<DataRoomConnection>(`/cases/${caseId}/data-room/folder`, {
      method: 'PATCH',
      body: JSON.stringify({ folderId }),
    }),
  dataRoomListFiles: (caseId: string) =>
    request<DataRoomFile[]>(`/cases/${caseId}/data-room/files`),
  dataRoomDownload: (caseId: string, fileId: string, filename: string) =>
    downloadFile(`/cases/${caseId}/data-room/files/${fileId}/download`, filename),
  dataRoomDisconnect: (caseId: string) =>
    request<void>(`/cases/${caseId}/data-room`, { method: 'DELETE' }),
  /**
   * Owner-only. Returns a short-lived Google OAuth access token that lets
   * the browser drive the Drive Picker SDK directly. Don't cache beyond
   * `expiresAt` — the backend will mint a fresh one on each call.
   */
  dataRoomGetAccessToken: (caseId: string) =>
    request<{ accessToken: string; expiresAt: string }>(
      `/cases/${caseId}/data-room/access-token`,
    ),

  /**
   * Upload a file to the connected Drive folder. Uses XMLHttpRequest because
   * `fetch` doesn't expose upload progress events. Resolves with the created
   * Drive file metadata.
   */
  dataRoomUpload: async (
    caseId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
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
      xhr.open('POST', `${API_BASE}/cases/${caseId}/data-room/files`);
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
};
