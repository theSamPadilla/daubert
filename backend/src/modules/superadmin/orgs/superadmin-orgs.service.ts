import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { OrganizationEntity } from '../../../database/entities/organization.entity';
import { OrganizationMemberEntity } from '../../../database/entities/organization-member.entity';
import { UserEntity } from '../../../database/entities/user.entity';
import { CaseEntity } from '../../../database/entities/case.entity';

export type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  caseCount: number;
  createdAt: Date;
};

export type OrgTrashSummary = OrgSummary & { deletedAt: Date };

@Injectable()
export class SuperadminOrgsService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(OrganizationMemberEntity)
    private readonly memberRepo: Repository<OrganizationMemberEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async list(): Promise<OrgSummary[]> {
    const orgs = await this.orgRepo.find({ where: { deletedAt: IsNull() } });
    return Promise.all(orgs.map((o) => this.toSummary(o)));
  }

  async listTrash(): Promise<OrgTrashSummary[]> {
    const orgs = await this.orgRepo.find({ where: { deletedAt: Not(IsNull()) } });
    return Promise.all(
      orgs.map(async (o) => ({
        ...(await this.toSummary(o)),
        deletedAt: o.deletedAt as Date,
      })),
    );
  }

  async createWithFirstAdmin(input: {
    name: string;
    slug?: string;
    firstAdminEmail: string;
  }): Promise<OrganizationEntity> {
    return this.dataSource.transaction(async (manager) => {
      const slug = await this.resolveSlug(input.slug ?? this.slugify(input.name));

      const org = await manager.save(
        manager.create(OrganizationEntity, { name: input.name, slug, deletedAt: null }),
      );

      const email = input.firstAdminEmail.trim().toLowerCase();
      let user = await manager.findOneBy(UserEntity, { email });
      if (!user) {
        user = await manager.save(
          manager.create(UserEntity, { email, name: email, firebaseUid: null, avatarUrl: null }),
        );
      }

      await manager.save(
        manager.create(OrganizationMemberEntity, {
          organizationId: org.id,
          userId: user.id,
          role: 'admin',
        }),
      );

      return org;
    });
  }

  async softDelete(id: string): Promise<void> {
    const org = await this.orgRepo.findOneBy({ id });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);
    if (org.deletedAt !== null) throw new ConflictException('Organization is already soft-deleted');
    org.deletedAt = new Date();
    await this.orgRepo.save(org);
  }

  async restore(id: string): Promise<OrganizationEntity> {
    const org = await this.orgRepo.findOneBy({ id });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);
    if (org.deletedAt === null) throw new ConflictException('Organization is not soft-deleted');
    org.deletedAt = null;
    return this.orgRepo.save(org);
  }

  async purge(id: string): Promise<void> {
    const org = await this.orgRepo.findOneBy({ id });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);
    if (org.deletedAt === null) {
      throw new ForbiddenException('Organization must be soft-deleted before purging');
    }
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (org.deletedAt > thirtyDaysAgo) {
      throw new ForbiddenException('Organization must have been soft-deleted for at least 30 days before purging');
    }
    await this.orgRepo.remove(org);
  }

  private async toSummary(org: OrganizationEntity): Promise<OrgSummary> {
    const [memberCount, caseCount] = await Promise.all([
      this.memberRepo.countBy({ organizationId: org.id }),
      this.caseRepo.countBy({ orgId: org.id }),
    ]);
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      memberCount,
      caseCount,
      createdAt: org.createdAt,
    };
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async resolveSlug(base: string): Promise<string> {
    const exists = await this.orgRepo.findOneBy({ slug: base });
    if (!exists) return base;
    let suffix = 2;
    while (true) {
      const candidate = `${base}-${suffix}`;
      const taken = await this.orgRepo.findOneBy({ slug: candidate });
      if (!taken) return candidate;
      suffix++;
    }
  }
}
