import {
  warningLabel,
  evidenceLabel,
  evidenceTitle,
  formatBtcValue,
  confirmationLabel,
  truncateMiddle,
} from './utxoDisplay';

describe('warningLabel', () => {
  it('maps possible-coinjoin', () => {
    expect(warningLabel('possible-coinjoin')).toBe('Possible CoinJoin');
  });

  it('maps consolidation', () => {
    expect(warningLabel('consolidation')).toBe('Consolidation');
  });

  it('maps multi-input', () => {
    expect(warningLabel('multi-input')).toBe('Multi-input');
  });

  it('maps coinbase', () => {
    expect(warningLabel('coinbase')).toBe('Coinbase');
  });

  it('passes unknown strings through unchanged', () => {
    expect(warningLabel('some-future-warning')).toBe('some-future-warning');
  });
});

describe('evidenceLabel', () => {
  it('maps address-reuse', () => {
    expect(evidenceLabel('address-reuse')).toBe('address reuse');
  });

  it('maps script-type-match', () => {
    expect(evidenceLabel('script-type-match')).toBe('script-type match');
  });

  it('maps non-round-value', () => {
    expect(evidenceLabel('non-round-value')).toBe('non-round value');
  });

  it('passes unknown strings through unchanged', () => {
    expect(evidenceLabel('some-future-evidence')).toBe('some-future-evidence');
  });
});

describe('evidenceTitle', () => {
  it('joins multiple evidence labels with a comma', () => {
    expect(evidenceTitle(['script-type-match', 'non-round-value'])).toBe(
      'script-type match, non-round value',
    );
  });

  it('renders a single evidence label', () => {
    expect(evidenceTitle(['address-reuse'])).toBe('address reuse');
  });

  it('falls back to a generic label when evidence is undefined', () => {
    expect(evidenceTitle(undefined)).toBe('Change output');
  });

  it('falls back to a generic label when evidence is an empty array', () => {
    expect(evidenceTitle([])).toBe('Change output');
  });

  it('falls back to a generic label when evidence is null', () => {
    expect(evidenceTitle(null)).toBe('Change output');
  });
});

describe('formatBtcValue', () => {
  it('formats satoshis with 8 decimals and a BTC suffix', () => {
    expect(formatBtcValue('100000000')).toBe('1 BTC');
  });

  it('formats sub-satoshi-unit amounts with extended precision', () => {
    expect(formatBtcValue('5000')).toBe('0.00005 BTC');
  });

  it('formats a zero amount', () => {
    expect(formatBtcValue('0')).toBe('0 BTC');
  });

  it('treats undefined as zero', () => {
    expect(formatBtcValue(undefined)).toBe('0 BTC');
  });

  it('treats null as zero', () => {
    expect(formatBtcValue(null)).toBe('0 BTC');
  });
});

describe('confirmationLabel', () => {
  it('reports confirmed with a block height', () => {
    expect(confirmationLabel(true, 820123)).toBe('Confirmed · Block 820,123');
  });

  it('reports unconfirmed with no block height', () => {
    expect(confirmationLabel(false, null)).toBe('Unconfirmed');
  });

  it('reports just the block height when confirmed is unknown', () => {
    expect(confirmationLabel(undefined, 820123)).toBe('Block 820,123');
  });

  it('returns an empty string when nothing is known', () => {
    expect(confirmationLabel(undefined, undefined)).toBe('');
    expect(confirmationLabel(undefined, null)).toBe('');
  });
});

describe('truncateMiddle', () => {
  it('truncates a long value to front…back', () => {
    expect(truncateMiddle('bc1qspender1longaddressxxxxxxxxxxxx', 6, 4)).toBe('bc1qsp…xxxx');
  });

  it('leaves short values unchanged', () => {
    expect(truncateMiddle('bc1qa', 6, 4)).toBe('bc1qa');
  });

  it('leaves values exactly at the boundary unchanged', () => {
    // front + back + 1 === length -> not truncated
    expect(truncateMiddle('1234567890', 6, 3)).toBe('1234567890');
  });

  it('returns an empty string for empty input', () => {
    expect(truncateMiddle('')).toBe('');
  });

  it('returns an empty string for undefined input', () => {
    expect(truncateMiddle(undefined)).toBe('');
  });

  it('returns an empty string for null input', () => {
    expect(truncateMiddle(null)).toBe('');
  });

  it('uses default front/back of 6/4 when not specified', () => {
    expect(truncateMiddle('a1b2c3d4e5f6g7h8i9j0')).toBe('a1b2c3…i9j0');
  });
});
