import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AgentRunEntity } from '../../../database/entities/agent-run.entity';
import { requireUserPrincipal } from '../../auth/access-principal';
import { CaseAccessService } from '../../auth/case-access.service';
import { ConversationsService } from '../conversations.service';
import { ChatMessageDto } from '../dto/chat-message.dto';
import { AgentRunsService } from './agent-runs.service';
import { AgentRunLauncher } from './agent-run-launcher.service';
import { AgentRunEventsStreamer, SUBSCRIPTION_MAX_MS } from './agent-run-events.streamer';
import { resolveViewerRole } from './resolve-viewer-role';

@Controller('conversations')
export class AgentRunsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly caseAccess: CaseAccessService,
    private readonly runs: AgentRunsService,
    private readonly launcher: AgentRunLauncher,
    private readonly streamer: AgentRunEventsStreamer,
  ) {}

  /** Start a turn. Returns at once; follow it via GET .../runs/:runId/events. */
  @Post(':id/runs')
  @HttpCode(202)
  async start(@Param('id') id: string, @Body() body: ChatMessageDto, @Req() req: any) {
    const userId = requireUserPrincipal(req);
    const conv = await this.conversationsService.findOne(id, userId);
    // Tools act on body.caseId; the activity log files under the conversation's case. They must agree.
    if (body.caseId && body.caseId !== conv.caseId) {
      throw new BadRequestException('caseId does not match the conversation');
    }
    const viewerRole = await resolveViewerRole(req, body.caseId, this.caseAccess);
    const run = await this.launcher.start({ conversationId: id, userId, viewerRole, dto: body });
    return { runId: run.id, status: run.status };
  }

  /** The conversation's most recent run (or null), after sweeping dead ones. */
  @Get(':id/runs/latest')
  async latest(@Param('id') id: string, @Req() req: any) {
    const userId = requireUserPrincipal(req);
    await this.conversationsService.findOne(id, userId);
    await this.runs.sweepStale(id);
    const run = await this.runs.findLatest(id);
    return { run: run ? toRunView(run) : null };
  }

  /** SSE of the run's events after `after`. Ends at `done` or after ~4 min (reconnect). */
  @Get(':id/runs/:runId/events')
  async events(
    @Param('id') id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('after') after: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const run = await this.ownedRun(id, runId, req);
    const cursor = Math.max(0, Number.parseInt(after ?? '0', 10) || 0);
    await this.streamer.stream(res, run, cursor, SUBSCRIPTION_MAX_MS);
  }

  /** Ask the run to stop. It persists what it has and sends `done`. */
  @Post(':id/runs/:runId/cancel')
  @HttpCode(202)
  async cancel(@Param('id') id: string, @Param('runId', ParseUUIDPipe) runId: string, @Req() req: any) {
    const run = await this.ownedRun(id, runId, req);
    await this.runs.requestCancel(run);
    return { runId: run.id };
  }

  private async ownedRun(conversationId: string, runId: string, req: any): Promise<AgentRunEntity> {
    const userId = requireUserPrincipal(req);
    await this.conversationsService.findOne(conversationId, userId);
    const run = await this.runs.findForConversation(runId, conversationId);
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }
}

function toRunView(run: AgentRunEntity) {
  return {
    id: run.id,
    status: run.status,
    userMessageId: run.userMessageId,
    error: run.error,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
}
