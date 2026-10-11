import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { RequireSuperAdmin } from '../../auth/require-super-admin.decorator';
import { DEFAULT_LIMIT, ToolCallFilters, ToolCallsService } from './tool-calls.service';

/** Raw query bag: a decorator-less DTO class would be stripped to {} by the global whitelist pipe. */
type ToolCallQuery = Record<string, unknown>;

@Controller('superadmin/tool-calls')
@RequireSuperAdmin()
export class SuperadminToolCallsController {
  constructor(private readonly service: ToolCallsService) {}

  @Get()
  list(
    @Query() filters: ToolCallQuery,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = DEFAULT_LIMIT,
  ) {
    return this.service.list(this.pick(filters), cursor || undefined, limit);
  }

  @Get('summary')
  summary(@Query() filters: ToolCallQuery) {
    return this.service.summary(this.pick(filters));
  }

  /** Only the filter keys, as non-empty strings (the query object also carries cursor/limit). */
  private pick(q: ToolCallQuery): ToolCallFilters {
    const out: ToolCallFilters = {};
    for (const k of ['orgId', 'caseId', 'conversationId', 'userId', 'action', 'status', 'from', 'to'] as const) {
      const v = q[k];
      if (typeof v === 'string' && v) (out as Record<string, string>)[k] = v;
    }
    return out;
  }
}
