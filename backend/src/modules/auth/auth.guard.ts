import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as admin from 'firebase-admin';
import { FIREBASE_ADMIN } from './firebase-admin.provider';
import { UsersService } from '../users/users.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ScriptTokenService } from '../script/script-token.service';
import { AccessPrincipal } from './access-principal';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    @Inject(FIREBASE_ADMIN) private readonly firebaseApp: admin.app.App,
    private readonly usersService: UsersService,
    private readonly reflector: Reflector,
    private readonly scriptToken: ScriptTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip auth for routes decorated with @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();

    // --- Path 1: script token ---
    const scriptHeader = request.headers['x-script-token'];
    if (scriptHeader) {
      const result = this.scriptToken.verify(
        Array.isArray(scriptHeader) ? scriptHeader[0] : scriptHeader,
      );
      if (!result) throw new UnauthorizedException('invalid_script_token');
      const principal: AccessPrincipal = { kind: 'script', caseId: result.caseId };
      request.principal = principal;
      // NOTE: do NOT set request.user — keeps IsAdminGuard / CaseMemberGuard
      // (which both read request.user) impervious to script tokens.
      this.logger.debug(
        `[script-auth] ${request.method} ${request.url} caseId=${result.caseId}`,
      );
      return true;
    }

    // --- Path 2: Firebase Bearer ---
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    const token = authHeader.slice(7);

    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await this.firebaseApp.auth().verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    let user = await this.usersService.findByFirebaseUid(decoded.uid);
    if (!user && decoded.email) {
      user = await this.usersService.findByEmail(decoded.email);
      if (user) {
        user = await this.usersService.linkFirebaseUid(user.id, decoded.uid, {
          name: decoded.name || user.name,
          avatarUrl: decoded.picture || null,
        });
      }
    }
    if (!user) {
      throw new ForbiddenException({
        code: 'NO_ACCOUNT',
        message: `No account found for ${decoded.email}. Contact your administrator.`,
      });
    }

    request.user = user;
    request.principal = { kind: 'user', userId: user.id } satisfies AccessPrincipal;
    return true;
  }
}
