import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationMemberEntity, OrgRole } from '../../database/entities/organization-member.entity';
import { OrganizationInviteEntity } from '../../database/entities/organization-invite.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { UsersService } from '../users/users.service';
import { OrgInvitesService } from './org-invites.service';
import { UpdateOrgDto } from './dto/update-org.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(OrganizationMemberEntity)
    private readonly memberRepo: Repository<OrganizationMemberEntity>,
    private readonly orgInvitesService: OrgInvitesService,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  async findBySlug(slug: string): Promise<OrganizationEntity> {
    const org = await this.orgRepo.findOneBy({ slug, deletedAt: IsNull() });
    if (!org) throw new NotFoundException(`Organization '${slug}' not found`);
    return org;
  }

  async update(orgId: string, dto: UpdateOrgDto): Promise<OrganizationEntity> {
    const org = await this.orgRepo.findOneBy({ id: orgId, deletedAt: IsNull() });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);

    if (dto.name !== undefined) org.name = dto.name;

    if (dto.slug !== undefined) {
      // Check against ALL orgs (including soft-deleted) — the DB unique index
      // on slug is global, so a trashed org's slug would still collide at save time.
      const conflict = await this.orgRepo.findOneBy({ slug: dto.slug });
      if (conflict && conflict.id !== orgId) {
        const where = conflict.deletedAt !== null ? ' (currently in trash)' : '';
        throw new ConflictException(`Slug '${dto.slug}' is already taken${where}`);
      }
      org.slug = dto.slug;
    }

    return this.orgRepo.save(org);
  }

  async listMembers(orgId: string) {
    const members = await this.memberRepo.find({
      where: { organizationId: orgId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      organizationId: m.organizationId,
      role: m.role,
      user: m.user
        ? {
            id: m.user.id,
            email: m.user.email,
            name: m.user.name,
            avatarUrl: m.user.avatarUrl,
            linked: !!m.user.firebaseUid,
            createdAt: m.user.createdAt,
            updatedAt: m.user.updatedAt,
          }
        : undefined,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));
  }

  /**
   * Everyone who can be staffed onto a case in this org: accepted members plus
   * people with a live org invite. Pending invitees already have a shell user
   * row (created by OrgInvitesService.create), so a case_members row can be
   * written against them now and activates on signup.
   *
   * The invite `code` is never returned - this endpoint is readable by any org
   * member, while codes are admin-only secrets.
   *
   * Invites with no backing shell user row are dropped: addMemberByEmail
   * resolves the target via UsersService.findByEmail and 404s when it misses,
   * so surfacing a candidate the backend would refuse would let the frontend
   * offer a selection that always fails (or, worse, silently falls back to an
   * external case invite for an in-org colleague).
   */
  async getRoster(orgId: string) {
    const members = await this.listMembers(orgId);
    const memberEmails = new Set(
      members
        .map((m) => m.user?.email.toLowerCase())
        .filter((email): email is string => !!email),
    );

    const invites = await this.orgInvitesService.listLiveInvites(orgId);

    const liveInvites = invites.filter((invite) => !memberEmails.has(invite.email.toLowerCase()));

    // Invites have no unique constraint on (organizationId, email); keep only
    // the newest per email. Rows arrive newest-first, so the first hit wins.
    const newestByEmail = new Map<string, OrganizationInviteEntity>();
    for (const invite of liveInvites) {
      const email = invite.email.toLowerCase();
      if (!newestByEmail.has(email)) newestByEmail.set(email, invite);
    }
    const dedupedInvites = [...newestByEmail.values()];

    const emails = dedupedInvites.map((invite) => invite.email.toLowerCase());
    const shellUsers = emails.length ? await this.userRepo.find({ where: { email: In(emails) } }) : [];
    const userByEmail = new Map(shellUsers.map((user) => [user.email.toLowerCase(), user]));

    const pendingInvites = dedupedInvites
      .filter((invite) => userByEmail.has(invite.email.toLowerCase()))
      .map((invite) => {
        const user = userByEmail.get(invite.email.toLowerCase())!;
        return {
          id: invite.id,
          email: invite.email,
          name: user.name !== user.email ? user.name : null,
          role: invite.role,
          userId: user.id,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
        };
      });

    return { members, pendingInvites };
  }

  async addMemberByEmail(orgId: string, email: string, role: OrgRole) {
    const lower = email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(lower);
    if (!user) throw new NotFoundException(`No user found with email ${lower}`);

    const existing = await this.memberRepo.findOneBy({ organizationId: orgId, userId: user.id });
    if (existing) throw new ConflictException(`User ${lower} is already a member of this organization`);

    const member = this.memberRepo.create({ organizationId: orgId, userId: user.id, role });
    return this.memberRepo.save(member);
  }

  async updateMemberRole(orgId: string, userId: string, role: OrgRole) {
    return this.dataSource.transaction(async (manager) => {
      await manager.findOne(OrganizationEntity, {
        where: { id: orgId },
        lock: { mode: 'pessimistic_write' },
      });

      if (role !== 'admin') {
        await this.assertNotLastAdminOperation(manager, orgId, userId, 'demote');
      }

      const member = await manager.findOneBy(OrganizationMemberEntity, { organizationId: orgId, userId });
      if (!member) throw new NotFoundException(`Membership for user ${userId} in org ${orgId} not found`);
      member.role = role;
      return manager.save(member);
    });
  }

  async removeMember(orgId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      await manager.findOne(OrganizationEntity, {
        where: { id: orgId },
        lock: { mode: 'pessimistic_write' },
      });

      await this.assertNotLastAdminOperation(manager, orgId, userId, 'remove');

      const member = await manager.findOneBy(OrganizationMemberEntity, { organizationId: orgId, userId });
      if (!member) throw new NotFoundException(`Membership for user ${userId} in org ${orgId} not found`);
      await manager.remove(member);
    });
  }

  async leave(orgId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      await manager.findOne(OrganizationEntity, {
        where: { id: orgId },
        lock: { mode: 'pessimistic_write' },
      });

      await this.assertNotLastAdminOperation(manager, orgId, userId, 'remove');

      const member = await manager.findOneBy(OrganizationMemberEntity, { organizationId: orgId, userId });
      if (!member) throw new NotFoundException(`You are not a member of this organization`);
      await manager.remove(member);
    });
  }

  private async assertNotLastAdminOperation(
    manager: EntityManager,
    orgId: string,
    targetUserId: string,
    intent: 'demote' | 'remove',
  ): Promise<void> {
    const target = await manager.findOneBy(OrganizationMemberEntity, { organizationId: orgId, userId: targetUserId });
    if (!target || target.role !== 'admin') return;
    const adminCount = await manager.count(OrganizationMemberEntity, {
      where: { organizationId: orgId, role: 'admin' as OrgRole },
    });
    if (adminCount <= 1) {
      throw new ConflictException(
        intent === 'demote'
          ? 'Cannot change role: this organization must have at least one admin. Promote another member first.'
          : 'Cannot remove member: this organization must have at least one admin. Transfer admin role first.',
      );
    }
  }
}
