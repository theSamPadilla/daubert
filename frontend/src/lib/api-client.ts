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
  createLabeledEntity: (body: { name: string; category: string; wallets: string[]; description?: string; metadata?: Record<string, unknown> }) =>
    request<LabeledEntity>('/labeled-entities', { method: 'POST', body: JSON.stringify(body) }),
  updateLabeledEntity: (id: string, body: Partial<{ name: string; category: string; description: string; wallets: string[]; metadata: Record<string, unknown> }>) =>
    request<LabeledEntity>(`/labeled-entities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLabeledEntity: (id: string) =>
    request<void>(`/labeled-entities/${id}`, { method: 'DELETE' }),
};
