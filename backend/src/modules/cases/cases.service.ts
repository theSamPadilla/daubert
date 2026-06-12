import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { CaseMemberEntity, CaseRole } from '../../database/entities/case-member.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationMemberEntity, OrgRole } from '../../database/entities/organization-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { UpdateCaseDto } from './dto/update-case.dto';
import { UsersService } from '../users/users.service';
import { orgRoleToImplicitCaseRole } from '../auth/case-access.service';

@Injectable()
export class CasesService {
  constructor(
    @InjectRepository(CaseEntity)
    private readonly repo: Repository<CaseEntity>,
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
    @InjectRepository(OrganizationMemberEntity)
    private readonly orgMemberRepo: Repository<OrganizationMemberEntity>,
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
  ) {}

  async findAllForUser(user: UserEntity) {
    // 1. Explicit case_members rows — always honored, even if the user is no
    //    longer in the org (case access doesn't auto-revoke on org departure).
    const memberships = await this.memberRepo.find({
      where: { userId: user.id },
      relations: ['case'],
    });
    const explicit = new Map<string, CaseEntity & { role: CaseRole }>();
    for (const m of memberships) {
      explicit.set(m.case.id, { ...m.case, role: m.role });
    }

    // 2. All org memberships in active orgs.
    const orgMemberships = await this.orgMemberRepo
      .createQueryBuilder('m')
      .innerJoin('organizations', 'o', 'o.id = m.organization_id AND o.deleted_at IS NULL')
      .where('m.user_id = :userId', { userId: user.id })
      .getMany();
    const orgRoleByOrgId = new Map<string, OrgRole>(
      orgMemberships.map((m) => [m.organizationId, m.role] as const),
    );

    // 3. All cases in those orgs — guests see them too (ghosted on the frontend).
    const result: Array<CaseEntity & { role?: CaseRole }> = [];
    const orgIds = Array.from(orgRoleByOrgId.keys());
    if (orgIds.length > 0) {
      const orgCases = await this.repo
        .createQueryBuilder('c')
        .where('c.orgId IN (:...orgIds)', { orgIds })
        .getMany();
      for (const c of orgCases) {
        const ex = explicit.get(c.id);
        if (ex) {
          result.push(ex);
          explicit.delete(c.id);
          continue;
        }
        const implicit = orgRoleToImplicitCaseRole(orgRoleByOrgId.get(c.orgId)!);
        result.push(implicit ? { ...c, role: implicit } : { ...c });
      }
    }

    // 4. Remaining explicit memberships (cases in orgs the user has since left).
    for (const c of explicit.values()) {
      result.push(c);
    }

    return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * MCP-scoped variant of `findAllForUser`: filters the result down to cases
   * whose `orgId` matches `organizationId`. Used by the MCP `list_cases` tool
   * to enforce the per-session org binding — a user who happens to belong to
   * multiple orgs MUST only see cases in the org bound to the MCP session.
   *
   * This is composed on top of `findAllForUser` rather than reimplemented so
   * the implicit/explicit role resolution stays in one place.
   */
  async findAllForUserInOrg(user: UserEntity, organizationId: string) {
    const all = await this.findAllForUser(user);
    return all.filter((c) => c.orgId === organizationId);
  }

  /** Internal helper — returns the raw entity; never exposed over the wire. */
  private async fetchOne(id: string): Promise<CaseEntity> {
    const c = await this.repo.findOne({
      where: { id },
      relations: ['investigations'],
    });
    if (!c) throw new NotFoundException(`Case ${id} not found`);
    return c;
  }

  async findOne(id: string, viewerRole?: CaseRole) {
    const c = await this.repo.findOne({
      where: { id },
      relations: ['investigations', 'members', 'members.user'],
    });
    if (!c) throw new NotFoundException(`Case ${id} not found`);
    if (viewerRole === 'viewer') {
      const { members: _, ...rest } = c;
      return { ...rest, role: viewerRole };
    }
    return { ...c, role: viewerRole };
  }

  async update(id: string, dto: UpdateCaseDto) {
    const c = await this.fetchOne(id);
    if (dto.name !== undefined) c.name = dto.name;
    if (dto.summary !== undefined) c.summary = dto.summary ?? null;
    return this.repo.save(c);
  }

  async remove(id: string) {
    const c = await this.fetchOne(id);
    await this.repo.remove(c);
  }

  // --- Admin-flavored methods (only reachable through the admin module's
  // controllers, which are guarded by IsAdminGuard) ---

  async findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Create a case and atomically add the supplied user as the owner.
   * Checks org membership: guests cannot create cases.
   */
  async createWithOwner(input: { name: string; ownerUserId: string; orgId: string; summary?: string | null }) {
    return this.dataSource.transaction(async (manager) => {
      const owner = await manager.findOneBy(UserEntity, { id: input.ownerUserId });
      if (!owner) throw new NotFoundException(`User ${input.ownerUserId} not found`);

      const org = await manager.findOneBy(OrganizationEntity, { id: input.orgId });
      if (!org || org.deletedAt !== null) {
        throw new NotFoundException(`Organization ${input.orgId} not found`);
      }

      const membership = await manager.findOneBy(OrganizationMemberEntity, {
        userId: owner.id,
        organizationId: input.orgId,
      });
      if (!membership) {
        throw new ForbiddenException('Not a member of this organization');
      }
      if (membership.role === 'guest') {
        throw new ForbiddenException('Guests cannot create cases');
      }

      const caseEntity = manager.create(CaseEntity, {
        name: input.name,
        orgId: input.orgId,
        summary: input.summary ?? null,
      });
      const saved = await manager.save(caseEntity);

      const member = manager.create(CaseMemberEntity, {
        caseId: saved.id,
        userId: owner.id,
        role: 'owner' as CaseRole,
      });
      await manager.save(member);

      return saved;
    });
  }

  async listMembers(caseId: string) {
    await this.fetchOne(caseId);
    const memberships = await this.memberRepo.find({
      where: { caseId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
    return memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      caseId: m.caseId,
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

  async addMember(caseId: string, userId: string, role: CaseRole) {
    await this.fetchOne(caseId);

    const existing = await this.memberRepo.findOneBy({ caseId, userId });
    if (existing) {
      throw new ConflictException(`User ${userId} is already a member of case ${caseId}`);
    }

    const member = this.memberRepo.create({ caseId, userId, role });
    return this.memberRepo.save(member);
  }

  async addMemberByEmail(caseId: string, email: string, role: CaseRole): Promise<CaseMemberEntity> {
    const lower = email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(lower);
    if (!user) {
      throw new NotFoundException(`No user found with email ${lower}`);
    }
    return this.addMember(caseId, user.id, role);
  }

  private async assertNotLastOwnerOperation(
    manager: EntityManager,
    caseId: string,
    targetUserId: string,
    intent: 'demote' | 'remove',
  ): Promise<void> {
    const target = await manager.findOneBy(CaseMemberEntity, { caseId, userId: targetUserId });
    if (!target || target.role !== 'owner') return;
    const ownerCount = await manager.count(CaseMemberEntity, { where: { caseId, role: 'owner' as CaseRole } });
    if (ownerCount <= 1) {
      throw new ConflictException(
        intent === 'demote'
          ? 'Cannot change role: this case must have at least one owner. Promote another member first.'
          : 'Cannot remove member: this case must have at least one owner. Promote another member first.',
      );
    }
  }

  async updateMemberRole(caseId: string, userId: string, role: CaseRole) {
    return this.dataSource.transaction(async (manager) => {
      await manager.findOne(CaseEntity, { where: { id: caseId }, lock: { mode: 'pessimistic_write' } });
      if (role !== 'owner') {
        await this.assertNotLastOwnerOperation(manager, caseId, userId, 'demote');
      }
      const member = await manager.findOneBy(CaseMemberEntity, { caseId, userId });
      if (!member) throw new NotFoundException(`Membership for user ${userId} on case ${caseId} not found`);
      member.role = role;
      return manager.save(member);
    });
  }

  async removeMember(caseId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      await manager.findOne(CaseEntity, { where: { id: caseId }, lock: { mode: 'pessimistic_write' } });
      await this.assertNotLastOwnerOperation(manager, caseId, userId, 'remove');
      const member = await manager.findOneBy(CaseMemberEntity, { caseId, userId });
      if (!member) throw new NotFoundException(`Membership for user ${userId} on case ${caseId} not found`);
      await manager.remove(member);
    });
  }

  async leave(caseId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      await manager.findOne(CaseEntity, { where: { id: caseId }, lock: { mode: 'pessimistic_write' } });
      await this.assertNotLastOwnerOperation(manager, caseId, userId, 'remove');
      const member = await manager.findOneBy(CaseMemberEntity, { caseId, userId });
      if (!member) throw new NotFoundException(`You are not a member of case ${caseId}`);
      await manager.remove(member);
    });
  }
}
