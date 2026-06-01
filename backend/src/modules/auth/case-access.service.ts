import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseMemberEntity, CaseRole } from '../../database/entities/case-member.entity';
import { AccessPrincipal } from './access-principal';
import { roleAtLeast } from './require-role.decorator';

@Injectable()
export class CaseAccessService {
  constructor(
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
  ) {}

  /**
   * Assert that the principal can access the given case.
   * - User principal: must be a member of the case.
   * - Script principal: token's caseId must match the resource's caseId.
   * Throws ForbiddenException on mismatch.
   */
  async assertAccess(
    principal: AccessPrincipal,
    caseId: string,
  ): Promise<CaseMemberEntity | null> {
    if (principal.kind === 'script') {
      if (principal.caseId !== caseId) {
        throw new ForbiddenException('cross_case_access');
      }
      return null;
    }
    const membership = await this.memberRepo.findOneBy({
      userId: principal.userId,
      caseId,
    });
    if (!membership) {
      throw new ForbiddenException('You do not have access to this case');
    }
    return membership;
  }

  /**
   * Assert that the principal can access the case AND has at least `minRole`.
   * Script principals are admitted unconditionally (they have no role concept —
   * the script token's case binding is the access control). User principals
   * must be members with sufficient role.
   *
   * Returns the membership for user principals (so callers can branch on the
   * role for response shaping); returns null for script principals.
   */
  async assertRole(
    principal: AccessPrincipal,
    caseId: string,
    minRole: CaseRole,
  ): Promise<CaseMemberEntity | null> {
    const membership = await this.assertAccess(principal, caseId);
    if (!membership) return null; // script principal
    if (!roleAtLeast(membership.role, minRole)) {
      throw new ForbiddenException(`Requires role '${minRole}' or higher`);
    }
    return membership;
  }
}
