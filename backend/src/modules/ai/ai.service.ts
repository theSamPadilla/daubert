// backend/src/modules/ai/ai.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { MessageEntity } from '../../database/entities/message.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { ConversationsService } from './conversations.service';
import { SYSTEM_PROMPT } from './prompts';
import { AGENT_TOOLS, GET_CASE_DATA_TOOL } from './tools';

export interface SseEvent {
  type: 'text_delta' | 'tool_start' | 'tool_done' | 'done' | 'error';
  data: unknown;
}

const MAX_ITERATIONS = 10;

@Injectable()
export class AiService {
  private client: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationsService: ConversationsService,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(InvestigationEntity)
    private readonly investigationRepo: Repository<InvestigationEntity>,
  ) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.client = new Anthropic({ apiKey });
  }

  async *streamChat(
    conversationId: string,
    userMessage: string,
  ): AsyncGenerator<SseEvent> {
    const conversation =
      await this.conversationsService.findOne(conversationId);

    // Load history and reconstruct MessageParam[] verbatim.
    // Compaction blocks stored in assistant content are preserved automatically.
    const dbMessages = await this.conversationsService.getMessages(conversationId);
    const messages: Anthropic.Beta.BetaMessageParam[] = dbMessages.map(
      (m) => ({
        role: m.role,
        content: m.content as Anthropic.Beta.BetaContentBlockParam[],
      }),
    );

    // Persist and append user message
    await this.messageRepo.save(
      this.messageRepo.create({
        conversationId,
        role: 'user',
        content: [{ type: 'text', text: userMessage }],
      }),
    );
    messages.push({ role: 'user', content: [{ type: 'text', text: userMessage }] });

    let prevToolKey = '';
    let isFirstTurn = true;
    let firstAssistantText = '';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const stream = this.client.beta.messages.stream({
        betas: ['compact-2026-01-12'],
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        messages,
        tools: AGENT_TOOLS as Anthropic.Beta.BetaTool[],
      } as Parameters<typeof this.client.beta.messages.stream>[0]);

      // Stream text tokens to client
      stream.on('text', (delta) => {
        if (isFirstTurn) firstAssistantText += delta;
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text_delta', data: { content: event.delta.text } };
        }
      }

      const response = await stream.finalMessage();
      const responseContent =
        response.content as unknown as Anthropic.Beta.BetaContentBlock[];

      // Find user-defined tool calls (web_search is server-side, never appears here)
      const toolUseBlocks = responseContent.filter(
        (b) => b.type === 'tool_use',
      ) as Anthropic.ToolUseBlock[];

      if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
        await this.messageRepo.save(
          this.messageRepo.create({
            conversationId,
            role: 'assistant',
            content: responseContent,
          }),
        );

        if (isFirstTurn) {
          void this.generateTitle(
            conversationId,
            userMessage,
            firstAssistantText,
          );
        }

        yield { type: 'done', data: { conversationId } };
        return;
      }

      // Repeat-tool guard: break if same tools called with same inputs
      const toolKey = toolUseBlocks
        .map((b) => `${b.name}:${JSON.stringify(b.input)}`)
        .join('|');
      if (toolKey === prevToolKey) {
        yield { type: 'done', data: { conversationId } };
        return;
      }
      prevToolKey = toolKey;

      // Execute user-defined tools
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === GET_CASE_DATA_TOOL.name) {
          yield { type: 'tool_start', data: { name: toolUse.name, input: toolUse.input } };

          const result = await this.executeCaseDataTool(
            conversation.caseId,
            toolUse.input as { investigationId?: string },
          );

          yield { type: 'tool_done', data: { name: toolUse.name } };

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Atomic save: assistant message + tool results together.
      // Prevents orphaned tool_use blocks if the process dies mid-loop.
      await this.messageRepo.manager.transaction(async (manager) => {
        await manager.save(
          manager.create(MessageEntity, {
            conversationId,
            role: 'assistant',
            content: responseContent,
          }),
        );
        if (toolResults.length > 0) {
          await manager.save(
            manager.create(MessageEntity, {
              conversationId,
              role: 'user',
              content: toolResults,
            }),
          );
        }
      });

      messages.push({ role: 'assistant', content: responseContent });
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }

      isFirstTurn = false;
    }

    // Exhausted iterations
    yield { type: 'done', data: { conversationId } };
  }

  private async executeCaseDataTool(
    caseId: string,
    input: { investigationId?: string },
  ): Promise<unknown> {
    const where = input.investigationId
      ? { id: input.investigationId, caseId }
      : { caseId };

    const investigations = await this.investigationRepo.find({
      where,
      relations: ['traces'],
    });

    return investigations.map((inv) => ({
      id: inv.id,
      name: inv.name,
      notes: inv.notes,
      traces: inv.traces.map((t) => ({
        id: t.id,
        name: t.name,
        data: t.data,
      })),
    }));
  }

  private generateTitle(
    conversationId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    const run = async () => {
      try {
        const response = await this.client.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 20,
          messages: [
            {
              role: 'user',
              content: `Summarize this conversation exchange in 5 words or fewer. Return only the title, no punctuation.\n\nUser: ${userMessage}\n\nAssistant: ${assistantResponse.slice(0, 500)}`,
            },
          ],
        });
        const title =
          response.content[0].type === 'text'
            ? response.content[0].text.trim()
            : null;
        if (title) {
          await this.conversationsService.updateTitle(conversationId, title);
        }
      } catch {
        // Best-effort — title generation failure is non-fatal
      }
    };
    return run();
  }
}
