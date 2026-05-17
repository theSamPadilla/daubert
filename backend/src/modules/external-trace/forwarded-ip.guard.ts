import { BadRequestException, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ForwardedIpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    // Prefer req.ip (Express-derived, validated against trust proxy setting).
    // Fall back to leftmost X-Forwarded-For only if req.ip is somehow absent.
    // Refuse to serve if we can't identify the caller — better to 400 than
    // bucket every anonymous request into a single 'unknown' counter that
    // an attacker can use to DOS legitimate visitors.
    const ip = req.ip;
    if (typeof ip === 'string' && ip.length > 0) {
      return Promise.resolve(ip);
    }
    const fwd = (req.headers?.['x-forwarded-for'] as string | undefined) ?? '';
    const first = fwd.split(',')[0]?.trim();
    if (first) return Promise.resolve(first);
    throw new BadRequestException('Unable to identify caller IP');
  }
}
