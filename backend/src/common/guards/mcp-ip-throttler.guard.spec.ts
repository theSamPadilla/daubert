/**
 * McpIpThrottlerGuard — unit specs.
 *
 * Coverage:
 *   1. Allowed request — canActivate returns true.
 *   2. Bucket exhausted — throws 429 with Retry-After header.
 *   3. Retry-After defaults to 60 when retryAfterSec is undefined.
 *   4. Uses req.ip only (not raw X-Forwarded-For).
 */

import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

import { McpThrottleService } from '../throttle/mcp-throttle';
import { McpIpThrottlerGuard } from './mcp-ip-throttler.guard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(ip: string): ExecutionContext {
  const req = { ip };
  const res = { setHeader: jest.fn() };

  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpIpThrottlerGuard', () => {
  let throttleSvc: jest.Mocked<McpThrottleService>;
  let guard: McpIpThrottlerGuard;

  beforeEach(() => {
    throttleSvc = {
      hit: jest.fn(),
    } as unknown as jest.Mocked<McpThrottleService>;

    guard = new McpIpThrottlerGuard(throttleSvc);
  });

  // -------------------------------------------------------------------------
  // 1. Allowed request
  // -------------------------------------------------------------------------

  it('returns true when the bucket is not exhausted', async () => {
    throttleSvc.hit.mockReturnValueOnce({ allowed: true });

    const ctx = makeContext('192.168.1.1');
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(throttleSvc.hit).toHaveBeenCalledWith('ip:192.168.1.1', 20, 60);
  });

  // -------------------------------------------------------------------------
  // 2. Bucket exhausted → 429 + Retry-After
  // -------------------------------------------------------------------------

  it('throws 429 with Retry-After when bucket is exhausted', async () => {
    throttleSvc.hit.mockReturnValueOnce({ allowed: false, retryAfterSec: 42 });

    const ctx = makeContext('10.0.0.1');
    const res = (ctx.switchToHttp() as any).getResponse() as {
      setHeader: jest.Mock;
    };

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
    );

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '42');
  });

  // -------------------------------------------------------------------------
  // 3. Retry-After defaults to 60 when retryAfterSec is undefined
  // -------------------------------------------------------------------------

  it('defaults Retry-After to 60 when retryAfterSec is undefined', async () => {
    throttleSvc.hit.mockReturnValueOnce({ allowed: false });

    const ctx = makeContext('10.0.0.2');
    const res = (ctx.switchToHttp() as any).getResponse() as {
      setHeader: jest.Mock;
    };

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  // -------------------------------------------------------------------------
  // 4. Uses req.ip only — does not parse raw X-Forwarded-For
  // -------------------------------------------------------------------------

  it('buckets by req.ip only (Express trust proxy resolves XFF safely)', async () => {
    throttleSvc.hit.mockReturnValueOnce({ allowed: true });

    // req.ip already resolved by Express (trust proxy is set in main.ts)
    const ctx = makeContext('10.0.0.3');
    await guard.canActivate(ctx);

    expect(throttleSvc.hit).toHaveBeenCalledWith('ip:10.0.0.3', 20, 60);
  });
});
