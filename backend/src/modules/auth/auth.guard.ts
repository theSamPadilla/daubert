import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as admin from 'firebase-admin';
import { FIREBASE_ADMIN } from './firebase-admin.provider';
import { UsersService } from '../users/users.service';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(FIREBASE_ADMIN) private readonly firebaseApp: admin.app.App,
    private readonly usersService: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip auth for routes decorated with @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();

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

    // Try to find user by firebaseUid
    let user = await this.usersService.findByFirebaseUid(decoded.uid);

    // Email-match auto-link: first login for a pre-created user
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
        message: `No account found for ${decoded.email}. Contact your administrator to get access.`,
      });
    }

    // Attach user to request for downstream use
    request.user = user;
    return true;
  }
}
