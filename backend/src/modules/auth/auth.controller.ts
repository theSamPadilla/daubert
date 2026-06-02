import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { UpdateMeDto } from './dto/update-me.dto';

@Controller('auth')
export class AuthController {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(OrganizationMemberEntity)
    private readonly orgMemberRepo: Repository<OrganizationMemberEntity>,
  ) {}

  @Get('me')
  async getMe(@Req() req: any) {
    const u: UserEntity = req.user;
    return this.serialize(u);
  }

  @Patch('me')
  async updateMe(@Req() req: any, @Body() dto: UpdateMeDto) {
    const u: UserEntity = req.user;
    u.name = dto.name.trim();
    await this.userRepo.save(u);
    return this.serialize(u);
  }

  private async serialize(u: UserEntity) {
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
