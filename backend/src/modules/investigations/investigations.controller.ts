import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { InvestigationsService } from './investigations.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';
import { CaseMemberGuard } from '../auth/case-member.guard';

@Controller()
export class InvestigationsController {
  constructor(private readonly service: InvestigationsService) {}

  @UseGuards(CaseMemberGuard)
  @Get('cases/:caseId/investigations')
  findAllForCase(@Param('caseId') caseId: string) {
    return this.service.findAllForCase(caseId);
  }

  @UseGuards(CaseMemberGuard)
  @Post('cases/:caseId/investigations')
  create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateInvestigationDto,
  ) {
    return this.service.create(caseId, dto);
  }

  @Get('investigations/:id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user?.id);
  }

  @Patch('investigations/:id')
  update(@Param('id') id: string, @Body() dto: UpdateInvestigationDto, @Req() req: any) {
    return this.service.update(id, dto, req.user?.id);
  }

  @Delete('investigations/:id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user?.id);
  }

  @Get('investigations/:id/script-runs')
  listScriptRuns(@Param('id') id: string, @Req() req: any) {
    return this.service.listScriptRuns(id, req.user?.id);
  }
}
