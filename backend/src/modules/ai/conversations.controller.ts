import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Res,
  Req,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { ConversationsService } from './conversations.service';
import { AgentRunLauncher } from './runs/agent-run-launcher.service';
import { AgentRunEventsStreamer } from './runs/agent-run-events.streamer';
import { AgentRunsService } from './runs/agent-runs.service';
import { resolveViewerRole } from './runs/resolve-viewer-role';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ExportConversationDto } from './dto/export-conversation.dto';
import { RequireRole } from '../auth/require-role.decorator';
import { requireUserPrincipal } from '../auth/access-principal';
import { CaseAccessService } from '../auth/case-access.service';

@Controller('cases/:caseId/conversations')
@RequireRole('viewer')
export class CaseConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  create(@Param('caseId') caseId: string, @Req() req: any) {
    return this.conversationsService.create(caseId, requireUserPrincipal(req));
  }

  @Get()
  findAll(@Param('caseId') caseId: string, @Req() req: any) {
    return this.conversationsService.findAllForUserInCase(caseId, requireUserPrincipal(req));
  }
}

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly launcher: AgentRunLauncher,
    private readonly streamer: AgentRunEventsStreamer,
    private readonly caseAccess: CaseAccessService,
    private readonly runs: AgentRunsService,
  ) {}

  @Get(':id/messages')
  getMessages(@Param('id') id: string, @Req() req: any) {
    return this.conversationsService.getMessagesForDisplay(id, requireUserPrincipal(req));
  }

  @Post(':id/export')
  @HttpCode(200)
  async export(
    @Param('id') id: string,
    @Body() body: ExportConversationDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const { buffer, filename, contentType } = await this.conversationsService.export(
      id,
      requireUserPrincipal(req),
      body.format,
    );
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  /** Summarize this conversation into a new one ("Continue in a new conversation"). */
  @Post(':id/continue')
  @HttpCode(201)
  async continue(@Param('id') id: string, @Req() req: any) {
    const userId = requireUserPrincipal(req);
    await this.conversationsService.findOne(id, userId); // owner check before touching runs
    // A run whose worker died still reads 'running' until swept; without this
    // the 409 would block the user until something else swept it.
    await this.runs.sweepStale(id);
    return this.conversationsService.continue(id, userId);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string, @Req() req: any) {
    return this.conversationsService.delete(id, requireUserPrincipal(req));
  }

  /**
   * Legacy endpoint for clients loaded before durable runs shipped. Starts a
   * run and relays its events on this response. The run itself is durable,
   * so a dropped connection no longer loses the turn. Remove once no client
   * calls it (see docs/agent-runs.md).
   */
  @Post(':id/chat')
  async chat(
    @Param('id') id: string,
    @Body() body: ChatMessageDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const userId = requireUserPrincipal(req);
    const conv = await this.conversationsService.findOne(id, userId);
    // Tools act on body.caseId; the activity log files under the conversation's case. They must agree.
    if (body.caseId && body.caseId !== conv.caseId) {
      throw new BadRequestException('caseId does not match the conversation');
    }
    const viewerRole = await resolveViewerRole(req, body.caseId, this.caseAccess);
    const run = await this.launcher.start({ conversationId: id, userId, viewerRole, dto: body });
    await this.streamer.stream(res, run, 0, Number.POSITIVE_INFINITY);
  }
}
