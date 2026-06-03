import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseMemberEntity, CaseRole } from '../../database/entities/case-member.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationMemberEntity, OrgRole } from '../../database/entities/organization-member.entity';
import { AccessPrincipal } from './access-principal';
import { roleAtLeast } from './require-role.decorator';

/**
 * Implicit case role granted by org membership.
 * - admin → owner-equivalent (manages everything)
 * - member → editor-equivalent (full collaborator, no ownership-level powers)
 * - guest → null (must have an explicit case_members row to access)
 */
export function orgRoleToImplicitCaseRole(orgRole: OrgRole): CaseRole | null {
  if (orgRole === 'admin') return 'owner';
  if (orgRole === 'member') return 'editor';
  return null;
}

@Injectable()
export class CaseAccessService {
  constructor(
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
    @InjectRepository(OrganizationMemberEntity)
    private readonly orgMemberRepo: Repository<OrganizationMemberEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
  ) {}

  /**
   * Implicit case role derived from the user's org membership.
   * Returns a synthetic membership when applicable; null otherwise.
   * Soft-deleted orgs are NOT honored — implicit access requires an active org.
   */
  private async tryOrgImplicit(
    userId: string,
    caseId: string,
  ): Promise<CaseMemberEntity | null> {
    const caseEntity = await this.caseRepo.findOneBy({ id: caseId });
    if (!caseEntity) return null;
    const orgMembership = await this.orgMemberRepo.findOneBy({
      userId,
      organizationId: caseEntity.orgId,
    });
    if (!orgMembership) return null;
    const implicitRole = orgRoleToImplicitCaseRole(orgMembership.role);
    if (!implicitRole) return null;
    const org = await this.orgRepo.findOneBy({ id: caseEntity.orgId });
    if (!org || org.deletedAt !== null) return null;
    return {
      id: 'org-implicit',
      userId,
      caseId,
      role: implicitRole,
    } as CaseMemberEntity;
  }

  /**
   * Assert that the principal can access the given case.
   * - User principal: must be a case_members row, OR an org admin of the case's host org.
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
    if (membership) return membership;
    const implicit = await this.tryOrgImplicit(principal.userId, caseId);
    if (implicit) return implicit;
    throw new ForbiddenException('You do not have access to this case');
  }

  /**
   * Assert that the principal can access the case AND has at least `minRole`.
   * User principal: hierarchy check against the membership. Script principal:
   * hierarchy check against the role baked into the signed token.
   * Returns the membership for users; null for scripts.
   */
  async assertRole(
    principal: AccessPrincipal,
    caseId: string,
    minRole: CaseRole,
  ): Promise<CaseMemberEntity | null> {
    const membership = await this.assertAccess(principal, caseId);
    if (principal.kind === 'script') {
      // Script principal carries the initiator's case role inside the signed
      // token. Enforce the same hierarchy check we apply to user principals.
      if (!roleAtLeast(principal.role, minRole)) {
        throw new ForbiddenException(`Requires role '${minRole}' or higher`);
      }
      return null;
    }
    // User principal — assertAccess returned the membership (or threw).
    if (!roleAtLeast(membership!.role, minRole)) {
      throw new ForbiddenException(`Requires role '${minRole}' or higher`);
    }
    return membership;
  }
}
