import { CaseRole } from '../../database/entities/case-member.entity';

/**
 * Pure role-hierarchy helpers, dependency-free by design. Both
 * `CaseAccessService` and `RoleGuard` import from here rather than from
 * `require-role.decorator.ts` — the decorator imports `RoleGuard`, so pulling
 * these helpers from it would create a circular import that leaves the guard's
 * constructor metadata undefined at decoration time (Nest then reports
 * "can't resolve dependencies of the RoleGuard (Reflector, ?, ...)").
 */
export const REQUIRED_ROLE_KEY = 'requiredRole';

export const ROLE_HIERARCHY: Record<CaseRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

export function roleAtLeast(actual: CaseRole, required: CaseRole): boolean {
  return ROLE_HIERARCHY[actual] >= ROLE_HIERARCHY[required];
}
