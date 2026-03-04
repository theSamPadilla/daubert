// backend/src/modules/ai/conversations.controller.ts
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ConversationsService } from './conversations.service';
import { AiService } from './ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@Controller()
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly aiService: AiService,
  ) {}

  @Post('cases/:caseId/conversations')
  create(@Param('caseId') caseId: string) {
    return this.conversationsService.create(caseId);
  }

  @Get('cases/:caseId/conversations')
  findAllForCase(@Param('caseId') caseId: string) {
    return this.conversationsService.findAllForCase(caseId);
  }

  @Get('conversations/:id/messages')
  getMessages(@Param('id') id: string) {
    return this.conversationsService.getMessages(id);
  }

  @Post('conversations/:id/chat')
  async chat(
    @Param('id') id: string,
    @Body() body: ChatMessageDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const event of this.aiService.streamChat(id, body.message)) {
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
      res.end();
    }
  }
}
