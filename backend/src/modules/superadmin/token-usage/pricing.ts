// Pricing source: https://platform.claude.com/docs/en/about-claude/pricing

type ModelPricing = {
  input: number;          // $ / MTok
  output: number;         // $ / MTok
  cacheWrite5m: number;   // $ / MTok
  cacheWrite1h: number;   // $ / MTok
  cacheRead: number;      // $ / MTok
};

export const PRICING: Record<string, ModelPricing> = {
  // claude-opus-4-7 / claude-opus-4-6 are no longer offered in the chat model
  // picker, but stay here so historical token-usage rows still price correctly.
  'claude-opus-4-8':   { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.50 },
  'claude-opus-4-7':   { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.50 },
  'claude-opus-4-6':   { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.50 },
  'claude-sonnet-5':   { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6,  cacheRead: 0.30 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6,  cacheRead: 0.30 },
  'claude-haiku-4-5':  { input: 1, output: 5,  cacheWrite5m: 1.25, cacheWrite1h: 2,  cacheRead: 0.10 },
};

export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
};

/**
 * Returns USD cost. `null` if the model is unknown — the caller decides how
 * to surface that (UI shows "—", API includes the row with cost: null).
 * Never throws; pricing drift must not break dashboards.
 */
export function calculateCost(model: string, tokens: TokenCounts): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (
    (tokens.inputTokens * p.input
      + tokens.outputTokens * p.output
      + tokens.cacheReadInputTokens * p.cacheRead
      + tokens.cacheCreation5mInputTokens * p.cacheWrite5m
      + tokens.cacheCreation1hInputTokens * p.cacheWrite1h) / 1_000_000
  );
}
