/**
 * @jest-environment jsdom
 *
 * Tests for the OAuth consent <ConsentScreen />.
 *
 * What we care about:
 * - Allow is disabled until an org is selected.
 * - If exactly one eligible org is returned, it is preselected and Allow is
 *   enabled immediately.
 * - If zero eligible orgs are returned, an inline error replaces the form.
 * - Clicking Allow calls `apiClient.completeConsent(bag, selectedOrgId)` and
 *   navigates to the returned redirectUrl.
 * - Clicking Deny calls `apiClient.denyConsent(bag)` and navigates.
 * - A 403 from `completeConsent` shows an inline error (eligibility lost).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { components } from '@/generated/api-types';

// --- Mock api-client ------------------------------------------------------
const mockCompleteConsent = jest.fn();
const mockDenyConsent = jest.fn();

jest.mock('@/lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  return {
    ApiError,
    apiClient: {
      completeConsent: (...args: unknown[]) => mockCompleteConsent(...args),
      denyConsent: (...args: unknown[]) => mockDenyConsent(...args),
    },
  };
});

// Pull the mocked ApiError out for tests that need to throw it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ApiError } = jest.requireMock('@/lib/api-client') as { ApiError: new (m: string, s: number) => Error & { status: number } };

// --- Import the component AFTER mocks ------------------------------------
import { ConsentScreen, _consentNav } from './ConsentScreen';

type Preview = components['schemas']['OAuthConsentPreview'];

const BASE_PREVIEW: Preview = {
  clientId: 'client-abc',
  clientDisplayName: 'Claude Desktop',
  redirectUri: 'https://example.com/callback',
  clientState: 'opaque-state',
  eligibleOrgs: [
    { id: 'org-1', slug: 'acme', name: 'Acme', role: 'member' },
    { id: 'org-2', slug: 'beta', name: 'Beta Co', role: 'admin' },
  ],
};

// jsdom's `window.location` is non-configurable in jsdom 26+, so the
// component routes all navigation through the `_consentNav.redirect`
// module-local seam. We spy on that here.
let lastHref: string | null = null;
let redirectSpy: jest.SpyInstance;

beforeAll(() => {
  redirectSpy = jest.spyOn(_consentNav, 'redirect').mockImplementation((url: string) => {
    lastHref = url;
  });
});

afterAll(() => {
  redirectSpy.mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  lastHref = null;
  // jest.clearAllMocks clears the spy's call history but not the impl.
  redirectSpy.mockImplementation((url: string) => {
    lastHref = url;
  });
});

describe('<ConsentScreen />', () => {
  it('disables Allow until an org is picked when there are multiple eligible orgs', () => {
    render(<ConsentScreen bag="bag-xyz" preview={BASE_PREVIEW} />);

    const allow = screen.getByRole('button', { name: /allow/i }) as HTMLButtonElement;
    expect(allow.disabled).toBe(true);
  });

  it('preselects the only eligible org and enables Allow', () => {
    const preview: Preview = {
      ...BASE_PREVIEW,
      eligibleOrgs: [{ id: 'org-1', slug: 'acme', name: 'Acme', role: 'member' }],
    };
    render(<ConsentScreen bag="bag-xyz" preview={preview} />);

    const allow = screen.getByRole('button', { name: /allow/i }) as HTMLButtonElement;
    expect(allow.disabled).toBe(false);
  });

  it('shows the no-eligible-orgs state and no Allow button when eligibleOrgs is empty', () => {
    const preview: Preview = { ...BASE_PREVIEW, eligibleOrgs: [] };
    render(<ConsentScreen bag="bag-xyz" preview={preview} />);

    expect(screen.getByText(/admin or member of an organization/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /allow/i })).toBeNull();
  });

  it('calls completeConsent with the selected org and navigates on Allow', async () => {
    mockCompleteConsent.mockResolvedValue({ redirectUrl: 'https://example.com/callback?code=abc' });

    render(<ConsentScreen bag="bag-xyz" preview={BASE_PREVIEW} />);

    // Pick org-2 in the <select>.
    const select = screen.getByLabelText(/organization/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'org-2' } });

    const allow = screen.getByRole('button', { name: /allow/i }) as HTMLButtonElement;
    expect(allow.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(allow);
    });

    await waitFor(() => {
      expect(mockCompleteConsent).toHaveBeenCalledWith('bag-xyz', 'org-2');
    });
    expect(lastHref).toBe('https://example.com/callback?code=abc');
  });

  it('calls denyConsent and navigates on Deny', async () => {
    mockDenyConsent.mockResolvedValue({ redirectUrl: 'https://example.com/callback?error=access_denied' });

    render(<ConsentScreen bag="bag-xyz" preview={BASE_PREVIEW} />);

    const deny = screen.getByRole('button', { name: /deny/i });
    await act(async () => {
      fireEvent.click(deny);
    });

    await waitFor(() => {
      expect(mockDenyConsent).toHaveBeenCalledWith('bag-xyz');
    });
    expect(lastHref).toBe('https://example.com/callback?error=access_denied');
  });

  it('shows an inline error if completeConsent returns 403 (eligibility lost)', async () => {
    mockCompleteConsent.mockRejectedValue(new ApiError('Forbidden', 403));

    const preview: Preview = {
      ...BASE_PREVIEW,
      eligibleOrgs: [{ id: 'org-1', slug: 'acme', name: 'Acme', role: 'member' }],
    };
    render(<ConsentScreen bag="bag-xyz" preview={preview} />);

    const allow = screen.getByRole('button', { name: /allow/i });
    await act(async () => {
      fireEvent.click(allow);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/no longer eligible|lost access|forbidden|eligibility/i),
      ).not.toBeNull();
    });
    // Did NOT navigate.
    expect(lastHref).toBeNull();
  });
});
