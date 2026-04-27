import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LlmProvider, StreamEvent } from './llm-provider.interface';

const DEFAULT_MODEL = 'claude-opus-4-6';
const MAX_TOKENS = 4096;

@Injectable()
export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.client = new Anthropic({ apiKey });
  }

  async *streamChat(params: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    messages: Anthropic.Beta.BetaMessageParam[];
    tools: Anthropic.Beta.BetaTool[];
    model?: string;
  }): AsyncGenerator<StreamEvent> {
    // Cache the last tool definition — Anthropic caches everything up to and
    // including the last cache_control breakpoint, so this covers all tools.
    const tools = params.tools.map((tool, i) =>
      i === params.tools.length - 1
        ? { ...tool, cache_control: { type: 'ephemeral' as const } }
        : tool,
    );

    const stream = this.client.beta.messages.stream({
      betas: ['compact-2026-01-12'],
      model: params.model ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      system: params.system,
      messages: params.messages,
      tools,
    } as Parameters<typeof this.client.beta.messages.stream>[0]);

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { type: 'text', content: event.delta.text };
      }
    }

    // Strip blocks the rest of the system shouldn't see:
    //  - server-side code_execution blocks (adaptive thinking emits these but
    //    they have no matching tool_result on subsequent requests)
    //  - thinking / redacted_thinking blocks (we don't carry reasoning across
    //    turns; persisting them caused cache_control breakpoint bugs)
    const STRIP = new Set([
      'thinking',
      'redacted_thinking',
      'server_tool_use',
      'code_execution',
      'code_execution_tool_result',
      'server_tool_result',
    ]);
    const response = await stream.finalMessage();
    response.content = response.content.filter(
      (b) => !STRIP.has((b as { type: string }).type),
    ) as typeof response.content;
    yield { type: 'end_turn', response };
  }

  async generateText(params: {
    model?: string;
    maxTokens: number;
    messages: Anthropic.MessageParam[];
  }): Promise<string | null> {
    const response = await this.client.messages.create({
      model: params.model ?? 'claude-haiku-4-5',
      max_tokens: params.maxTokens,
      messages: params.messages,
    });
    const block = response.content[0];
    return block?.type === 'text' ? block.text.trim() : null;
  }
}
