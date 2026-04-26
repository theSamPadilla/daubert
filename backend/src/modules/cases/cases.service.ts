import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { CaseMemberEntity, CaseRole } from '../../database/entities/case-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { UpdateCaseDto } from './dto/update-case.dto';

@Injectable()
export class CasesService {
  constructor(
    @InjectRepository(CaseEntity)
    private readonly repo: Repository<CaseEntity>,
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async findAllForUser(user: UserEntity) {
    const memberships = await this.memberRepo.find({
      where: { userId: user.id },
      relations: ['case'],
      order: { case: { createdAt: 'DESC' } },
    });
    return memberships.map((m) => ({
      ...m.case,
      role: m.role,
    }));
  }

  async findOne(id: string) {
    const c = await this.repo.findOne({
      where: { id },
      relations: ['investigations'],
    });
    if (!c) throw new NotFoundException(`Case ${id} not found`);
    return c;
  }

  async update(id: string, dto: UpdateCaseDto) {
    const c = await this.findOne(id);
    if (dto.name !== undefined) c.name = dto.name;
    if (dto.startDate !== undefined) c.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.links !== undefined) c.links = dto.links;
    return this.repo.save(c);
  }

  async remove(id: string) {
    const c = await this.findOne(id);
    await this.repo.remove(c);
  }

  // --- Admin-flavored methods (only reachable through the admin module's
  // controllers, which are guarded by IsAdminGuard) ---

  async findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Create a case and atomically add the supplied user as the owner.
   * Used by the admin panel to provision a new case for a specific user.
   */
  async createWithOwner(input: { name: string; ownerUserId: string; startDate?: string | null; links?: { url: string; label: string }[] }) {
    return this.dataSource.transaction(async (manager) => {
      const owner = await manager.findOneBy(UserEntity, { id: input.ownerUserId });
      if (!owner) throw new NotFoundException(`User ${input.ownerUserId} not found`);

      const caseEntity = manager.create(CaseEntity, {
        name: input.name,
        startDate: input.startDate ? new Date(input.startDate) : null,
        links: input.links ?? [],
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
    await this.findOne(caseId);
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
    await this.findOne(caseId);

    const existing = await this.memberRepo.findOneBy({ caseId, userId });
    if (existing) {
      throw new ConflictException(`User ${userId} is already a member of case ${caseId}`);
    }

    const member = this.memberRepo.create({ caseId, userId, role });
    return this.memberRepo.save(member);
  }

  async updateMemberRole(caseId: string, userId: string, role: CaseRole) {
    const member = await this.memberRepo.findOneBy({ caseId, userId });
    if (!member) {
      throw new NotFoundException(`Membership for user ${userId} on case ${caseId} not found`);
    }
    member.role = role;
    return this.memberRepo.save(member);
  }

  async removeMember(caseId: string, userId: string) {
    const member = await this.memberRepo.findOneBy({ caseId, userId });
    if (!member) {
      throw new NotFoundException(`Membership for user ${userId} on case ${caseId} not found`);
    }
    await this.memberRepo.remove(member);
  }
}
