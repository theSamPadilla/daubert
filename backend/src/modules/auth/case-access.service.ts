import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';

/**
 * Shared service for verifying case membership.
 * Inject this into any service that needs to check whether a user
 * has access to a resource's parent case.
 */
@Injectable()
export class CaseAccessService {
  constructor(
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
  ) {}

  /**
   * Throws ForbiddenException if the user is not a member of the case.
   * Returns the membership record on success.
   */
  async assertAccess(userId: string, caseId: string): Promise<CaseMemberEntity> {
    const membership = await this.memberRepo.findOneBy({ userId, caseId });
    if (!membership) {
      throw new ForbiddenException('You do not have access to this case');
    }
    return membership;
  }
}
