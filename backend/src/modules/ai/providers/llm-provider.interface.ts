import Anthropic from '@anthropic-ai/sdk';

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'end_turn'; response: Anthropic.Beta.BetaMessage };

export type GeneratedText = {
  text: string | null;
  usage: Anthropic.Usage;
  model: string;
};

export interface LlmProvider {
  streamChat(params: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    messages: Anthropic.Beta.BetaMessageParam[];
    tools: Anthropic.Beta.BetaTool[];
    model?: string;
    containerId?: string;
  }): AsyncIterable<StreamEvent>;

  generateText(params: {
    model?: string;
    maxTokens: number;
    messages: Anthropic.MessageParam[];
  }): Promise<GeneratedText>;

  uploadFile(buffer: Buffer, filename: string, mimeType: string): Promise<string>;
}
