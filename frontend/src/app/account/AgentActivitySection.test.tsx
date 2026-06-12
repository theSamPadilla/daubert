/**
 * @jest-environment jsdom
 *
 * Tests for the Agent activity section on the account page.
 *
 * What we care about:
 * - Lists agent actions with agent label, humanized action, org name, status chip.
 * - Denied actions render the "denied" chip.
 * - Empty state when there is no activity.
 * - Error message when the fetch fails.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockListAgentActions = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    listAgentActions: (...args: unknown[]) => mockListAgentActions(...args),
  },
}));

const mockOrgs = [{ id: 'org-1', slug: 'acme', name: 'Acme Corp', role: 'admin' as const }];
jest.mock('@/components/Auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Test User', email: 't@t.com', isSuperAdmin: false, orgs: mockOrgs },
  }),
}));

import { AgentActivitySection } from './AgentActivitySection';

const ACTION_OK = {
  id: 'act-1',
  sessionId: 'sess-1',
  agentLabel: 'Claude Desktop',
  organizationId: 'org-1',
  action: 'create_investigation',
  targetRef: 'case:4bec0fa7-ab52-4af2-9ad6-54e5f5b9d990',
  status: 'ok',
  createdAt: '2026-06-12T10:00:00.000Z',
};

const ACTION_DENIED = {
  id: 'act-2',
  sessionId: 'sess-1',
  agentLabel: 'Claude Desktop',
  organizationId: 'org-1',
  action: 'import_transactions',
  targetRef: 'trace:52d5eed0-b014-4d68-b82e-40675bcd5fd3',
  status: 'error',
  createdAt: '2026-06-12T09:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('lists actions with agent, humanized action, org name, and target', async () => {
  mockListAgentActions.mockResolvedValue([ACTION_OK]);
  render(<AgentActivitySection />);

  expect(await screen.findByText('Claude Desktop')).not.toBeNull();
  expect(screen.getByText('create investigation')).not.toBeNull();
  expect(screen.getByText('Acme Corp')).not.toBeNull();
  expect(screen.getByText('case 4bec0fa7')).not.toBeNull();
  expect(screen.getByText('ok')).not.toBeNull();
});

it('renders a denied chip for error-status actions', async () => {
  mockListAgentActions.mockResolvedValue([ACTION_DENIED]);
  render(<AgentActivitySection />);

  expect(await screen.findByText('denied')).not.toBeNull();
});

it('shows the empty state when there is no activity', async () => {
  mockListAgentActions.mockResolvedValue([]);
  render(<AgentActivitySection />);

  expect(await screen.findByText(/no agent activity yet/i)).not.toBeNull();
});

it('shows an error message when the fetch fails', async () => {
  mockListAgentActions.mockRejectedValue(new Error('Network error'));
  render(<AgentActivitySection />);

  await waitFor(() => expect(screen.getByText(/network error/i)).not.toBeNull());
});
