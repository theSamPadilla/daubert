import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentRunEntity } from '../../../database/entities/agent-run.entity';
import { CaseRole } from '../../../database/entities/case-member.entity';
import { AiService } from '../ai.service';
import { ConversationsService } from '../conversations.service';
import { ChatMessageDto } from '../dto/chat-message.dto';
import { AgentRunsService } from './agent-runs.service';
import { AGENT_RUN_DISPATCHER, AgentRunDispatcher } from './dispatch/agent-run-dispatcher';

export interface StartRunInput {
  conversationId: string;
  userId: string;
  viewerRole: CaseRole;
  dto: ChatMessageDto;
}

/**
 * Starts a run: reserve the conversation's active slot, persist the user's
 * message, then hand off to the dispatcher. Each step is compensated if a
 * later one fails, so a failed start never leaves an orphan message or a
 * stuck queued run.
 */
@Injectable()
export class AgentRunLauncher {
  private readonly logger = new Logger(AgentRunLauncher.name);

  constructor(
    private readonly runs: AgentRunsService,
    private readonly ai: AiService,
    private readonly conversations: ConversationsService,
    @Inject(AGENT_RUN_DISPATCHER) private readonly dispatcher: AgentRunDispatcher,
  ) {}

  async start({ conversationId, userId, viewerRole, dto }: StartRunInput): Promise<AgentRunEntity> {
    const run = await this.runs.createQueued({
      conversationId,
      userId,
      viewerRole,
      caseId: dto.caseId ?? null,
      investigationId: dto.investigationId ?? null,
      model: dto.model ?? null,
    });

    let userMessageId: string | undefined;
    try {
      userMessageId = (await this.ai.persistUserMessage(conversationId, dto.message, dto.attachments)).id;
      await this.runs.attachUserMessage(run.id, userMessageId);
    } catch (err) {
      await this.runs.failQueued(run, {
        errorId: randomUUID(),
        message: 'Your message could not be saved. Please try again.',
      });
      // attachUserMessage can fail after the message was saved.
      if (userMessageId) await this.conversations.deleteMessage(conversationId, userMessageId).catch(() => {});
      throw err;
    }

    try {
      await this.dispatcher.dispatch(run.id);
    } catch (err) {
      const errorId = randomUUID();
      this.logger.error(
        `run_dispatch_failed runId=${run.id} conversationId=${conversationId} errorId=${errorId}`,
        err instanceof Error ? err.stack : String(err),
      );
      const message = 'Could not start the response. Please try again.';
      await this.runs.failQueued(run, { errorId, message });
      await this.conversations.deleteMessage(conversationId, userMessageId!).catch((e) =>
        this.logger.error(
          `run_rollback_delete_failed runId=${run.id} errorId=${errorId}`,
          e instanceof Error ? e.stack : String(e),
        ),
      );
      throw new ServiceUnavailableException({ message, errorId });
    }

    return run;
  }
}
