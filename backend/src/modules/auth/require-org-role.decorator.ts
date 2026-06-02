import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { OrgRole } from '../../database/entities/organization-member.entity';
import { OrgRoleGuard } from './org-role.guard';

export const REQUIRED_ORG_ROLE_KEY = 'requiredOrgRole';

export const ORG_ROLE_HIERARCHY: Record<OrgRole, number> = {
  guest: 0,
  member: 1,
  admin: 2,
};

export function orgRoleAtLeast(actual: OrgRole, required: OrgRole): boolean {
  return ORG_ROLE_HIERARCHY[actual] >= ORG_ROLE_HIERARCHY[required];
}

export const RequireOrgRole = (minRole: OrgRole) =>
  applyDecorators(SetMetadata(REQUIRED_ORG_ROLE_KEY, minRole), UseGuards(OrgRoleGuard));
