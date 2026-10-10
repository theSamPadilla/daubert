import { actionLabel, keyInput, sourceLabel } from './activityFormat';

describe('actionLabel', () => {
  it('names known tools and falls back to spaced names', () => {
    expect(actionLabel('get_case_data')).toBe('Read case data');
    expect(actionLabel('web_search')).toBe('Web search');
    expect(actionLabel('brand_new_tool')).toBe('brand new tool');
  });
});

describe('keyInput', () => {
  it('picks the first useful field for the tool', () => {
    expect(keyInput('web_search', { query: 'mixer flows' })).toBe('mixer flows');
    expect(keyInput('get_investigation', { address: '0xabc', investigationId: 'i1' })).toBe('0xabc');
    expect(keyInput('execute_script', { name: 'trace hops', code: '...' })).toBe('trace hops');
  });

  it('clips long values and handles tools without a key input', () => {
    expect(keyInput('web_search', { query: 'q'.repeat(100) })).toHaveLength(80);
    expect(keyInput('get_case_data', {})).toBeNull();
    expect(keyInput('web_search', null)).toBeNull();
  });
});

describe('sourceLabel', () => {
  it('names the chat and the MCP surface', () => {
    expect(sourceLabel({ source: 'chat', agent: 'claude-opus-5' })).toBe('Daubert chat');
    expect(sourceLabel({ source: 'mcp', agent: 'Claude Desktop' })).toBe('Claude Desktop');
    expect(sourceLabel({ source: 'mcp', agent: null })).toBe('External agent');
  });
});
