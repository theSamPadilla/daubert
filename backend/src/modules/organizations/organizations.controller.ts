import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { RequireOrgRole } from '../auth/require-org-role.decorator';
import { OrganizationsService } from './organizations.service';
import { UpdateOrgDto } from './dto/update-org.dto';
import { AddOrgMemberDto } from './dto/add-org-member.dto';
import { UpdateOrgMemberRoleDto } from './dto/update-org-member-role.dto';

@Controller('orgs/:org')
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @RequireOrgRole('member')
  @Get()
  getOrg(@Req() req: any) {
    return req.organization;
  }

  @RequireOrgRole('admin')
  @Patch()
  update(@Req() req: any, @Body() dto: UpdateOrgDto) {
    return this.service.update(req.organization.id, dto);
  }

  @RequireOrgRole('member')
  @Get('roster')
  getRoster(@Req() req: any) {
    return this.service.getRoster(req.organization.id);
  }

  @RequireOrgRole('member')
  @Get('members')
  listMembers(@Req() req: any) {
    return this.service.listMembers(req.organization.id);
  }

  @RequireOrgRole('admin')
  @Post('members')
  addMember(@Req() req: any, @Body() dto: AddOrgMemberDto) {
    return this.service.addMemberByEmail(req.organization.id, dto.email, dto.role);
  }

  @RequireOrgRole('admin')
  @Patch('members/:userId')
  updateMemberRole(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() dto: UpdateOrgMemberRoleDto,
  ) {
    return this.service.updateMemberRole(req.organization.id, userId, dto.role);
  }

  @RequireOrgRole('admin')
  @Delete('members/:userId')
  @HttpCode(204)
  removeMember(@Req() req: any, @Param('userId') userId: string) {
    return this.service.removeMember(req.organization.id, userId);
  }

  @RequireOrgRole('guest')
  @Post('members/me/leave')
  @HttpCode(204)
  async leave(@Req() req: any) {
    await this.service.leave(req.organization.id, req.user.id);
  }
}
