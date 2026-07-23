import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseRole } from '../../database/entities/case-member.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { CaseAccessService } from './case-access.service';
import { REQUIRED_ROLE_KEY } from './role-hierarchy';

/**
 * Replaces the old CaseMemberGuard. Reads the `:caseId` URL parameter and
 * enforces the minimum role declared by `@RequireRole(minRole)` on the route.
 *
 * Resolution is delegated to `CaseAccessService.assertRole` with a user
 * principal, so route-guarded `:caseId` routes and service-layer id-scoped
 * routes resolve access identically: explicit `case_members` row first, then
 * the implicit org role (admin -> owner, member -> editor, guest -> none;
 * soft-deleted orgs grant nothing). The guard itself only keeps the
 * case-existence check, because a missing case should read as 404 here while
 * the service reports an opaque 403.
 *
 * Script-token rejection: this guard reads `req.user`, which the auth path
 * sets only for Firebase-authenticated requests. Script-token requests have
 * `req.principal.kind === 'script'` but no `req.user`, so any route guarded
 * by this guard 403s for scripts. That's intentional — script-callable routes
 * use `:traceId` / `:investigationId` URL params and rely on the service
 * layer's `CaseAccessService.assertAccess` / `assertRole` checks instead.
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly caseAccess: CaseAccessService,
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: UserEntity | undefined = request.user;
    if (!user) throw new ForbiddenException('Authentication required');

    const caseId = request.params.caseId;
    if (!caseId) {
      throw new ForbiddenException('RoleGuard applied to a non-case route');
    }

    const caseExists = await this.caseRepo.findOneBy({ id: caseId });
    if (!caseExists) throw new NotFoundException(`Case ${caseId} not found`);

    const minRole =
      this.reflector.getAllAndOverride<CaseRole>(REQUIRED_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'viewer';

    request.caseMembership = await this.caseAccess.assertRole(
      { kind: 'user', userId: user.id },
      caseId,
      minRole,
    );
    return true;
  }
}
