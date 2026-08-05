import { formatTokenAmount, formatHumanAmount } from './formatAmount';

describe('formatTokenAmount', () => {
  it('renders sub-0.0001 BTC amounts with extended precision (5000 sats @ 8 decimals)', () => {
    expect(formatTokenAmount('5000', 8)).toBe('0.00005');
  });

  it('renders sub-0.0001 BTC amounts with extended precision (123 sats @ 8 decimals)', () => {
    expect(formatTokenAmount('123', 8)).toBe('0.00000123');
  });

  it('caps extended precision at `decimals` total fractional digits and trims trailing zeros', () => {
    // 1 satoshi-equivalent unit at 18 decimals: fractional part is "000000000000000001"
    expect(formatTokenAmount('1', 18)).toBe('0.000000000000000001');
  });

  it('does not change amounts >= 0.0001 (regression: whole-number ETH-style value)', () => {
    expect(formatTokenAmount('1500000000000000000', 18)).toBe('1.5');
  });

  it('does not change amounts >= 0.0001 (regression: exact whole unit, no remainder)', () => {
    expect(formatTokenAmount('1000000', 6)).toBe('1');
  });

  it('does not change amounts >= 0.0001 (regression: fractional value above threshold)', () => {
    // 0.05 at 8 decimals — first 4 fractional digits are "0500", not all zero
    expect(formatTokenAmount('5000000', 8)).toBe('0.05');
  });

  it('abbreviates values >= 1000 with K/M/B/T suffixes unchanged', () => {
    expect(formatTokenAmount('17000000', 0)).toBe('17M');
    expect(formatTokenAmount('151035283000000', 6)).toBe('151.04M');
    expect(formatTokenAmount('2250000000000', 0)).toBe('2.25T');
  });

  it('returns "0" for a zero amount', () => {
    expect(formatTokenAmount('0', 8)).toBe('0');
  });

  it('returns "0" for an empty string', () => {
    expect(formatTokenAmount('', 8)).toBe('0');
  });
});

describe('formatHumanAmount', () => {
  it('renders a small BTC aggregate at 4 fractional digits (regression: collapsed group read "0 BTC")', () => {
    expect(formatHumanAmount(0.02736284)).toBe('0.0273');
  });

  it('does not round a 4-digit value further', () => {
    expect(formatHumanAmount(0.0274)).toBe('0.0274');
  });

  it('extends precision below 0.0001 so first significant digits are visible', () => {
    expect(formatHumanAmount(0.0000079)).toBe('0.0000079');
  });

  it('renders one satoshi (1e-8)', () => {
    expect(formatHumanAmount(0.00000001)).toBe('0.00000001');
  });

  it('keeps K/M/B/T abbreviation for large values (parity with formatTokenAmount)', () => {
    expect(formatHumanAmount(17_000_000)).toBe('17M');
    expect(formatHumanAmount(151_035_283)).toBe('151.04M');
    expect(formatHumanAmount(2_250_000_000_000)).toBe('2.25T');
    expect(formatHumanAmount(1546.373)).toBe('1.55K');
  });

  it('leaves mid-range values in plain notation', () => {
    expect(formatHumanAmount(920.55)).toBe('920.55');
    expect(formatHumanAmount(1.5)).toBe('1.5');
  });

  it('returns "0" for zero and non-finite input', () => {
    expect(formatHumanAmount(0)).toBe('0');
    expect(formatHumanAmount(NaN)).toBe('0');
    expect(formatHumanAmount(Infinity)).toBe('0');
  });

  it('truncates rather than rounds, matching formatTokenAmount for the same value', () => {
    // A plain edge label and a collapsed-group aggregate must never disagree.
    expect(formatHumanAmount(0.02736284)).toBe(formatTokenAmount('2736284', 8));
    expect(formatHumanAmount(1.23456789)).toBe(formatTokenAmount('1234567890000000000', 18));
  });

  it('does not render a sub-1e-8 (18-decimal) aggregate as "0"', () => {
    expect(formatHumanAmount(1e-12)).not.toBe('0');
    expect(formatHumanAmount(1e-15)).not.toBe('0');
  });

  it('formats negative values with the sign intact', () => {
    expect(formatHumanAmount(-1.5)).toBe('-1.5');
    expect(formatHumanAmount(-1500)).toBe('-1.5K');
  });

  it('does not introduce float-accumulation noise', () => {
    expect(formatHumanAmount(0.1 + 0.2)).toBe('0.3');
  });
});
