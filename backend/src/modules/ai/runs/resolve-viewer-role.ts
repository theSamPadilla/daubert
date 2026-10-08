import { CaseRole } from '../../../database/entities/case-member.entity';
import { getPrincipal } from '../../auth/access-principal';
import { CaseAccessService } from '../../auth/case-access.service';

/**
 * The caller's role on the case, which picks the agent's tool set. Defaults
 * to 'viewer' when no caseId is given, so the tool registry fails closed.
 * Callers must already have passed requireUserPrincipal: for user principals
 * assertRole returns the membership row (and throws for non-members).
 */
export async function resolveViewerRole(
  req: any,
  caseId: string | undefined,
  caseAccess: CaseAccessService,
): Promise<CaseRole> {
  if (!caseId) return 'viewer';
  const membership = await caseAccess.assertRole(getPrincipal(req), caseId, 'viewer');
  return membership!.role;
}
