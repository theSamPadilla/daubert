import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { RequireSuperAdmin } from '../../auth/require-super-admin.decorator';
import { TokenUsageService } from './token-usage.service';

@Controller('superadmin/token-usage')
@RequireSuperAdmin()
export class SuperadminTokenUsageController {
  constructor(private readonly service: TokenUsageService) {}

  @Get('overview')
  overview(@Query('days', new ParseIntPipe({ optional: true })) days = 30) {
    return this.service.overview(this.clampWindow(days));
  }

  @Get('by-org')
  byOrg(
    @Query('days', new ParseIntPipe({ optional: true })) days = 30,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 10,
  ) {
    return this.service.byOrg(this.clampWindow(days), Math.max(1, Math.min(limit, 100)));
  }

  @Get('by-user')
  byUser(
    @Query('days', new ParseIntPipe({ optional: true })) days = 30,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 10,
  ) {
    return this.service.byUser(this.clampWindow(days), Math.max(1, Math.min(limit, 100)));
  }

  @Get('by-case')
  byCase(
    @Query('days', new ParseIntPipe({ optional: true })) days = 30,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 10,
  ) {
    return this.service.byCase(this.clampWindow(days), Math.max(1, Math.min(limit, 100)));
  }

  @Get('by-conversation')
  byConversation(
    @Query('days', new ParseIntPipe({ optional: true })) days = 30,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 10,
  ) {
    return this.service.byConversation(this.clampWindow(days), Math.max(1, Math.min(limit, 100)));
  }

  @Get('org-model-matrix')
  orgModelMatrix(@Query('days', new ParseIntPipe({ optional: true })) days = 30) {
    return this.service.orgModelMatrix(this.clampWindow(days));
  }

  @Get('cache-effectiveness')
  cacheEffectiveness(@Query('days', new ParseIntPipe({ optional: true })) days = 30) {
    return this.service.cacheEffectiveness(this.clampWindow(days));
  }

  private clampWindow(days: number): number {
    return [7, 30, 90].includes(days) ? days : 30;
  }
}
