import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { CaseRole } from '../../database/entities/case-member.entity';
import { RoleGuard } from './role.guard';

export const REQUIRED_ROLE_KEY = 'requiredRole';

export const ROLE_HIERARCHY: Record<CaseRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

export function roleAtLeast(actual: CaseRole, required: CaseRole): boolean {
  return ROLE_HIERARCHY[actual] >= ROLE_HIERARCHY[required];
}

/**
 * Route decorator: requires the caller to be a member of the case at `:caseId`
 * with at least `minRole`. Combines metadata + RoleGuard so callers only write
 * one decorator.
 */
export const RequireRole = (minRole: CaseRole) =>
  applyDecorators(SetMetadata(REQUIRED_ROLE_KEY, minRole), UseGuards(RoleGuard));
