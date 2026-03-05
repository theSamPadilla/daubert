const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
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
}

export interface Case {
  id: string;
  name: string;
  startDate: string | null;
  links: { url: string; label: string }[];
  createdAt: string;
  updatedAt: string;
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

export const apiClient = {
  // User
  getMe: () => request<User>('/users/me'),

  // Cases
  listCases: () => request<Case[]>('/cases'),
  getCase: (id: string) => request<Case>(`/cases/${id}`),
  createCase: (body: { name: string; startDate?: string; links?: { url: string; label: string }[] }) =>
    request<Case>('/cases', { method: 'POST', body: JSON.stringify(body) }),
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
  fetchHistory: (address: string, chain: string, options?: { startBlock?: number; endBlock?: number; page?: number; offset?: number }) =>
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
  createConversation: () =>
    request<Conversation>('/conversations', { method: 'POST' }),
  getConversationMessages: (conversationId: string) =>
    request<ChatMessage[]>(`/conversations/${conversationId}/messages`),

  // Script Runs
  listScriptRuns: (investigationId: string) =>
    request<ScriptRun[]>(`/investigations/${investigationId}/script-runs`),
};
