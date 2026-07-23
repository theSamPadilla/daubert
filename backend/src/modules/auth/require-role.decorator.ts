import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { CaseRole } from '../../database/entities/case-member.entity';
import { RoleGuard } from './role.guard';
import { REQUIRED_ROLE_KEY } from './role-hierarchy';

// Re-exported for existing importers; the definitions live in role-hierarchy.ts
// to keep this file (which imports RoleGuard) out of service/guard import chains.
export { REQUIRED_ROLE_KEY, ROLE_HIERARCHY, roleAtLeast } from './role-hierarchy';

/**
 * Route decorator: requires the caller to be a member of the case at `:caseId`
 * with at least `minRole`. Combines metadata + RoleGuard so callers only write
 * one decorator.
 */
export const RequireRole = (minRole: CaseRole) =>
  applyDecorators(SetMetadata(REQUIRED_ROLE_KEY, minRole), UseGuards(RoleGuard));
