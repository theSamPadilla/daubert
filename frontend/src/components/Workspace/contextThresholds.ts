export const CONTEXT_WARN = 200_000;
export const CONTEXT_STRONG = 400_000;

export type BannerState = 'none' | 'warn' | 'strong';

export function bannerState(tokens: number): BannerState {
  if (tokens >= CONTEXT_STRONG) return 'strong';
  if (tokens >= CONTEXT_WARN) return 'warn';
  return 'none';
}
