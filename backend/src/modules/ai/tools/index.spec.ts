import { AGENT_TOOLS, READ_ONLY_AGENT_TOOLS, WRITE_ONLY_AGENT_TOOLS } from './index';

describe('AI tool registry partition', () => {
  it('every read-only tool is in the full agent tool set', () => {
    for (const tool of READ_ONLY_AGENT_TOOLS) {
      expect(AGENT_TOOLS).toContain(tool);
    }
  });

  it('partition is exhaustive — every AGENT_TOOLS tool is in exactly one of read/write', () => {
    const readSet = new Set(READ_ONLY_AGENT_TOOLS);
    const writeSet = new Set(WRITE_ONLY_AGENT_TOOLS);
    for (const tool of AGENT_TOOLS) {
      const inRead = readSet.has(tool);
      const inWrite = writeSet.has(tool);
      expect(inRead || inWrite).toBe(true);
      expect(inRead && inWrite).toBe(false);
    }
    expect(readSet.size + writeSet.size).toBe(AGENT_TOOLS.length);
  });
});
