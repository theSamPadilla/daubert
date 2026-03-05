/**
 * Format a raw token amount (in smallest unit) to a human-readable string.
 * e.g. formatTokenAmount('151035283000000', 6) → '151,035,283'
 *      formatTokenAmount('1500000000000000000', 18) → '1.5'
 */
export function formatTokenAmount(rawAmount: string, decimals: number): string {
  if (!rawAmount || rawAmount === '0') return '0';

  try {
    const raw = BigInt(rawAmount);
    const divisor = BigInt(10 ** decimals);
    const whole = raw / divisor;
    const remainder = raw % divisor;

    let formatted = whole.toLocaleString('en-US');

    if (remainder > 0n) {
      // Convert remainder to decimal string, padded to `decimals` length
      const fracStr = remainder.toString().padStart(decimals, '0');
      // Trim trailing zeros
      const trimmed = fracStr.replace(/0+$/, '');
      // Cap at 4 decimal places for readability
      const display = trimmed.slice(0, 4);
      if (display.length > 0) {
        formatted += '.' + display;
      }
    }

    return formatted;
  } catch {
    // Fallback for non-integer strings (already formatted or decimal)
    const num = Number(rawAmount);
    if (isNaN(num)) return rawAmount;
    return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
}
