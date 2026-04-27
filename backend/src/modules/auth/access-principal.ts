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
