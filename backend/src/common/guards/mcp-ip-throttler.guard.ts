/**
 * McpIpThrottlerGuard — pre-auth IP-level rate limiter for POST /mcp.
 *
 * Applied as a ROUTE-LEVEL guard (not global) on McpController.handleMcp.
 * Fires BEFORE the controller body, so anonymous callers are throttled before
 * any auth logic or MCP protocol handling runs.
 *
 * Decision: In-process bucket is acceptable for the IP throttle on the MCP
 * endpoint. The risk of cross-process escape is accepted for V1.
 *
 * Key: `ip:<req.ip>` (20 req/min per IP). `req.ip` is used directly —
 * Daubert's main.ts already sets `trust proxy 1`, so Express resolves
 * X-Forwarded-For safely without the guard needing to parse raw headers.
 *
 * Error format: when the bucket is exhausted, throws a standard HTTP 429,
 * NOT an MCP-shaped error. The request has not entered the MCP protocol
 * layer yet; an HTTP-level response is correct here. MCP clients handle
 * 429 as a transport error and back off.
 */

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { McpThrottleService } from '../throttle/mcp-throttle';

@Injectable()
export class McpIpThrottlerGuard implements CanActivate {
  constructor(private readonly throttle: McpThrottleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // Use req.ip only. Do NOT parse X-Forwarded-For directly — raw header
    // reads let a caller forge a different IP per request and bypass the
    // bucket. With `trust proxy 1` set in main.ts, Express resolves XFF
    // correctly and exposes the right IP via req.ip.
    const ip = req.ip || 'unknown';
    const bucketKey = `ip:${ip}`;

    // 20 requests per 60 seconds per IP.
    const result = this.throttle.hit(bucketKey, 20, 60);

    if (!result.allowed) {
      const retryAfter = result.retryAfterSec ?? 60;
      res.setHeader('Retry-After', String(retryAfter));

      // HTTP 429 — not an MCP-shaped error. The request has not entered the
      // MCP protocol layer yet; an HTTP-level response is appropriate here.
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}
