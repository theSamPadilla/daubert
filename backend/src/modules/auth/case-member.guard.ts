import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { UserEntity } from '../../database/entities/user.entity';

/**
 * Guards routes that have `:caseId` in the URL path. Confirms the requesting
 * user is a member of that case and attaches the membership to the request.
 *
 * Script-token rejection: this guard reads `req.user`, which is set only on
 * the Firebase auth path. Script-token requests never have `req.user`, so
 * any route protected by this guard 403s for scripts. That's intentional —
 * routes shaped `/cases/:caseId/...` are user-only by design (case
 * administration, member management, conversations). Script-callable routes
 * use `:traceId` / `:investigationId` URL params and rely on service-layer
 * `assertAccess(principal, ...)` checks instead.
 */
@Injectable()
export class CaseMemberGuard implements CanActivate {
  constructor(
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: UserEntity | undefined = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const caseId = request.params.caseId;
    if (!caseId) return true; // Not a case-scoped route

    // Verify the case exists
    const caseExists = await this.caseRepo.findOneBy({ id: caseId });
    if (!caseExists) throw new NotFoundException(`Case ${caseId} not found`);

    const membership = await this.memberRepo.findOneBy({
      userId: user.id,
      caseId,
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this case');
    }

    // Attach membership for downstream role checks
    request.caseMembership = membership;
    return true;
  }
}
