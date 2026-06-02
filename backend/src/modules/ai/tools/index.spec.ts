import { AGENT_TOOLS, READ_ONLY_AGENT_TOOLS } from './index';

describe('AI tool registry partition', () => {
  it('every read-only tool is in the full agent tool set', () => {
    for (const tool of READ_ONLY_AGENT_TOOLS) {
      expect(AGENT_TOOLS).toContain(tool);
    }
  });

  it('READ_ONLY_AGENT_TOOLS includes execute_script', () => {
    const names = READ_ONLY_AGENT_TOOLS.map((t) => t.name);
    expect(names).toContain('execute_script');
  });

  it('READ_ONLY_AGENT_TOOLS contains no mutating tools', () => {
    const names = READ_ONLY_AGENT_TOOLS.map((t) => t.name);
    for (const writeName of [
      'create_production',
      'update_production',
      'add_label',
      'update_label',
      'delete_label',
      'move_label',
      'tether_label',
    ]) {
      expect(names).not.toContain(writeName);
    }
  });
});
