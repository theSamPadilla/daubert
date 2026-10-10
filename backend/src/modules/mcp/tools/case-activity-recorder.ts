import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CaseActivityService } from '../../case-activity/case-activity.service';
import { ActivityOutcome, mcpToolOutcome, thrownOutcome } from '../../case-activity/activity-summaries';
import { CaseAccessService } from '../../auth/case-access.service';
import { TraceEntity } from '../../../database/entities/trace.entity';
import { ProductionEntity } from '../../../database/entities/production.entity';
import type { AuthSuccess } from '../mcp-auth.helper';

type CaseRef = { arg: 'caseId' } | { arg: 'traceId' } | { arg: 'productionId' };

/** How each case-scoped MCP tool names its case. */
export const MCP_CASE_TOOLS: Record<string, CaseRef> = {
  get_case: { arg: 'caseId' },
  list_investigations: { arg: 'caseId' },
  get_case_data: { arg: 'caseId' },
  read_production: { arg: 'caseId' },
  get_investigation: { arg: 'caseId' },
  list_data_room_files: { arg: 'caseId' },
  read_data_room_file: { arg: 'caseId' },
  create_investigation: { arg: 'caseId' },
  create_production: { arg: 'caseId' },
  import_transactions: { arg: 'traceId' },
  update_production: { arg: 'productionId' },
};

/** Tools that act on no case. They are not recorded. */
export const MCP_UNSCOPED_TOOLS: readonly string[] = [
  'list_cases',
  'query_labeled_entities',
  'get_skill',
  'get_declarants',
  'get_declaration_library',
  'blockchain_fetch_history',
  'blockchain_get_transaction',
  'blockchain_get_address_info',
];

type Handler = (...args: unknown[]) => Promise<unknown>;

/**
 * Records every case-scoped MCP tool call to the case activity log. Wraps the
 * server handed to the tool services, so tools stay unaware of logging.
 */
@Injectable()
export class McpActivityRecorder {
  constructor(
    private readonly activity: CaseActivityService,
    private readonly caseAccess: CaseAccessService,
    @InjectRepository(TraceEntity) private readonly traceRepo: Repository<TraceEntity>,
    @InjectRepository(ProductionEntity) private readonly productionRepo: Repository<ProductionEntity>,
  ) {}

  wrap(server: McpServer, auth: AuthSuccess): McpServer {
    const wrapped = Object.create(server) as McpServer;
    const register = server.registerTool.bind(server) as (name: string, config: unknown, handler: Handler) => unknown;
    (wrapped as unknown as { registerTool: unknown }).registerTool = (name: string, config: unknown, handler: Handler) => {
      if (!MCP_CASE_TOOLS[name]) return register(name, config, handler);
      return register(name, config, async (...cbArgs: unknown[]) => {
        const toolArgs = (cbArgs[0] ?? {}) as Record<string, unknown>;
        let result: unknown;
        try {
          result = await handler(...cbArgs);
        } catch (err) {
          await this.record(name, toolArgs, auth, thrownOutcome(err));
          throw err;
        }
        await this.record(name, toolArgs, auth, mcpToolOutcome(result));
        return result;
      });
    };
    return wrapped;
  }

  private async record(name: string, args: Record<string, unknown>, auth: AuthSuccess, outcome: ActivityOutcome) {
    try {
      const caseId = await this.resolveCaseId(name, args);
      if (!caseId) return;
      // Only cases the caller can see: a denied call must not write into another team's log.
      await this.caseAccess.assertAccess(auth.principal, caseId);
      await this.activity.record({
        caseId,
        userId: auth.principal.userId,
        source: 'mcp',
        agent: auth.session.surfaceLabel,
        mcpSessionId: auth.session.id,
        action: name,
        input: args,
        status: outcome.status,
        summary: outcome.summary,
      });
    } catch {
      // No access, or the target is gone: nothing to record.
    }
  }

  private async resolveCaseId(name: string, args: Record<string, unknown>): Promise<string | null> {
    const ref = MCP_CASE_TOOLS[name];
    const value = args[ref.arg];
    if (typeof value !== 'string') return null;
    if (ref.arg === 'caseId') return value;
    if (ref.arg === 'traceId') {
      const trace = await this.traceRepo.findOne({
        where: { id: value },
        relations: { investigation: true },
        select: { id: true, investigation: { id: true, caseId: true } },
      });
      return trace?.investigation?.caseId ?? null;
    }
    const production = await this.productionRepo.findOne({ where: { id: value }, select: { id: true, caseId: true } });
    return production?.caseId ?? null;
  }
}
