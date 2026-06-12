/**
 * @jest-environment jsdom
 *
 * Tests for the OAuth authorize **bridge page**.
 *
 * The bridge exists because a real browser navigation to the BE
 * `/oauth/authorize` endpoint never carries a Firebase Bearer token. This
 * FE page picks the OAuth flow back up — it reads the Firebase session
 * client-side, calls the BE in JSON mode, and hops to the consent page.
 *
 * What we care about (matches the gap-fix acceptance criteria):
 *   - Auth still resolving → render a loader, do NOT call the BE.
 *   - Auth resolved, NO user → `router.replace('/login?return_to=...')`
 *     where return_to is `pathname + search` (relative).
 *   - Authenticated → call `apiClient.authorizeAgent(window.location.search)`
 *     with the raw search string, then `_authorizeNav.redirect(redirectUrl)`.
 *   - 401 from the BE → bounce back to /login (session evaporated).
 *   - 400 from the BE → inline error card, no redirect loop.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// --- Mock api-client ------------------------------------------------------
const mockAuthorizeAgent = jest.fn();

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
      authorizeAgent: (...args: unknown[]) => mockAuthorizeAgent(...args),
    },
  };
});

const { ApiError } = jest.requireMock('@/lib/api-client') as {
  ApiError: new (m: string, s: number) => Error & { status: number };
};

// --- Mock next/navigation -------------------------------------------------
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

// --- Mock useAuth ---------------------------------------------------------
let mockAuthState: {
  firebaseUser: { uid: string } | null;
  loading: boolean;
} = {
  firebaseUser: null,
  loading: true,
};

jest.mock('@/components/Auth/AuthProvider', () => ({
  useAuth: () => mockAuthState,
}));

// --- Mock next/image (jsdom doesn't render real <img> for next/image) ------
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return React.createElement('img', props as any);
  },
}));

// --- Import the page AFTER mocks ------------------------------------------
import OAuthAuthorizeBridgePage, { _authorizeNav } from './page';

// jsdom's `window.location` is non-configurable in jsdom 26+, so the page
// routes its outbound hop through `_authorizeNav.redirect`. We spy there.
let lastHref: string | null = null;
let redirectSpy: jest.SpyInstance;

beforeAll(() => {
  redirectSpy = jest.spyOn(_authorizeNav, 'redirect').mockImplementation((url: string) => {
    lastHref = url;
  });
});

afterAll(() => {
  redirectSpy.mockRestore();
});

/**
 * jsdom doesn't honor `window.history.pushState` query strings the way a
 * real browser does for `window.location.search`. Instead we set the URL
 * via `window.history.pushState` and rely on the page reading
 * `window.location.search` — which jsdom DOES support once we navigate.
 */
function setLocation(pathAndSearch: string) {
  window.history.pushState({}, '', pathAndSearch);
}

beforeEach(() => {
  jest.clearAllMocks();
  lastHref = null;
  mockAuthState = { firebaseUser: null, loading: true };
  setLocation('/oauth/authorize?response_type=code&client_id=claude-desktop&state=xyz');
  redirectSpy.mockImplementation((url: string) => {
    lastHref = url;
  });
});

describe('<OAuthAuthorizeBridgePage />', () => {
  it('renders a loader while auth is still resolving and does NOT call the BE', () => {
    mockAuthState = { firebaseUser: null, loading: true };

    render(<OAuthAuthorizeBridgePage />);

    expect(mockAuthorizeAgent).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('unauthenticated → router.replace to /login with return_to equal to pathname+search (relative)', async () => {
    mockAuthState = { firebaseUser: null, loading: false };

    await act(async () => {
      render(<OAuthAuthorizeBridgePage />);
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    const target = mockReplace.mock.calls[0][0] as string;
    expect(target.startsWith('/login?return_to=')).toBe(true);

    // return_to must be the relative path+search (NOT absolute), since the
    // login page only accepts relative same-origin return_tos.
    const encoded = target.slice('/login?return_to='.length);
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toBe(
      '/oauth/authorize?response_type=code&client_id=claude-desktop&state=xyz',
    );

    // Did NOT call the BE.
    expect(mockAuthorizeAgent).not.toHaveBeenCalled();
  });

  it('authenticated → calls authorizeAgent with raw search string and hops to redirectUrl', async () => {
    mockAuthState = { firebaseUser: { uid: 'fb-uid' }, loading: false };
    mockAuthorizeAgent.mockResolvedValue({
      redirectUrl: 'https://app.example.com/oauth/consent?bag=signed-bag-token',
    });

    await act(async () => {
      render(<OAuthAuthorizeBridgePage />);
    });

    await waitFor(() => {
      expect(mockAuthorizeAgent).toHaveBeenCalledTimes(1);
    });

    // Raw search passed through verbatim (with the leading ?).
    expect(mockAuthorizeAgent).toHaveBeenCalledWith(
      '?response_type=code&client_id=claude-desktop&state=xyz',
    );

    await waitFor(() => {
      expect(lastHref).toBe(
        'https://app.example.com/oauth/consent?bag=signed-bag-token',
      );
    });
  });

  it('401 from authorizeAgent → router.replace back to /login (session evaporated)', async () => {
    mockAuthState = { firebaseUser: { uid: 'fb-uid' }, loading: false };
    mockAuthorizeAgent.mockRejectedValue(new ApiError('unauthenticated', 401));

    await act(async () => {
      render(<OAuthAuthorizeBridgePage />);
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    const target = mockReplace.mock.calls[0][0] as string;
    expect(target.startsWith('/login?return_to=')).toBe(true);
    expect(lastHref).toBeNull();
  });

  it('400 from authorizeAgent → inline error card, no redirect loop', async () => {
    mockAuthState = { firebaseUser: { uid: 'fb-uid' }, loading: false };
    mockAuthorizeAgent.mockRejectedValue(new ApiError('invalid_request', 400));

    await act(async () => {
      render(<OAuthAuthorizeBridgePage />);
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
    });

    expect(
      screen.getByText(/invalid or malformed/i),
    ).not.toBeNull();

    // No navigation took place — neither router.replace nor window.location.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(lastHref).toBeNull();
  });
});
