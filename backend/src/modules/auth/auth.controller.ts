import { Controller, Get, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';

@Controller('auth')
export class AuthController {
  constructor(
    @InjectRepository(OrganizationMemberEntity)
    private readonly orgMemberRepo: Repository<OrganizationMemberEntity>,
  ) {}

  @Get('me')
  async getMe(@Req() req: any) {
    const u: UserEntity = req.user;
    const memberships = await this.orgMemberRepo.find({
      where: { userId: u.id },
      relations: ['organization'],
    });
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      isSuperAdmin: u.isSuperAdmin,
      orgs: memberships
        .filter((m) => m.organization.deletedAt === null)
        .map((m) => ({
          id: m.organizationId,
          slug: m.organization.slug,
          name: m.organization.name,
          role: m.role,
        })),
    };
  }
}
