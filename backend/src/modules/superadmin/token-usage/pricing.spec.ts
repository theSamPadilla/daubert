import { calculateCost, PRICING } from './pricing';

describe('calculateCost', () => {
  it('prices a pure-input Opus 4.6 call', () => {
    const cost = calculateCost('claude-opus-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    expect(cost).toBeCloseTo(5, 10);
  });

  it('prices a mixed Opus 4.6 turn with cache reads', () => {
    // 100k uncached input + 1M cached read + 50k output
    const cost = calculateCost('claude-opus-4-6', {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadInputTokens: 1_000_000,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    // (100k * $5 + 50k * $25 + 1M * $0.50) / 1M
    //   = 0.50 + 1.25 + 0.50 = 2.25
    expect(cost).toBeCloseTo(2.25, 10);
  });

  it('prices a Haiku title-generation call', () => {
    const cost = calculateCost('claude-haiku-4-5', {
      inputTokens: 200,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    // (200 * $1 + 20 * $5) / 1M
    expect(cost).toBeCloseTo(0.0003, 10);
  });

  it('returns null for unknown models — never throws', () => {
    const cost = calculateCost('claude-future-model-9000', {
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    expect(cost).toBeNull();
  });

  it('matches official prices for every model in PRICING', () => {
    // Sanity check — if anyone hand-edits PRICING and breaks a value,
    // this catches it. Numbers from
    // https://platform.claude.com/docs/en/about-claude/pricing
    expect(PRICING['claude-opus-4-6'].input).toBe(5);
    expect(PRICING['claude-opus-4-6'].output).toBe(25);
    expect(PRICING['claude-opus-4-6'].cacheRead).toBe(0.50);
    expect(PRICING['claude-opus-4-8'].input).toBe(5);
    expect(PRICING['claude-opus-4-8'].output).toBe(25);
    expect(PRICING['claude-sonnet-5'].input).toBe(3);
    expect(PRICING['claude-sonnet-5'].output).toBe(15);
    expect(PRICING['claude-haiku-4-5'].input).toBe(1);
    expect(PRICING['claude-haiku-4-5'].output).toBe(5);
  });

  // Source of truth for "model IDs the frontend can send us". Keep this in
  // lockstep with the MODELS array in frontend/src/components/Workspace/AIChat.tsx.
  // If you add a model to the dropdown, add it here too — this test catches
  // the silent-null-cost bug that the haiku-4-5-20251001 mismatch caused.
  const SUPPORTED_MODELS = [
    'claude-opus-4-8',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ];

  it.each(SUPPORTED_MODELS)('has pricing for %s', (model) => {
    expect(PRICING[model]).toBeDefined();
    const cost = calculateCost(model, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    expect(cost).not.toBeNull();
    expect(cost).toBeGreaterThan(0);
  });
});
