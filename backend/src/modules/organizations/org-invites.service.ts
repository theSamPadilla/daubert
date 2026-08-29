import { Injectable, NotFoundException, ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { customAlphabet } from 'nanoid';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationInviteEntity, OrgInviteRole } from '../../database/entities/organization-invite.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { UserEntity } from '../../database/entities/user.entity';

const INVITE_TTL_DAYS = 14;
const generateCode = customAlphabet('23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', 16);

export type OrgInviteLookupStatus = 'pending' | 'used' | 'expired' | 'revoked';

@Injectable()
export class OrgInvitesService {
  constructor(
    @InjectRepository(OrganizationInviteEntity)
    private readonly inviteRepo: Repository<OrganizationInviteEntity>,
    @InjectRepository(OrganizationMemberEntity)
    private readonly memberRepo: Repository<OrganizationMemberEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    orgId: string,
    createdByUserId: string,
    dto: { email: string; role: OrgInviteRole; name?: string; message?: string },
  ) {
    const email = dto.email.trim().toLowerCase();
    const providedName = dto.name?.trim() || undefined;

    let existingUser = await this.userRepo.findOneBy({ email });
    if (!existingUser) {
      try {
        const shell = this.userRepo.create({ email, name: providedName ?? email, firebaseUid: null, avatarUrl: null });
        await this.userRepo.save(shell);
      } catch {
        existingUser = await this.userRepo.findOneBy({ email });
      }
    } else if (providedName && existingUser.firebaseUid === null && existingUser.name === email) {
      // Existing row is still a shell (never claimed) with a placeholder name — update.
      existingUser.name = providedName;
      await this.userRepo.save(existingUser);
    }

    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const code = generateCode();
    const invite = this.inviteRepo.create({
      organizationId: orgId,
      email,
      role: dto.role,
      message: dto.message ?? null,
      code,
      createdByUserId,
      expiresAt,
    });
    return this.inviteRepo.save(invite);
  }

  /**
   * The ONE place that expresses "live org invite" (unused, unexpired), using
   * the DB clock (SQL NOW()) rather than the app clock so every consumer of
   * liveness — listPending, findLiveInvite, and OrganizationsService.getRoster
   * (via listLiveInvites) — shares a single clock source and cannot drift.
   */
  private liveInviteQuery(orgId: string): SelectQueryBuilder<OrganizationInviteEntity> {
    return this.inviteRepo
      .createQueryBuilder('invite')
      .where('invite.organizationId = :orgId', { orgId })
      .andWhere('invite.usedAt IS NULL')
      .andWhere('invite.expiresAt > NOW()');
  }

  async listPending(orgId: string) {
    return this.liveInviteQuery(orgId)
      .leftJoinAndSelect('invite.createdBy', 'createdBy')
      .orderBy('invite.createdAt', 'DESC')
      .getMany();
  }

  /** All live invites for an org, newest first. No relations joined - used by OrganizationsService.getRoster. */
  async listLiveInvites(orgId: string): Promise<OrganizationInviteEntity[]> {
    return this.liveInviteQuery(orgId).orderBy('invite.createdAt', 'DESC').getMany();
  }

  /** The live invite (if any) for a given org + email. Used as the cross-org security check in CasesService. */
  async findLiveInvite(orgId: string, email: string): Promise<OrganizationInviteEntity | null> {
    return this.liveInviteQuery(orgId).andWhere('invite.email = :email', { email }).getOne();
  }

  async revoke(orgId: string, inviteId: string) {
    const invite = await this.inviteRepo.findOneBy({ id: inviteId, organizationId: orgId });
    if (!invite) throw new NotFoundException(`Invite ${inviteId} not found`);
    if (invite.usedAt) throw new ConflictException('Invite already used');
    await this.inviteRepo.remove(invite);
  }

  async lookup(code: string): Promise<{
    status: OrgInviteLookupStatus;
    orgSlug?: string;
    orgName?: string;
    inviterName?: string;
    role?: OrgInviteRole;
    email?: string;
    message?: string | null;
  }> {
    const invite = await this.inviteRepo.findOne({
      where: { code },
      relations: ['organization', 'createdBy'],
    });
    if (!invite) return { status: 'revoked' };
    if (invite.organization.deletedAt !== null) return { status: 'revoked' };
    if (invite.usedAt) return { status: 'used' };
    if (invite.expiresAt.getTime() < Date.now()) return { status: 'expired' };
    return {
      status: 'pending',
      orgSlug: invite.organization.slug,
      orgName: invite.organization.name,
      inviterName: invite.createdBy.name,
      role: invite.role,
      email: invite.email,
      message: invite.message,
    };
  }

  async accept(
    code: string,
    firebaseEmail: string,
    firebaseUserId: string,
  ): Promise<{ orgSlug: string; alreadyMember: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const invite = await manager.findOne(OrganizationInviteEntity, {
        where: { code },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invite) throw new NotFoundException('Invite not found');
      if (invite.usedAt) throw new GoneException('Invite already used');
      if (invite.expiresAt.getTime() < Date.now()) throw new GoneException('Invite expired');
      if (invite.email !== firebaseEmail.trim().toLowerCase()) {
        throw new ForbiddenException(`This invite is for ${invite.email}. Please sign in with that account.`);
      }

      const org = await manager.findOneBy(OrganizationEntity, { id: invite.organizationId });
      if (!org || org.deletedAt !== null) {
        throw new GoneException('Invite organization is no longer active');
      }
      const orgSlug = org.slug;

      const existing = await manager.findOneBy(OrganizationMemberEntity, {
        organizationId: invite.organizationId,
        userId: firebaseUserId,
      });
      if (existing) {
        return { orgSlug, alreadyMember: true };
      }

      const membership = manager.create(OrganizationMemberEntity, {
        organizationId: invite.organizationId,
        userId: firebaseUserId,
        role: invite.role,
      });
      await manager.save(membership);

      invite.usedAt = new Date();
      invite.usedByUserId = firebaseUserId;
      await manager.save(invite);

      return { orgSlug, alreadyMember: false };
    });
  }
}
