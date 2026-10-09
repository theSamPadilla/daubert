import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import { CloudTasksOidcGuard } from '../runs/cloud-tasks-oidc.guard';
import { ChatRetentionService, ChatRetentionResult } from './chat-retention.service';

/**
 * Cloud Scheduler target for the daily chat retention purge (see
 * docs/chat-retention.md). Signed with the same invoker identity as Cloud
 * Tasks, so it shares that guard.
 */
@Controller('internal/chat-retention')
export class ChatRetentionInternalController {
  constructor(private readonly retention: ChatRetentionService) {}

  @Public()
  @UseGuards(CloudTasksOidcGuard)
  @Post('purge')
  @HttpCode(200)
  purge(): Promise<ChatRetentionResult> {
    return this.retention.purge();
  }
}
