import { ForbiddenException } from '@nestjs/common';

export type AccessPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'script'; caseId: string };

/**
 * Read the principal off a request. Throws if neither auth path attached one
 * — every authenticated request must have a principal.
 */
export function getPrincipal(req: any): AccessPrincipal {
  const p = req?.principal as AccessPrincipal | undefined;
  if (!p) {
    throw new ForbiddenException('No access principal on request');
  }
  return p;
}

/**
 * Read the principal off a request and assert it's a user (not a script
 * token). Use this on routes that are user-only by design — conversations,
 * case administration, member management, etc. Returns the userId for
 * downstream service calls.
 */
export function requireUserPrincipal(req: any): string {
  const principal = getPrincipal(req);
  if (principal.kind !== 'user') {
    throw new ForbiddenException('User authentication required');
  }
  return principal.userId;
}
