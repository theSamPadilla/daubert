import { AnthropicProvider } from './anthropic.provider';

function fakeStream(finalMessage: any) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
    },
    finalMessage: jest.fn().mockResolvedValue(finalMessage),
  };
}

describe('AnthropicProvider.streamChat', () => {
  it('passes the abort signal to the SDK stream call', async () => {
    const provider = new AnthropicProvider({ get: () => 'sk-ant-test' } as any);
    const stream = jest.fn().mockReturnValue(fakeStream({ content: [], stop_reason: 'end_turn' }));
    (provider as any).client = { beta: { messages: { stream } } };
    const controller = new AbortController();

    const events: any[] = [];
    for await (const ev of provider.streamChat({ system: [], messages: [], tools: [], signal: controller.signal })) {
      events.push(ev);
    }

    expect(stream).toHaveBeenCalledWith(expect.any(Object), { signal: controller.signal });
    expect(events.map((e) => e.type)).toEqual(['text', 'end_turn']);
  });

  describe('tool_choice', () => {
    async function bodyFor(toolChoice?: any) {
      const provider = new AnthropicProvider({ get: () => 'sk-ant-test' } as any);
      const stream = jest.fn().mockReturnValue(fakeStream({ content: [], stop_reason: 'end_turn' }));
      (provider as any).client = { beta: { messages: { stream } } };
      for await (const _ of provider.streamChat({ system: [], messages: [], tools: [], toolChoice })) {
        // drain
      }
      return stream.mock.calls[0][0];
    }

    it('forwards toolChoice as tool_choice when set', async () => {
      expect((await bodyFor({ type: 'none' })).tool_choice).toEqual({ type: 'none' });
    });

    it('omits tool_choice when toolChoice is not set', async () => {
      expect(await bodyFor()).not.toHaveProperty('tool_choice');
    });
  });

  describe('per-model request shape', () => {
    const webSearch = { type: 'web_search_20260209', name: 'web_search' } as any;
    const custom = { name: 'get_case_data', input_schema: { type: 'object', properties: {} } } as any;

    async function requestFor(model?: string) {
      const provider = new AnthropicProvider({ get: () => 'sk-ant-test' } as any);
      const stream = jest.fn().mockReturnValue(fakeStream({ content: [], stop_reason: 'end_turn' }));
      (provider as any).client = { beta: { messages: { stream } } };
      for await (const _ of provider.streamChat({ system: [], messages: [], tools: [webSearch, custom], model })) {
        // drain
      }
      return stream.mock.calls[0][0];
    }

    it('sends adaptive thinking and the dynamic-filtering web search to current models', async () => {
      const body = await requestFor(undefined);
      expect(body.thinking).toEqual({ type: 'adaptive' });
      expect(body.tools).toEqual([webSearch, custom]);
    });

    it('sends Haiku 4.5 a thinking budget and the basic web search tool', async () => {
      const body = await requestFor('claude-haiku-4-5');
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
      expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }, custom]);
      expect(body.thinking.budget_tokens).toBeLessThan(body.max_tokens);
    });

    it('turns on server-side compaction at 500k input tokens for current models', async () => {
      const body = await requestFor(undefined);
      expect(body.betas).toContain('compact-2026-01-12');
      expect(body.context_management).toEqual({
        edits: [{ type: 'compact_20260112', trigger: { type: 'input_tokens', value: 500000 } }],
      });
    });

    it('sends Haiku 4.5 no context_management (compaction is unsupported there)', async () => {
      const body = await requestFor('claude-haiku-4-5');
      expect(body).not.toHaveProperty('context_management');
    });
  });

  describe('compaction blocks in the request for models without compaction', () => {
    async function bodyFor(model: string | undefined, messages: any[]) {
      const provider = new AnthropicProvider({ get: () => 'sk-ant-test' } as any);
      const stream = jest.fn().mockReturnValue(fakeStream({ content: [], stop_reason: 'end_turn' }));
      (provider as any).client = { beta: { messages: { stream } } };
      for await (const _ of provider.streamChat({ system: [], messages, tools: [], model })) {
        // drain
      }
      return stream.mock.calls[0][0];
    }
    const history = () => [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'compaction', content: 'The summary.' }, { type: 'text', text: 'a' }] },
      { role: 'user', content: [{ type: 'text', text: 'q2' }] },
      { role: 'assistant', content: [{ type: 'compaction', content: null }, { type: 'text', text: 'b' }] },
    ];

    it('turns a summary into text and drops a null one for Haiku 4.5, leaving the input untouched', async () => {
      const messages = history();
      const body = await bodyFor('claude-haiku-4-5', messages);
      expect(body.messages[1].content).toEqual([{ type: 'text', text: 'The summary.' }, { type: 'text', text: 'a' }]);
      expect(body.messages[3].content).toEqual([{ type: 'text', text: 'b' }]);
      expect(messages).toEqual(history());
    });

    it('passes compaction blocks through for models that support compaction', async () => {
      const body = await bodyFor(undefined, history());
      expect(body.messages[1].content[0]).toEqual({ type: 'compaction', content: 'The summary.' });
    });
  });

  describe('compaction blocks', () => {
    it('keeps a compaction block in the final response unchanged, stripping only thinking', async () => {
      const provider = new AnthropicProvider({ get: () => 'sk-ant-test' } as any);
      const compaction = { type: 'compaction', content: 'Summary of the earlier conversation.' };
      const stream = jest.fn().mockReturnValue(fakeStream({
        content: [
          { type: 'thinking', thinking: '', signature: 's' },
          compaction,
          { type: 'text', text: 'Answer' },
        ],
        stop_reason: 'end_turn',
      }));
      (provider as any).client = { beta: { messages: { stream } } };

      const events: any[] = [];
      for await (const ev of provider.streamChat({ system: [], messages: [], tools: [] })) events.push(ev);

      const response = events.find((e) => e.type === 'end_turn').response;
      expect(response.content).toEqual([
        { type: 'compaction', content: 'Summary of the earlier conversation.' },
        { type: 'text', text: 'Answer' },
      ]);
    });

    it('accumulates a streamed compaction_delta into the final message', async () => {
      // Real SDK stream accumulator over a scripted raw event stream.
      const provider = new AnthropicProvider({ get: () => 'sk-ant-test' } as any);
      const client = (provider as any).client;
      const rawEvents = [
        {
          type: 'message_start',
          message: {
            id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [],
            stop_reason: null, stop_sequence: null, container: null, context_management: null,
            usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'compaction', content: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'compaction_delta', content: 'The summary.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '', citations: null } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null, container: null },
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: null },
          context_management: null,
        },
        { type: 'message_stop' },
      ];
      const sdkStream = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() { for (const e of rawEvents) yield e; },
      };
      jest.spyOn(client.beta.messages, 'create').mockReturnValue({
        withResponse: async () => ({ response: { headers: new Headers() }, data: sdkStream }),
      } as any);

      const events: any[] = [];
      for await (const ev of provider.streamChat({ system: [], messages: [], tools: [] })) events.push(ev);

      const response = events.find((e) => e.type === 'end_turn').response;
      expect(response.content[0]).toEqual({ type: 'compaction', content: 'The summary.' });
      expect(response.content[1]).toMatchObject({ type: 'text', text: 'Hi' });
    });
  });
});

describe('AnthropicProvider.summarize', () => {
  it('sends the system prompt and one user message, no tools, with the explicit model and timeout', async () => {
    const provider = new AnthropicProvider({ get: () => 'sk-ant-test' } as any);
    const usage = { input_tokens: 1000, output_tokens: 200 };
    const finalMessage = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '## Goal ' }, { type: 'text', text: 'of the work\n' }],
      usage,
      stop_reason: 'end_turn',
    });
    const create = jest.fn(() => ({ finalMessage }));
    (provider as any).client = { messages: { stream: create } };

    const result = await provider.summarize({
      system: 'SYS',
      prompt: 'TRANSCRIPT',
      model: 'claude-opus-5',
      maxTokens: 8000,
      timeoutMs: 180_000,
    });

    const [body, options] = (create.mock.calls[0] as unknown) as [any, any];
    expect(body).toEqual({
      model: 'claude-opus-5',
      max_tokens: 8000,
      system: 'SYS',
      messages: [{ role: 'user', content: 'TRANSCRIPT' }],
    });
    expect(body).not.toHaveProperty('tools');
    expect(options).toEqual({ timeout: 180_000, maxRetries: 1 });
    expect(result).toEqual({ text: '## Goal of the work', usage, model: 'claude-opus-5', stopReason: 'end_turn' });
  });

  it('returns null text when the response has no text', async () => {
    const provider = new AnthropicProvider({ get: () => 'sk-ant-test' } as any);
    (provider as any).client = {
      messages: { stream: jest.fn(() => ({ finalMessage: jest.fn().mockResolvedValue({ content: [], usage: {} }) })) },
    };
    const result = await provider.summarize({ system: 's', prompt: 'p', model: 'm', maxTokens: 10, timeoutMs: 1 });
    expect(result.text).toBeNull();
  });
});
