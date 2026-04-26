import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { IsAdminGuard } from '../../auth/admin.guard';
import { CasesService } from '../../cases/cases.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@Controller('admin/cases')
@UseGuards(IsAdminGuard)
export class AdminCasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  findAll() {
    return this.cases.findAll();
  }

  @Post()
  create(@Body() dto: CreateCaseDto) {
    return this.cases.createWithOwner({
      name: dto.name,
      ownerUserId: dto.ownerUserId,
      startDate: dto.startDate,
      links: dto.links,
    });
  }

  /**
   * Admin override delete — bypasses CaseMemberGuard (which gates the public
   * DELETE /cases/:caseId endpoint). Use when an admin needs to delete a case
   * they are not a member of.
   */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.cases.remove(id);
  }

  // --- Member management ---

  @Get(':id/members')
  listMembers(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.cases.listMembers(id);
  }

  @Post(':id/members')
  addMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.cases.addMember(id, dto.userId, dto.role);
  }

  @Patch(':id/members/:userId')
  updateMemberRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.cases.updateMemberRole(id, userId, dto.role);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.cases.removeMember(id, userId);
  }
}
