import { TransactionEdge } from '../types/investigation';

const INTEGER_AMOUNT = /^-?\d+$/;

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
 * Canonical token identity for dedup. Prefers the on-chain address (case-insensitive)
 * because two edges can legitimately differ in symbol formatting ("USDC" vs "usdc")
 * or symbol field ("USD Coin" vs "USDC"). Address is the only stable identifier.
 * Falls back to uppercase symbol when no address is available (e.g., native ETH/TRX).
 */
export function tokenKey(token: TransactionEdge['token'] | string): string {
  const t = normalizeToken(token);
  const addr = (t.address || '').toLowerCase();
  if (addr) return addr;
  return (t.symbol || '').toUpperCase();
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
      let display = trimmed.slice(0, 4);
      // Sub-0.0001 values: the first 4 fractional digits are all zero, so the
      // usual 4-digit window would render as e.g. "0.0000". Extend the window
      // to the full (trailing-zero-trimmed) fraction, capped at `decimals`
      // digits, so the first significant digit(s) are visible.
      if (whole === BigInt(0) && /^0*$/.test(display)) {
        display = trimmed;
      }
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

/**
 * Format an already-human token amount (a float, post-division by 10^decimals)
 * for display. Mirrors formatTokenAmount's policy so aggregated/summed values
 * read identically to single-edge labels:
 *  - >= 1000: K/M/B/T abbreviation
 *  - < 1000: up to 4 fractional digits, truncated (matching formatTokenAmount)
 *  - below 0.0001 (but non-zero): extended window up to 8 fractional digits so
 *    the first significant digits stay visible (e.g. "0.0000079", never "0")
 *
 * Use this for values that only exist as accumulated floats (aggregated edges,
 * bundle labels, group flows, multi-tx totals). When the raw smallest-unit
 * string is at hand, prefer formatTokenAmount — its BigInt path is exact.
 */
export function formatHumanAmount(h: number): string {
  if (!isFinite(h) || h === 0) return '0';
  const abs = Math.abs(h);
  if (abs >= 1e12) return abbrev(h, 1e12, 'T');
  if (abs >= 1e9) return abbrev(h, 1e9, 'B');
  if (abs >= 1_000_000) return abbrev(h, 1_000_000, 'M');
  if (abs >= 1_000) return abbrev(h, 1_000, 'K');
  const whole = Math.trunc(abs);
  // 12 digits absorbs float-accumulation noise (0.1 + 0.2 → "0.3") while still
  // reaching 1e-12; truncate (never round up) exactly like formatTokenAmount, so
  // the same value reads identically whether or not its group is collapsed.
  const frac = (abs - whole).toFixed(12).slice(2).replace(/0+$/, '');
  let display = frac.slice(0, 4);
  // Sub-0.0001: the 4-digit window is all zeros, so widen it to the first
  // significant digits rather than rendering "0".
  if (whole === 0 && /^0*$/.test(display)) display = frac;
  // Below 1e-12 the fixed window is empty — fall back to significant digits so a
  // wei-scale total never renders as "0".
  if (whole === 0 && !display) return h.toLocaleString('en-US', { maximumSignificantDigits: 4 });
  return (h < 0 ? '-' : '') + whole.toLocaleString('en-US') + (display ? '.' + display : '');
}

/**
 * Format a fiat amount held in minor units (e.g. cents) as exact currency text.
 * Scales with BigInt so values beyond Number.MAX_SAFE_INTEGER lose no precision;
 * Intl only supplies the currency symbol and its position. A non-ISO currency
 * code (Intl throws RangeError) falls back to "<amount> <code>".
 */
export function formatFiatAmount(rawAmount: string, decimals: number, currency: string): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !INTEGER_AMOUNT.test(rawAmount)) {
    return `${rawAmount} ${currency}`;
  }
  const raw = BigInt(rawAmount);
  const negative = raw < BigInt(0);
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, '0');
  const whole = decimals > 0 ? digits.slice(0, -decimals) : digits;
  const frac = decimals > 0 ? digits.slice(-decimals) : '';
  const plain = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
  const sign = negative ? '-' : '';

  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).formatToParts(0);
  } catch {
    return `${sign}${plain} ${currency}`;
  }
  const body = parts
    .map((p) => {
      if (p.type === 'integer') return plain.split('.')[0];
      if (p.type === 'fraction') return frac;
      return p.value;
    })
    .join('');
  return `${sign}${body}`;
}

/** True only for a fiat edge whose amount is an integer string of minor units and
 * whose token decimals are a sane integer; legacy decimal amounts return false. */
export function isExactFiat(e: { chain?: string; amount: unknown; token: TransactionEdge['token'] | string }): boolean {
  if (e.chain !== 'fiat') return false;
  if (!INTEGER_AMOUNT.test(String(e.amount))) return false;
  const d = normalizeToken(e.token).decimals;
  return Number.isInteger(d) && d >= 0 && d <= 36;
}

/** Display text for one edge amount: exact currency for fiat, token format otherwise. */
export function formatEdgeAmount(e: { chain?: string; amount: unknown; token: TransactionEdge['token'] | string }): string {
  const tok = normalizeToken(e.token);
  if (isExactFiat(e)) return formatFiatAmount(String(e.amount), tok.decimals, tok.symbol);
  return `${formatTokenAmount(String(e.amount), tok.decimals)} ${tok.symbol}`;
}

/** Exact BigInt total of fiat edges, or null unless the list is non-empty, every
 * edge is exact fiat, and all share symbol and decimals. */
export function sumExactFiat(edges: { chain?: string; amount: unknown; token: TransactionEdge['token'] | string }[]): string | null {
  if (edges.length === 0 || !edges.every(isExactFiat)) return null;
  const first = normalizeToken(edges[0].token);
  if (!edges.every((e) => {
    const t = normalizeToken(e.token);
    return t.symbol === first.symbol && t.decimals === first.decimals;
  })) return null;
  const total = edges.reduce((sum, e) => sum + BigInt(String(e.amount)), BigInt(0));
  return formatFiatAmount(total.toString(), first.decimals, first.symbol);
}

/** Convert a human decimal string ('400000.50') to minor units ('40000050'). */
export function toMinorUnits(human: string, decimals: number): string | null {
  const t = human.trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] ?? '';
  if (frac.length > decimals) return null;
  const digits = ((m[2] || '') + frac.padEnd(decimals, '0')).replace(/^0+/, '') || '0';
  return digits === '0' ? '0' : m[1] + digits;
}

/** Inverse of toMinorUnits; always `decimals` fraction digits. */
export function fromMinorUnits(raw: string, decimals: number): string {
  const neg = raw.startsWith('-');
  const digits = (neg ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const whole = decimals > 0 ? digits.slice(0, -decimals) : digits;
  const frac = decimals > 0 ? '.' + digits.slice(-decimals) : '';
  return (neg ? '-' : '') + whole + frac;
}
