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
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { ConversationsService } from './conversations.service';
import { AiService } from './ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly aiService: AiService,
  ) {}

  /**
   * Conversations are user-only — script tokens have no `req.user` and are
   * rejected here. Returns the user id for downstream service calls.
   */
  private requireUser(req: any): string {
    if (!req.user) throw new ForbiddenException('User authentication required');
    return req.user.id;
  }

  @Post()
  create(@Body() dto: CreateConversationDto, @Req() req: any) {
    return this.conversationsService.create(dto.caseId, this.requireUser(req));
  }

  @Get()
  findAll(@Req() req: any) {
    return this.conversationsService.findAllForUser(this.requireUser(req));
  }

  @Get(':id/messages')
  getMessages(@Param('id') id: string, @Req() req: any) {
    return this.conversationsService.getMessages(id, this.requireUser(req));
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string, @Req() req: any) {
    return this.conversationsService.delete(id, this.requireUser(req));
  }

  @Post(':id/chat')
  async chat(
    @Param('id') id: string,
    @Body() body: ChatMessageDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    // Verify access to the conversation before streaming (also rejects script tokens)
    const userId = this.requireUser(req);
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
