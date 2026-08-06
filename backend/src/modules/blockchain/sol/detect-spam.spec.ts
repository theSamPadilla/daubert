import { HeliusParsedTx, HeliusTokenTransfer } from '../helius-client';
import { detectSpam, KNOWN_MINTS } from './detect-spam';

const ADDRESS = 'HolderAddress1111111111111111111111111111';
const SENDER = 'SenderAddress1111111111111111111111111111';
const UNKNOWN_MINT = 'ScamMint111111111111111111111111111111111';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function makeTokenTransfer(
  overrides: Partial<HeliusTokenTransfer> = {},
): HeliusTokenTransfer {
  return {
    fromUserAccount: SENDER,
    toUserAccount: ADDRESS,
    fromTokenAccount: 'sender-token-account',
    toTokenAccount: 'holder-token-account',
    mint: UNKNOWN_MINT,
    tokenAmount: 100,
    ...overrides,
  };
}

function makeTx(overrides: Partial<HeliusParsedTx> = {}): HeliusParsedTx {
  return {
    signature: 'sig',
    timestamp: 1_700_000_000,
    slot: 123,
    fee: 5_000,
    feePayer: SENDER,
    type: 'TRANSFER',
    source: 'SYSTEM_PROGRAM',
    nativeTransfers: [],
    tokenTransfers: [makeTokenTransfer()],
    transactionError: null,
    ...overrides,
  };
}

describe('KNOWN_MINTS', () => {
  it('contains exactly USDC, USDT, and wSOL, no more', () => {
    expect(KNOWN_MINTS).toEqual({
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: true,
      Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: true,
      So11111111111111111111111111111111111111112: true,
    });
  });
});

describe('detectSpam', () => {
  it('flags an unsolicited unknown-mint airdrop as spam', () => {
    const transfer = makeTokenTransfer();
    const tx = makeTx({ tokenTransfers: [transfer] });
    expect(detectSpam(tx, transfer, ADDRESS, false)).toEqual({
      spam: true,
      evidence: ['unsolicited', 'unknown-mint'],
    });
  });

  it('does not flag an unsolicited known-mint (resolved) transfer as spam', () => {
    const transfer = makeTokenTransfer({ mint: USDC_MINT });
    const tx = makeTx({ tokenTransfers: [transfer] });
    expect(detectSpam(tx, transfer, ADDRESS, true)).toEqual({
      spam: false,
      evidence: ['unsolicited'],
    });
  });

  it('flags a 50-recipient known-mint blast as spam via mass-distribution', () => {
    const transfers = Array.from({ length: 50 }, (_, i) =>
      makeTokenTransfer({
        mint: USDC_MINT,
        toUserAccount: i === 0 ? ADDRESS : `recipient-${i}`,
      }),
    );
    const tx = makeTx({ tokenTransfers: transfers });
    expect(detectSpam(tx, transfers[0], ADDRESS, true)).toEqual({
      spam: true,
      evidence: ['unsolicited', 'mass-distribution'],
    });
  });

  it('does not flag unsolicited when the recipient also sends via a token transfer elsewhere in the tx', () => {
    const transfer = makeTokenTransfer({ toUserAccount: ADDRESS });
    const otherTransfer = makeTokenTransfer({
      fromUserAccount: ADDRESS,
      toUserAccount: 'someone-else',
    });
    const tx = makeTx({ tokenTransfers: [transfer, otherTransfer] });
    expect(detectSpam(tx, transfer, ADDRESS, false)).toEqual({
      spam: false,
      evidence: ['unknown-mint'],
    });
  });

  it('does not flag unsolicited when the recipient also sends via a native transfer elsewhere in the tx', () => {
    const transfer = makeTokenTransfer({ toUserAccount: ADDRESS });
    const tx = makeTx({
      tokenTransfers: [transfer],
      nativeTransfers: [
        { fromUserAccount: ADDRESS, toUserAccount: 'someone-else', amount: 1_000 },
      ],
    });
    expect(detectSpam(tx, transfer, ADDRESS, false)).toEqual({
      spam: false,
      evidence: ['unknown-mint'],
    });
  });

  it('does not flag unsolicited when the recipient is the fee payer', () => {
    const transfer = makeTokenTransfer({ toUserAccount: ADDRESS });
    const tx = makeTx({ tokenTransfers: [transfer], feePayer: ADDRESS });
    expect(detectSpam(tx, transfer, ADDRESS, false)).toEqual({
      spam: false,
      evidence: ['unknown-mint'],
    });
  });

  it('does not flag unknown-mint when mintResolved is true, even for a mint outside KNOWN_MINTS', () => {
    const transfer = makeTokenTransfer();
    const tx = makeTx({ tokenTransfers: [transfer] });
    expect(detectSpam(tx, transfer, ADDRESS, true)).toEqual({
      spam: false,
      evidence: ['unsolicited'],
    });
  });

  it('does not flag mass-distribution at 9 distinct recipients', () => {
    const transfers = Array.from({ length: 9 }, (_, i) =>
      makeTokenTransfer({
        mint: USDC_MINT,
        toUserAccount: i === 0 ? ADDRESS : `recipient-${i}`,
      }),
    );
    const tx = makeTx({ tokenTransfers: transfers });
    expect(detectSpam(tx, transfers[0], ADDRESS, true)).toEqual({
      spam: false,
      evidence: ['unsolicited'],
    });
  });

  it('flags mass-distribution at 10 distinct non-null recipients even with an additional null toUserAccount', () => {
    const transfers = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeTokenTransfer({
          mint: USDC_MINT,
          toUserAccount: i === 0 ? ADDRESS : `recipient-${i}`,
        }),
      ),
      makeTokenTransfer({ mint: USDC_MINT, toUserAccount: null }),
    ];
    const tx = makeTx({ tokenTransfers: transfers });
    expect(detectSpam(tx, transfers[0], ADDRESS, true)).toEqual({
      spam: true,
      evidence: ['unsolicited', 'mass-distribution'],
    });
  });
});
