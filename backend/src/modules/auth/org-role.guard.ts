import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserEntity, OrgRole } from '../../database/entities/user.entity';
import { REQUIRED_ORG_ROLE_KEY, orgRoleAtLeast } from './require-org-role.decorator';

/**
 * Org-wide role gate. Reads `req.user.orgRole` and compares to the route's
 * declared minimum via `@RequireOrgRole(minRole)`. Script-token requests have
 * no `req.user`, so any route gated by this guard 403s for scripts. That's
 * intentional — org-wide routes are user-only.
 */
@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: UserEntity | undefined = request.user;
    if (!user) throw new ForbiddenException('Authentication required');

    const minRole = this.reflector.getAllAndOverride<OrgRole>(REQUIRED_ORG_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!minRole) {
      throw new Error('OrgRoleGuard used without @RequireOrgRole — declare a minimum role');
    }

    if (!orgRoleAtLeast(user.orgRole, minRole)) {
      throw new ForbiddenException(`Requires org role '${minRole}' or higher`);
    }
    return true;
  }
}
