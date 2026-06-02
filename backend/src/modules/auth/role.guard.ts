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
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { REQUIRED_ROLE_KEY, roleAtLeast } from './require-role.decorator';

/**
 * Replaces the old CaseMemberGuard. Reads the `:caseId` URL parameter, looks
 * up the requesting user's membership, and enforces the minimum role declared
 * by `@RequireRole(minRole)` on the route.
 *
 * Org-admin short-circuit: if the user is an org admin of the case's host org,
 * they are treated as case owner regardless of any case_members row.
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
    @InjectRepository(OrganizationMemberEntity)
    private readonly orgMemberRepo: Repository<OrganizationMemberEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
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

    // Org-admin short-circuit: if the user is an admin of the case's host org
    // AND the org is not soft-deleted, grant implicit owner-equivalent access.
    const orgMembership = await this.orgMemberRepo.findOneBy({
      userId: user.id,
      organizationId: caseExists.orgId,
    });
    if (orgMembership?.role === 'admin') {
      const org = await this.orgRepo.findOneBy({ id: caseExists.orgId });
      if (org && org.deletedAt === null) {
        request.caseMembership = {
          id: 'org-admin-implicit',
          userId: user.id,
          caseId,
          role: 'owner' as CaseRole,
          source: 'org-admin-implicit',
        };
        return true;
      }
    }

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
