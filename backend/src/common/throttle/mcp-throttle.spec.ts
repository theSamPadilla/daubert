/**
 * McpThrottleService — unit specs.
 *
 * Coverage:
 *   1. Allowed on first hit.
 *   2. Allowed on hit up to limit.
 *   3. Denied on hit exceeding limit (within window).
 *   4. Allowed again after the window has passed (fake timers).
 *   5. retryAfterSec is a positive value when denied.
 */

import { McpThrottleService } from './mcp-throttle';

describe('McpThrottleService', () => {
  let svc: McpThrottleService;

  beforeEach(() => {
    jest.useFakeTimers();
    svc = new McpThrottleService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 1. Allowed on first hit
  // -------------------------------------------------------------------------

  it('allows the first hit', () => {
    const result = svc.hit('k', 2, 60);
    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Allowed on hit exactly at the limit
  // -------------------------------------------------------------------------

  it('allows hits up to the limit', () => {
    svc.hit('k', 2, 60); // hit 1
    const result = svc.hit('k', 2, 60); // hit 2 — at limit
    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. Denied on the hit that exceeds the limit within the window
  // -------------------------------------------------------------------------

  it('denies the hit that exceeds the limit within the window', () => {
    svc.hit('k', 2, 60); // hit 1
    svc.hit('k', 2, 60); // hit 2
    const result = svc.hit('k', 2, 60); // hit 3 — over limit
    expect(result.allowed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. retryAfterSec is a positive integer when denied
  // -------------------------------------------------------------------------

  it('returns a positive retryAfterSec when denied', () => {
    svc.hit('k', 2, 60);
    svc.hit('k', 2, 60);
    const result = svc.hit('k', 2, 60);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 5. Allowed again after the window has passed
  // -------------------------------------------------------------------------

  it('allows again after the window passes', () => {
    svc.hit('k', 2, 60); // hit 1
    svc.hit('k', 2, 60); // hit 2

    // Advance past the 60-second window
    jest.advanceTimersByTime(61_000);

    const result = svc.hit('k', 2, 60); // hit 1 in new window
    expect(result.allowed).toBe(true);
  });
});
