/**
 * @jest-environment jsdom
 *
 * Tests for the cases-page header agent status button.
 *
 * What we care about:
 * - Shows "Agent connected" (green state) when the user has active sessions.
 * - Shows "Connect agent" (call-to-action state) when there are none.
 * - Click navigates to the account agents section; the disconnected state
 *   adds ?connect=1 so the instructions auto-open.
 * - Renders nothing while loading or when the session fetch fails.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockListOauthSessions = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    listOauthSessions: (...args: unknown[]) => mockListOauthSessions(...args),
  },
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { AgentStatusButton } from './AgentStatusButton';

const SESSION = {
  id: 'sess-1',
  organizationId: 'org-1',
  surfaceLabel: 'Claude Desktop',
  lastUsedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('shows connected state when sessions exist', async () => {
  mockListOauthSessions.mockResolvedValue([SESSION]);
  render(<AgentStatusButton />);
  expect(await screen.findByText('Agent connected')).toBeTruthy();
});

it('pluralizes for multiple sessions', async () => {
  mockListOauthSessions.mockResolvedValue([SESSION, { ...SESSION, id: 'sess-2' }]);
  render(<AgentStatusButton />);
  expect(await screen.findByText('2 agents connected')).toBeTruthy();
});

it('shows connect call-to-action when no sessions', async () => {
  mockListOauthSessions.mockResolvedValue([]);
  render(<AgentStatusButton />);
  expect(await screen.findByText('Connect agent')).toBeTruthy();
});

it('navigates to the agents section on click when connected', async () => {
  mockListOauthSessions.mockResolvedValue([SESSION]);
  render(<AgentStatusButton />);
  fireEvent.click(await screen.findByText('Agent connected'));
  expect(mockPush).toHaveBeenCalledWith('/account#agents');
});

it('navigates with connect=1 on click when disconnected', async () => {
  mockListOauthSessions.mockResolvedValue([]);
  render(<AgentStatusButton />);
  fireEvent.click(await screen.findByText('Connect agent'));
  expect(mockPush).toHaveBeenCalledWith('/account?connect=1#agents');
});

it('renders nothing when the fetch fails', async () => {
  mockListOauthSessions.mockRejectedValue(new Error('network'));
  const { container } = render(<AgentStatusButton />);
  await waitFor(() => expect(mockListOauthSessions).toHaveBeenCalled());
  await waitFor(() => expect(container.firstChild).toBeNull());
});
