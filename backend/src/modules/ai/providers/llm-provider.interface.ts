import Anthropic from '@anthropic-ai/sdk';

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'end_turn'; response: Anthropic.Beta.BetaMessage };

export interface LlmProvider {
  streamChat(params: {
    system: string;
    messages: Anthropic.Beta.BetaMessageParam[];
    tools: Anthropic.Beta.BetaTool[];
    model?: string;
  }): AsyncIterable<StreamEvent>;

  generateText(params: {
    model?: string;
    maxTokens: number;
    messages: Anthropic.MessageParam[];
  }): Promise<string | null>;
}
