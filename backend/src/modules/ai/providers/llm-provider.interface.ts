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
    /** Aborts the in-flight request (Stop, run time limit, lost lease). */
    signal?: AbortSignal;
    /** Sent as `tool_choice`; omitted when unset. */
    toolChoice?: Anthropic.Beta.BetaToolChoice;
  }): AsyncIterable<StreamEvent>;

  generateText(params: {
    model?: string;
    maxTokens: number;
    messages: Anthropic.MessageParam[];
  }): Promise<GeneratedText>;

  uploadFile(buffer: Buffer, filename: string, mimeType: string): Promise<string>;

  /** One non-streaming call with a system prompt and no tools. */
  summarize(params: {
    system: string;
    prompt: string;
    model: string;
    maxTokens: number;
    timeoutMs: number;
  }): Promise<GeneratedText & { stopReason: string | null }>;
}
