import { Controller, Get, Patch, Delete, Post, Param, Body, Req, ForbiddenException, HttpCode } from '@nestjs/common';
import { CasesService } from './cases.service';
import { UpdateCaseDto } from './dto/update-case.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateCaseDto } from './dto/create-case.dto';
import { RequireRole } from '../auth/require-role.decorator';

@Controller('cases')
export class CasesController {
  constructor(private readonly service: CasesService) {}

  @Post()
  create(@Body() dto: CreateCaseDto, @Req() req: any) {
    return this.service.createWithOwner({
      name: dto.name,
      ownerUserId: req.user.id,
      orgId: dto.orgId,
      summary: dto.summary ?? null,
    });
  }

  @Get()
  findAll(@Req() req: any) {
    if (!req.user) throw new ForbiddenException('Authentication required');
    return this.service.findAllForUser(req.user);
  }

  @RequireRole('viewer')
  @Get(':caseId')
  findOne(@Param('caseId') caseId: string, @Req() req: any) {
    return this.service.findOne(caseId, req.caseMembership.role);
  }

  @RequireRole('owner')
  @Patch(':caseId')
  update(@Param('caseId') caseId: string, @Body() dto: UpdateCaseDto) {
    return this.service.update(caseId, dto);
  }

  @RequireRole('owner')
  @Delete(':caseId')
  remove(@Param('caseId') caseId: string) {
    return this.service.remove(caseId);
  }

  // ── Member management ────────────────────────────────────────────────────────

  @RequireRole('editor')
  @Get(':caseId/members')
  listMembers(@Param('caseId') caseId: string) {
    return this.service.listMembers(caseId);
  }

  @RequireRole('owner')
  @Post(':caseId/members')
  addMember(
    @Param('caseId') caseId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.service.addMemberByEmail(caseId, dto.email, dto.role);
  }

  @RequireRole('owner')
  @Patch(':caseId/members/:userId')
  updateMemberRole(
    @Param('caseId') caseId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.service.updateMemberRole(caseId, userId, dto.role);
  }

  @RequireRole('owner')
  @Delete(':caseId/members/:userId')
  @HttpCode(204)
  removeMember(@Param('caseId') caseId: string, @Param('userId') userId: string) {
    return this.service.removeMember(caseId, userId);
  }

  @RequireRole('viewer')
  @Post(':caseId/members/me/leave')
  @HttpCode(204)
  async leave(@Param('caseId') caseId: string, @Req() req: any) {
    await this.service.leave(caseId, req.user.id);
  }
}
