import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

/**
 * Admits only Cloud Tasks deliveries: a Google-signed OIDC token whose
 * audience is our worker URL and whose subject is the dedicated invoker
 * service account. Without that config (dev), runs dispatch in-process and
 * this route does not exist.
 */
@Injectable()
export class CloudTasksOidcGuard implements CanActivate {
  private readonly client = new OAuth2Client();
  private readonly audience: string | undefined;
  private readonly invokerEmail: string | undefined;

  constructor(config: ConfigService) {
    this.audience = config.get<string>('AGENT_RUNS_WORKER_URL');
    this.invokerEmail = config.get<string>('AGENT_RUNS_INVOKER_SA');
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.audience || !this.invokerEmail) throw new NotFoundException();

    const header = ctx.switchToHttp().getRequest().headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing OIDC token');
    }

    let payload: { email?: string; email_verified?: boolean } | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: header.slice(7), audience: this.audience });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid OIDC token');
    }
    if (!payload?.email_verified || payload.email !== this.invokerEmail) {
      throw new UnauthorizedException('Unexpected token subject');
    }
    return true;
  }
}
