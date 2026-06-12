import { ForbiddenException } from '@nestjs/common';
import { CaseRole } from '../../database/entities/case-member.entity';

export type AccessPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'script'; caseId: string; role: CaseRole }
  | { kind: 'mcp'; userId: string; organizationId: string; sessionId: string };

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

/**
 * Read the principal off a request and assert it's an MCP principal (a request
 * authenticated via the OAuth-backed MCP server, bound to a user + organization
 * pair). Use this on MCP-only routes when the handler needs to read the bound
 * org/user/session directly. Returns the principal for downstream use.
 */
export function requireMcpPrincipal(req: any): {
  kind: 'mcp';
  userId: string;
  organizationId: string;
  sessionId: string;
} {
  const principal = getPrincipal(req);
  if (principal.kind !== 'mcp') {
    throw new ForbiddenException('MCP authentication required');
  }
  return principal;
}
