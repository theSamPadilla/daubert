import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class WebsiteKeyGuard implements CanActivate {
  private readonly logger = new Logger(WebsiteKeyGuard.name);
  private readonly expected: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('DAUBERT_WEBSITE_API_KEY');
    if (!raw || raw.length < 16) {
      throw new Error(
        'DAUBERT_WEBSITE_API_KEY must be set (>=16 chars). The external trace endpoint refuses to start without it.',
      );
    }
    this.expected = Buffer.from(raw, 'utf8');
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    // Node lowercases all incoming HTTP header names. No uppercase fallback needed.
    const provided = req.headers['x-daubert-website-key'];

    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException('Missing X-Daubert-Website-Key header');
    }

    const got = Buffer.from(provided, 'utf8');
    if (got.length !== this.expected.length) {
      throw new UnauthorizedException('Invalid X-Daubert-Website-Key');
    }
    if (!timingSafeEqual(got, this.expected)) {
      throw new UnauthorizedException('Invalid X-Daubert-Website-Key');
    }
    return true;
  }
}
