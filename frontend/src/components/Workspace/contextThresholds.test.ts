import { bannerState, CONTEXT_WARN, CONTEXT_STRONG } from './contextThresholds';

describe('bannerState', () => {
  it('uses the agreed thresholds', () => {
    expect(CONTEXT_WARN).toBe(200_000);
    expect(CONTEXT_STRONG).toBe(400_000);
  });

  it.each([
    [0, 'none'],
    [199_999, 'none'],
    [200_000, 'warn'],
    [399_999, 'warn'],
    [400_000, 'strong'],
  ])('%i tokens -> %s', (tokens, expected) => {
    expect(bannerState(tokens)).toBe(expected);
  });
});
