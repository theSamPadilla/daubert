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
});
