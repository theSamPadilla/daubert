import { Controller, Get, Patch, Delete, Param, Body, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { CasesService } from './cases.service';
import { UpdateCaseDto } from './dto/update-case.dto';
import { CaseMemberGuard } from '../auth/case-member.guard';

@Controller('cases')
export class CasesController {
  constructor(private readonly service: CasesService) {}

  @Get()
  findAll(@Req() req: any) {
    if (!req.user) throw new ForbiddenException('Authentication required');
    return this.service.findAllForUser(req.user);
  }

  @UseGuards(CaseMemberGuard)
  @Get(':caseId')
  findOne(@Param('caseId') caseId: string) {
    return this.service.findOne(caseId);
  }

  @UseGuards(CaseMemberGuard)
  @Patch(':caseId')
  update(@Param('caseId') caseId: string, @Body() dto: UpdateCaseDto) {
    return this.service.update(caseId, dto);
  }

  @UseGuards(CaseMemberGuard)
  @Delete(':caseId')
  remove(@Param('caseId') caseId: string) {
    return this.service.remove(caseId);
  }
}
