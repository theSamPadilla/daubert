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
  });
});
