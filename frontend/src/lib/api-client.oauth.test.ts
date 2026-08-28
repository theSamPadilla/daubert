/**
 * Unit tests for OAuth/sessions api-client methods.
 *
 * Mocks:
 *  - global.fetch  — intercepted to assert URL + method without hitting the network
 *  - ../lib/firebase — silenced so auth-header injection is a no-op
 */

// Silence the firebase module so `getFirebaseAuth().currentUser` returns null
jest.mock('./firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: null }),
}));

// We import apiClient AFTER the mock is registered
import { apiClient } from './api-client';

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// previewConsent
// ---------------------------------------------------------------------------
describe('previewConsent', () => {
  it('issues POST /oauth/authorize/preview with bag in body', async () => {
    const spy = mockFetch(200, { clientId: 'c', clientDisplayName: 'C', redirectUri: 'https://x', clientState: null, eligibleOrgs: [] });
    await apiClient.previewConsent('bag123');
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/oauth\/authorize\/preview$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ bag: 'bag123' });
  });
});

// ---------------------------------------------------------------------------
// completeConsent
// ---------------------------------------------------------------------------
describe('completeConsent', () => {
  it('issues POST /oauth/authorize/complete with bag + organizationId', async () => {
    const spy = mockFetch(200, { redirectUrl: 'https://redirect' });
    await apiClient.completeConsent('bag456', 'org-uuid');
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/oauth\/authorize\/complete$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ bag: 'bag456', organizationId: 'org-uuid' });
  });
});

// ---------------------------------------------------------------------------
// denyConsent
// ---------------------------------------------------------------------------
describe('denyConsent', () => {
  it('issues POST /oauth/authorize/deny with bag in body', async () => {
    const spy = mockFetch(200, { redirectUrl: 'https://deny-redirect' });
    await apiClient.denyConsent('bag789');
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/oauth\/authorize\/deny$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ bag: 'bag789' });
  });
});

// ---------------------------------------------------------------------------
// listOauthSessions
// ---------------------------------------------------------------------------
describe('listOauthSessions', () => {
  it('issues GET /me/oauth-sessions', async () => {
    const spy = mockFetch(200, []);
    await apiClient.listOauthSessions();
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/me\/oauth-sessions$/);
    expect(opts?.method).toBeUndefined(); // GET is the default
  });
});

// ---------------------------------------------------------------------------
// revokeOauthSession
// ---------------------------------------------------------------------------
describe('revokeOauthSession', () => {
  it('issues POST /me/oauth-sessions/:id/revoke', async () => {
    // Use 200 with empty body to avoid Response(204) constructor constraints in jsdom
    const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('', {
        status: 200,
        headers: { 'Content-Length': '0' },
      }),
    );
    await apiClient.revokeOauthSession('x');
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/me\/oauth-sessions\/x\/revoke$/);
    expect(opts.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// startConnect
// ---------------------------------------------------------------------------
describe('startConnect', () => {
  it('issues POST /me/oauth/start-connect', async () => {
    const body = { mcpUrl: 'https://mcp', perSurfaceInstructions: { claudeApps: 'a', chatgpt: 'b' } };
    const spy = mockFetch(200, body);
    const result = await apiClient.startConnect();
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/me\/oauth\/start-connect$/);
    expect(opts.method).toBe('POST');
    expect(result).toEqual(body);
  });
});
