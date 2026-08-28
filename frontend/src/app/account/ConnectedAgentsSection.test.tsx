/**
 * @jest-environment jsdom
 *
 * Tests for the ConnectedAgentsSection component on the account page.
 *
 * What we care about:
 * - Lists returned OAuthSessionSummary rows (surface label + org name + dates).
 * - Empty state message when there are no sessions.
 * - Clicking revoke (with confirm stubbed to true) calls revokeOauthSession
 *   and reloads the list (listOauthSessions called again).
 * - Connect affordance calls startConnect and renders mcpUrl.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// --- Mock api-client ------------------------------------------------------
const mockListOauthSessions = jest.fn();
const mockRevokeOauthSession = jest.fn();
const mockStartConnect = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    listOauthSessions: (...args: unknown[]) => mockListOauthSessions(...args),
    revokeOauthSession: (...args: unknown[]) => mockRevokeOauthSession(...args),
    startConnect: (...args: unknown[]) => mockStartConnect(...args),
  },
}));

// --- Mock ConfirmProvider -------------------------------------------------
// useConfirm lives inside a context; we replace it with a jest.fn() that
// returns true by default (i.e. user confirmed).
const mockConfirm = jest.fn();
jest.mock('@/components/Common/ConfirmProvider', () => ({
  useConfirm: () => mockConfirm,
}));

// --- Mock AuthProvider ----------------------------------------------------
// ConnectedAgentsSection reads user.orgs to resolve org names.
const mockOrgs = [
  { id: 'org-1', slug: 'acme', name: 'Acme Corp', role: 'admin' as const },
  { id: 'org-2', slug: 'beta', name: 'Beta Labs', role: 'member' as const },
];
jest.mock('@/components/Auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Test User', email: 't@t.com', isSuperAdmin: false, orgs: mockOrgs } }),
}));

// --- Import AFTER mocks ---------------------------------------------------
import { ConnectedAgentsSection } from './ConnectedAgentsSection';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_1 = {
  id: 'sess-1',
  organizationId: 'org-1',
  surfaceLabel: 'Claude Desktop',
  lastUsedAt: '2026-06-01T10:00:00.000Z',
  createdAt: '2026-05-15T08:00:00.000Z',
};

const SESSION_2 = {
  id: 'sess-2',
  organizationId: 'org-2',
  surfaceLabel: 'Claude Code',
  lastUsedAt: null,
  createdAt: '2026-06-10T12:00:00.000Z',
};

const START_CONNECT_RESPONSE = {
  mcpUrl: 'https://mcp.example.com/sse',
  perSurfaceInstructions: {
    claudeApps: {
      steps: ['Open Claude Desktop settings.', 'Add a custom connector with the URL above.'],
      warning: 'Always allow beats Allow once — otherwise Claude asks every time.',
      note: 'Claude only — Team plans need an admin to register the connector first.',
    },
    chatgpt: {
      steps: ['Turn on developer mode under Settings, Plugins, Advanced.'],
    },
    perplexity: {
      steps: ['Click Custom connector, then choose Remote.'],
      warning: 'This path is untested and may not connect.',
      note: 'Custom connectors need Perplexity Pro, Max, or Enterprise.',
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<ConnectedAgentsSection />', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  it('shows loading state initially', () => {
    // Never resolves during this test
    mockListOauthSessions.mockReturnValue(new Promise(() => {}));
    render(<ConnectedAgentsSection />);
    // The section heading is visible even while loading
    expect(screen.getByText('Connected agents')).not.toBeNull();
  });

  it('shows empty state when no sessions are returned', async () => {
    mockListOauthSessions.mockResolvedValue([]);

    render(<ConnectedAgentsSection />);

    await waitFor(() => {
      expect(screen.getByText(/no agents connected/i)).not.toBeNull();
    });
  });

  it('lists session rows with surface label and org name', async () => {
    mockListOauthSessions.mockResolvedValue([SESSION_1, SESSION_2]);

    render(<ConnectedAgentsSection />);

    await waitFor(() => {
      expect(screen.getByText('Claude Desktop')).not.toBeNull();
    });

    expect(screen.getByText('Claude Code')).not.toBeNull();
    // Org names resolved from mocked user.orgs
    expect(screen.getByText('Acme Corp')).not.toBeNull();
    expect(screen.getByText('Beta Labs')).not.toBeNull();
  });

  it('calls revokeOauthSession and reloads sessions when revoke is confirmed', async () => {
    // First load returns two sessions; second (reload) returns one.
    mockListOauthSessions
      .mockResolvedValueOnce([SESSION_1, SESSION_2])
      .mockResolvedValueOnce([SESSION_2]);
    mockRevokeOauthSession.mockResolvedValue(undefined);

    render(<ConnectedAgentsSection />);

    // Wait for list to render
    await waitFor(() => {
      expect(screen.getByText('Claude Desktop')).not.toBeNull();
    });

    // Find the first revoke button (aria-label includes "Revoke" or title)
    const revokeButtons = screen.getAllByTitle(/revoke/i);
    expect(revokeButtons.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(revokeButtons[0]);
    });

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockRevokeOauthSession).toHaveBeenCalledWith(SESSION_1.id);
      // listOauthSessions was called once on mount and once more after revoke
      expect(mockListOauthSessions).toHaveBeenCalledTimes(2);
    });
  });

  it('does NOT call revokeOauthSession when revoke is cancelled', async () => {
    mockListOauthSessions.mockResolvedValue([SESSION_1]);
    mockConfirm.mockResolvedValue(false); // user cancelled

    render(<ConnectedAgentsSection />);

    await waitFor(() => {
      expect(screen.getByText('Claude Desktop')).not.toBeNull();
    });

    const revokeButton = screen.getByTitle(/revoke/i);
    await act(async () => {
      fireEvent.click(revokeButton);
    });

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(1);
    });
    expect(mockRevokeOauthSession).not.toHaveBeenCalled();
    // No reload
    expect(mockListOauthSessions).toHaveBeenCalledTimes(1);
  });

  it('calls startConnect and renders the mcpUrl when Connect is clicked', async () => {
    mockListOauthSessions.mockResolvedValue([]);
    mockStartConnect.mockResolvedValue(START_CONNECT_RESPONSE);

    render(<ConnectedAgentsSection />);

    await waitFor(() => {
      expect(screen.getByText(/no agents connected/i)).not.toBeNull();
    });

    const connectButton = screen.getByRole('button', { name: /connect an agent/i });
    await act(async () => {
      fireEvent.click(connectButton);
    });

    await waitFor(() => {
      expect(mockStartConnect).toHaveBeenCalledTimes(1);
    });

    // Both copyable values should be visible in the UI
    expect(screen.getByText('https://mcp.example.com/sse')).not.toBeNull();
    expect(screen.getByText('Daubert')).not.toBeNull();
    // Claude tab is active by default: numbered steps + warning + note visible
    expect(screen.getByText(/Open Claude Desktop settings/i)).not.toBeNull();
    expect(screen.getByText(/Always allow beats Allow once/i)).not.toBeNull();
    expect(screen.getByText(/Team plans need an admin/i)).not.toBeNull();

    // Switch to the ChatGPT tab: its steps become visible
    fireEvent.click(screen.getByRole('tab', { name: /chatgpt/i }));
    expect(screen.getByText(/Turn on developer mode/i)).not.toBeNull();
    // Claude steps, warning and note are no longer shown
    expect(screen.queryByText(/Open Claude Desktop settings/i)).toBeNull();
    expect(screen.queryByText(/Always allow beats Allow once/i)).toBeNull();
    expect(screen.queryByText(/Team plans need an admin/i)).toBeNull();
  });

  it('reaches the Perplexity instructions through the Other agents dropdown', async () => {
    mockListOauthSessions.mockResolvedValue([]);
    mockStartConnect.mockResolvedValue(START_CONNECT_RESPONSE);

    render(<ConnectedAgentsSection />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /connect an agent/i }));
    });
    await waitFor(() => {
      expect(mockStartConnect).toHaveBeenCalledTimes(1);
    });

    // Perplexity is NOT a top-level tab — it lives behind the dropdown.
    expect(screen.queryByRole('tab', { name: /perplexity/i })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /other agents/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /perplexity/i }));

    expect(screen.getByText(/Click Custom connector/i)).not.toBeNull();
    expect(screen.getByText(/untested and may not connect/i)).not.toBeNull();
    expect(screen.getByText(/Pro, Max, or Enterprise/i)).not.toBeNull();
    // The dropdown trigger now names the selected agent.
    expect(screen.getByRole('tab', { name: /perplexity/i })).not.toBeNull();
    // Claude's steps are gone.
    expect(screen.queryByText(/Open Claude Desktop settings/i)).toBeNull();
  });

  it('auto-opens connect instructions when ?connect=1 is in the URL', async () => {
    mockListOauthSessions.mockResolvedValue([]);
    mockStartConnect.mockResolvedValue(START_CONNECT_RESPONSE);
    window.history.pushState({}, '', '/account?connect=1#agents');

    try {
      render(<ConnectedAgentsSection />);

      await waitFor(() => {
        expect(mockStartConnect).toHaveBeenCalledTimes(1);
      });
      expect(await screen.findByText('https://mcp.example.com/sse')).not.toBeNull();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('does not auto-open connect instructions without ?connect=1', async () => {
    mockListOauthSessions.mockResolvedValue([]);

    render(<ConnectedAgentsSection />);

    await waitFor(() => {
      expect(screen.getByText(/no agents connected/i)).not.toBeNull();
    });
    expect(mockStartConnect).not.toHaveBeenCalled();
  });

  it('shows an error banner when listOauthSessions fails', async () => {
    mockListOauthSessions.mockRejectedValue(new Error('Network error'));

    render(<ConnectedAgentsSection />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).not.toBeNull();
    });
  });
});
