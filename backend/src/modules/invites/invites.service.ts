import { Injectable, NotFoundException, ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { customAlphabet } from 'nanoid';
import { CaseInviteEntity, InviteRole } from '../../database/entities/case-invite.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { UserEntity } from '../../database/entities/user.entity';

const INVITE_TTL_DAYS = 14;
const generateCode = customAlphabet('23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', 16);

export type InviteLookupStatus = 'pending' | 'used' | 'expired' | 'revoked';

@Injectable()
export class InvitesService {
  constructor(
    @InjectRepository(CaseInviteEntity)
    private readonly inviteRepo: Repository<CaseInviteEntity>,
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(caseId: string, createdByUserId: string, dto: { email: string; role: InviteRole; message?: string }) {
    const email = dto.email.trim().toLowerCase();

    // Ensure a user record exists so AuthGuard's email-lookup branch can link
    // the Firebase UID on first sign-in. New users have no firebase UID yet.
    let existingUser = await this.userRepo.findOneBy({ email });
    if (!existingUser) {
      try {
        const shell = this.userRepo.create({ email, name: email, firebaseUid: null, avatarUrl: null });
        await this.userRepo.save(shell);
      } catch {
        // Unique-constraint violation from a concurrent create — re-fetch and proceed.
        existingUser = await this.userRepo.findOneBy({ email });
      }
    }

    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const code = generateCode();
    const invite = this.inviteRepo.create({
      caseId,
      email,
      role: dto.role,
      message: dto.message ?? null,
      code,
      createdByUserId,
      expiresAt,
    });
    return this.inviteRepo.save(invite);
  }

  async listPending(caseId: string) {
    // "Pending" = unused AND unexpired. Expired-but-unused invites are stale
    // garbage from the owner's perspective; we omit them.
    return this.inviteRepo
      .createQueryBuilder('invite')
      .leftJoinAndSelect('invite.createdBy', 'createdBy')
      .where('invite.caseId = :caseId', { caseId })
      .andWhere('invite.usedAt IS NULL')
      .andWhere('invite.expiresAt > NOW()')
      .orderBy('invite.createdAt', 'DESC')
      .getMany();
  }

  async revoke(caseId: string, inviteId: string) {
    const invite = await this.inviteRepo.findOneBy({ id: inviteId, caseId });
    if (!invite) throw new NotFoundException(`Invite ${inviteId} not found`);
    if (invite.usedAt) throw new ConflictException('Invite already used');
    await this.inviteRepo.remove(invite);
  }

  /**
   * Public lookup — used by the welcome page before the invitee signs in.
   * Returns enough info to render the page WITHOUT leaking the caseId until
   * the invite is verified at accept time.
   */
  async lookup(code: string): Promise<{
    status: InviteLookupStatus;
    caseName?: string;
    inviterName?: string;
    role?: InviteRole;
    email?: string;
    message?: string | null;
  }> {
    const invite = await this.inviteRepo.findOne({
      where: { code },
      relations: ['case', 'createdBy'],
    });
    if (!invite) return { status: 'revoked' }; // Treat unknown codes as revoked for UX simplicity
    if (invite.usedAt) return { status: 'used' };
    if (invite.expiresAt.getTime() < Date.now()) return { status: 'expired' };
    return {
      status: 'pending',
      caseName: invite.case.name,
      inviterName: invite.createdBy.name,
      role: invite.role,
      email: invite.email,
      message: invite.message,
    };
  }

  /**
   * Accept the invite. Caller must already be authenticated as a Firebase user
   * whose email matches the invite. Idempotent re-acceptance is disallowed:
   * if the user is already a member, the invite is not consumed and the
   * existing role wins.
   */
  async accept(code: string, firebaseEmail: string, firebaseUserId: string): Promise<{ caseId: string; alreadyMember: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const invite = await manager.findOne(CaseInviteEntity, {
        where: { code },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invite) throw new NotFoundException('Invite not found');
      if (invite.usedAt) throw new GoneException('Invite already used');
      if (invite.expiresAt.getTime() < Date.now()) throw new GoneException('Invite expired');
      if (invite.email !== firebaseEmail.trim().toLowerCase()) {
        throw new ForbiddenException(`This invite is for ${invite.email}. Please sign in with that account.`);
      }

      const existing = await manager.findOneBy(CaseMemberEntity, {
        caseId: invite.caseId,
        userId: firebaseUserId,
      });
      if (existing) {
        return { caseId: invite.caseId, alreadyMember: true };
      }

      const membership = manager.create(CaseMemberEntity, {
        caseId: invite.caseId,
        userId: firebaseUserId,
        role: invite.role,
      });
      await manager.save(membership);

      invite.usedAt = new Date();
      invite.usedByUserId = firebaseUserId;
      await manager.save(invite);

      return { caseId: invite.caseId, alreadyMember: false };
    });
  }
}
