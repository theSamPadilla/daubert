import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Res,
  Req,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ConversationsService } from './conversations.service';
import { AiService } from './ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { CaseMemberGuard } from '../auth/case-member.guard';
import { requireUserPrincipal } from '../auth/access-principal';

@Controller('cases/:caseId/conversations')
@UseGuards(CaseMemberGuard)
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
    private readonly aiService: AiService,
  ) {}

  @Get(':id/messages')
  getMessages(@Param('id') id: string, @Req() req: any) {
    return this.conversationsService.getMessages(id, requireUserPrincipal(req));
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string, @Req() req: any) {
    return this.conversationsService.delete(id, requireUserPrincipal(req));
  }

  @Post(':id/chat')
  async chat(
    @Param('id') id: string,
    @Body() body: ChatMessageDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    // Verify access to the conversation before streaming (also rejects script tokens)
    const userId = requireUserPrincipal(req);
    await this.conversationsService.findOne(id, userId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const HEARTBEAT_MS = 15_000;
    let heartbeat: ReturnType<typeof setInterval> | undefined = setInterval(
      () => res.write(': heartbeat\n\n'),
      HEARTBEAT_MS,
    );

    try {
      for await (const event of this.aiService.streamChat(id, userId, body.message, body.caseId, body.investigationId, body.attachments, body.model)) {
        res.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.write(
        `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
      );
    } finally {
      clearInterval(heartbeat);
      heartbeat = undefined;
      res.end();
    }
  }
}
