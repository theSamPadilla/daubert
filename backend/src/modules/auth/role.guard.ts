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
import { CaseMemberEntity, CaseRole } from '../../database/entities/case-member.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { REQUIRED_ROLE_KEY, roleAtLeast } from './require-role.decorator';

/**
 * Replaces the old CaseMemberGuard. Reads the `:caseId` URL parameter, looks
 * up the requesting user's membership, and enforces the minimum role declared
 * by `@RequireRole(minRole)` on the route.
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
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
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

    const membership = await this.memberRepo.findOneBy({ userId: user.id, caseId });
    if (!membership) throw new ForbiddenException('You do not have access to this case');

    const minRole =
      this.reflector.getAllAndOverride<CaseRole>(REQUIRED_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'viewer';

    if (!roleAtLeast(membership.role, minRole)) {
      throw new ForbiddenException(`Requires role '${minRole}' or higher`);
    }

    request.caseMembership = membership;
    return true;
  }
}
