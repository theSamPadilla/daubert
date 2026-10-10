import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { RequireRole } from '../auth/require-role.decorator';
import { CaseActivityPageDto, CaseActivityService, DEFAULT_PAGE_SIZE } from './case-activity.service';

@Controller()
export class CaseActivityController {
  constructor(private readonly activity: CaseActivityService) {}

  @RequireRole('viewer')
  @Get('cases/:caseId/activity')
  list(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Req() req: any,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = DEFAULT_PAGE_SIZE,
  ): Promise<CaseActivityPageDto> {
    // docs/ROLES.md rule 6: viewers never see member data.
    return this.activity.list(caseId, cursor, limit, req.caseMembership?.role !== 'viewer');
  }
}
