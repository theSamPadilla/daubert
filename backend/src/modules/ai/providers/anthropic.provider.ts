import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LlmProvider, StreamEvent } from './llm-provider.interface';

const DEFAULT_MODEL = 'claude-opus-4-6';
// Output budget for one streaming turn. Includes thinking, tool_use inputs,
// and visible text — all share the same cap. With `thinking: adaptive`, the
// model routinely burns 2-4k tokens on reasoning before emitting anything,
// so a 4k cap left almost no room for tool_use blocks and caused silent
// `stop_reason: max_tokens` terminations mid-task. Opus 4.x supports up to
// 32k output by default; we run at the ceiling so large tool_use payloads
// (e.g. multi-row chronology appends) have room without the agent having to
// micro-batch. Large-chronology *creation* should still use the seed-empty +
// chronology_append loop — this cap raises the per-turn ceiling, it does not
// remove it.
const MAX_TOKENS = 32000;

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

    // Strip thinking / redacted_thinking blocks: we don't carry reasoning
    // across turns, and persisting them caused cache_control breakpoint bugs.
    //
    // Server-side tool blocks (server_tool_use + web_search_tool_result,
    // code_execution + code_execution_tool_result) MUST be preserved as
    // intra-message pairs. Stripping the use block while leaving its result —
    // or vice versa — produces orphaned blocks that the API rejects with a
    // 400 ("unexpected tool_use_id found in web_search_tool_result blocks ...
    // Each ... block must have a corresponding server_tool_use block before
    // it.") on the next replay of the conversation.
    const STRIP = new Set(['thinking', 'redacted_thinking']);
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
