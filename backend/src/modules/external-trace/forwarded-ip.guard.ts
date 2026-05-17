import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ForwardedIpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const fwd = (req.headers?.['x-forwarded-for'] as string | undefined) ?? '';
    const first = fwd.split(',')[0]?.trim();
    return Promise.resolve(first || req.ip || 'unknown');
  }
}
