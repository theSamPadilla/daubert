import { Controller, Get, Post, Patch, Delete, Param, Body, Req } from '@nestjs/common';
import { InvestigationsService } from './investigations.service';
import { TracesService } from '../traces/traces.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';
import { SearchBetweenDto } from '../traces/dto/search-between.dto';
import { RequireRole } from '../auth/require-role.decorator';
import { getPrincipal } from '../auth/access-principal';

@Controller()
export class InvestigationsController {
  constructor(
    private readonly service: InvestigationsService,
    private readonly tracesService: TracesService,
  ) {}

  @RequireRole('viewer')
  @Get('cases/:caseId/investigations')
  findAllForCase(@Param('caseId') caseId: string) {
    return this.service.findAllForCase(caseId);
  }

  @RequireRole('editor')
  @Post('cases/:caseId/investigations')
  create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateInvestigationDto,
  ) {
    return this.service.create(caseId, dto);
  }

  @Get('investigations/:id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, getPrincipal(req));
  }

  @Patch('investigations/:id')
  update(@Param('id') id: string, @Body() dto: UpdateInvestigationDto, @Req() req: any) {
    return this.service.update(id, dto, getPrincipal(req));
  }

  @Delete('investigations/:id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, getPrincipal(req));
  }

  @Post('investigations/:id/duplicate')
  duplicate(@Param('id') id: string, @Req() req: any) {
    return this.service.duplicate(id, getPrincipal(req));
  }

  @Get('investigations/:id/script-runs')
  listScriptRuns(@Param('id') id: string, @Req() req: any) {
    return this.service.listScriptRuns(id, getPrincipal(req));
  }

  @Post('investigations/:id/search-between')
  async searchBetween(
    @Param('id') id: string,
    @Body() dto: SearchBetweenDto,
    @Req() req: any,
  ) {
    const principal = getPrincipal(req);
    // findOne loads the investigation with its traces relation and asserts access.
    const investigation = await this.service.findOne(id, principal);
    const traces = investigation.traces || [];
    return this.tracesService.searchBetween(traces, dto);
  }
}
