import { TransactionEdge } from '../types/investigation';

/**
 * Normalise a token field that may be a plain string (e.g. "USDC" from AI
 * scripts) or a full object { symbol, decimals, address }.
 */
export function normalizeToken(
  token: TransactionEdge['token'] | string,
): { symbol: string; decimals: number; address: string } {
  if (typeof token === 'string') {
    return { symbol: token, decimals: 0, address: '' };
  }
  return token as { symbol: string; decimals: number; address: string };
}

/**
 * Parse a timestamp that may be:
 *  - an ISO string  "2022-01-24T19:08:00.000Z"
 *  - a Unix-seconds string  "1637684960"
 *  - a Unix-seconds number  1637684960
 */
export function parseTimestamp(ts: string | number | undefined | null): Date {
  if (ts == null || ts === '') return new Date(NaN);
  const n = Number(ts);
  if (!isNaN(n)) {
    // Heuristic: 10-digit numbers are seconds, 13-digit are milliseconds
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  return new Date(ts as string);
}

function abbrev(value: number, divisor: number, suffix: string): string {
  const v = value / divisor;
  return v.toFixed(2).replace(/\.?0+$/, '') + suffix;
}

/**
 * Format a raw token amount (in smallest unit) to a human-readable string,
 * automatically abbreviating large numbers with K / M / B / T suffixes.
 *
 * e.g. formatTokenAmount('17000000', 0) → '17M'
 *      formatTokenAmount('151035283000000', 6) → '151M'
 *      formatTokenAmount('2250000000000', 0) → '2.25T'
 *      formatTokenAmount('1500000000000000000', 18) → '1.5'
 */
export function formatTokenAmount(rawAmount: string, decimals: number): string {
  if (!rawAmount || rawAmount === '0') return '0';

  try {
    const raw = BigInt(rawAmount);
    const div = BigInt(10 ** decimals);
    const whole = raw / div;
    const remainder = raw % div;

    // Use floating-point for the abbreviation check
    const fullValue = Number(raw) / Math.pow(10, decimals);

    if (fullValue >= 1e12)       return abbrev(fullValue, 1e12, 'T');
    if (fullValue >= 1e9)        return abbrev(fullValue, 1e9, 'B');
    if (fullValue >= 1_000_000)  return abbrev(fullValue, 1_000_000, 'M');
    if (fullValue >= 1_000)      return abbrev(fullValue, 1_000, 'K');

    // Small numbers — keep full precision up to 4 decimal places
    let formatted = whole.toLocaleString('en-US');
    if (remainder > BigInt(0) && decimals > 0) {
      const fracStr = remainder.toString().padStart(decimals, '0');
      const trimmed = fracStr.replace(/0+$/, '');
      const display = trimmed.slice(0, 4);
      if (display) formatted += '.' + display;
    }
    return formatted;
  } catch {
    // Fallback for non-integer strings (already formatted or decimal)
    const num = Number(rawAmount);
    if (isNaN(num)) return rawAmount;
    if (num >= 1e12)       return abbrev(num, 1e12, 'T');
    if (num >= 1e9)        return abbrev(num, 1e9, 'B');
    if (num >= 1_000_000)  return abbrev(num, 1_000_000, 'M');
    if (num >= 1_000)      return abbrev(num, 1_000, 'K');
    return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
}
