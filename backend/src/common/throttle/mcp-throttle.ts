/**
 * McpThrottleService — in-memory sliding-window rate limiter.
 *
 * Exposes a synchronous `hit(key, limit, windowSec)` method. Callers that
 * are not NestJS guards (e.g. the MCP auth helper) can use this directly
 * without having to work around the @nestjs/throttler guard lifecycle.
 *
 * Implementation: a Map<string, number[]> of hit timestamps. Each call
 * prunes timestamps older than the window, increments, then checks against
 * the limit.
 *
 * Single-instance only — acceptable for V1 (same as belong-mc).
 * The service is @Injectable() so it can be provided in any NestJS module
 * and injected into both the McpIpThrottlerGuard and the MCP auth helper.
 */

import { Injectable } from '@nestjs/common';

export interface ThrottleResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying. Present when allowed=false. */
  retryAfterSec?: number;
}

@Injectable()
export class McpThrottleService {
  private readonly buckets = new Map<string, number[]>();

  /**
   * Record a hit for `key` and return whether it is within the rate limit.
   *
   * @param key       Bucket identifier (e.g. `ip:1.2.3.4`, `session:abc`).
   * @param limit     Maximum hits allowed within `windowSec`.
   * @param windowSec Sliding-window duration in seconds.
   */
  hit(key: string, limit: number, windowSec: number): ThrottleResult {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const cutoff = now - windowMs;

    // Prune expired timestamps and get the current bucket
    const timestamps = (this.buckets.get(key) ?? []).filter(
      (ts) => ts > cutoff,
    );

    if (timestamps.length >= limit) {
      // Oldest timestamp tells us when the first slot frees up
      const oldestTs = timestamps[0];
      const retryAfterSec = Math.ceil((oldestTs + windowMs - now) / 1000);
      this.buckets.set(key, timestamps);
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }

    timestamps.push(now);
    this.buckets.set(key, timestamps);
    return { allowed: true };
  }
}
