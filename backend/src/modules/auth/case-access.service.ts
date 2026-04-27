import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { AccessPrincipal } from './access-principal';

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
}
