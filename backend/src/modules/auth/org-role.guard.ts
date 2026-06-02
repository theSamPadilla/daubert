import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationMemberEntity, OrgRole } from '../../database/entities/organization-member.entity';
import { REQUIRED_ORG_ROLE_KEY, orgRoleAtLeast } from './require-org-role.decorator';

@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(OrganizationMemberEntity)
    private readonly memberRepo: Repository<OrganizationMemberEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required');

    const orgSlug: string | undefined = request.params?.org;
    if (!orgSlug) throw new ForbiddenException('OrgRoleGuard applied to a non-org route');

    const minRole = this.reflector.getAllAndOverride<OrgRole>(REQUIRED_ORG_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? 'guest';

    const org = await this.orgRepo.findOneBy({ slug: orgSlug, deletedAt: IsNull() });
    if (!org) throw new NotFoundException(`Organization ${orgSlug} not found`);

    const membership = await this.memberRepo.findOneBy({ userId: user.id, organizationId: org.id });
    if (!membership) throw new ForbiddenException('You do not have access to this organization');

    if (!orgRoleAtLeast(membership.role, minRole)) {
      throw new ForbiddenException(`Requires org role '${minRole}' or higher`);
    }

    request.organization = org;
    request.orgMembership = membership;
    return true;
  }
}
