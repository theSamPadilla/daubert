import { edgeIdentityKey } from '../../../generated/shared/edge-identity';
import {
  HeliusNativeTransfer,
  HeliusParsedTx,
  HeliusTokenTransfer,
  MintMetadata,
} from '../helius-client';
import { decimalToRaw, mapSolanaHistory } from './map-solana-history';

const A = 'SubjectWa11et11111111111111111111111111111';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SPAM_MINT = 'Sp4mM1nt111111111111111111111111111111111';

const SIG = 'sig-abc';
const SLOT = 250_000_000;
const TIMESTAMP = 1_700_000_000;

function nativeTransfer(
  opts: {
    from?: string | null;
    to?: string | null;
    amount?: number;
  } = {},
): HeliusNativeTransfer {
  const { from = 'SenderWa11et', to = A, amount = 1_500_000_000 } = opts;
  return { fromUserAccount: from, toUserAccount: to, amount };
}

function tokenTransfer(
  opts: {
    from?: string | null;
    to?: string | null;
    amount?: number;
    mint?: string;
    fromTokenAccount?: string | null;
    toTokenAccount?: string | null;
  } = {},
): HeliusTokenTransfer {
  const {
    from = 'SenderWa11et',
    to = A,
    amount = 1.5,
    mint = USDC,
    fromTokenAccount = 'FromTokenAcct',
    toTokenAccount = 'ToTokenAcct',
  } = opts;
  return {
    fromUserAccount: from,
    toUserAccount: to,
    fromTokenAccount,
    toTokenAccount,
    mint,
    tokenAmount: amount,
  };
}

function tx(
  opts: {
    signature?: string;
    timestamp?: number;
    slot?: number;
    feePayer?: string;
    type?: string;
    source?: string;
    native?: HeliusNativeTransfer[];
    tokens?: HeliusTokenTransfer[];
    error?: unknown;
  } = {},
): HeliusParsedTx {
  const {
    signature = SIG,
    timestamp = TIMESTAMP,
    slot = SLOT,
    feePayer = 'SenderWa11et',
    type = 'TRANSFER',
    source = 'SYSTEM_PROGRAM',
    native = [],
    tokens = [],
    error = null,
  } = opts;
  return {
    signature,
    timestamp,
    slot,
    fee: 5_000,
    feePayer,
    type,
    source,
    nativeTransfers: native,
    tokenTransfers: tokens,
    transactionError: error,
  };
}

function mints(...entries: MintMetadata[]): Map<string, MintMetadata> {
  return new Map(entries.map((m) => [m.mint, m]));
}

const USDC_META: MintMetadata = { mint: USDC, symbol: 'USDC', decimals: 6, resolved: true };
const NO_MINTS = new Map<string, MintMetadata>();

describe('decimalToRaw', () => {
  it('scales a decimal string by the mint decimals', () => {
    expect(decimalToRaw('1.5', 6)).toBe('1500000');
  });

  it('scales the equivalent number input identically', () => {
    expect(decimalToRaw(1.5, 6)).toBe('1500000');
  });

  it('scales an integer input', () => {
    expect(decimalToRaw(5, 6)).toBe('5000000');
    expect(decimalToRaw('0.25', 9)).toBe('250000000');
  });

  it('produces a single raw unit for the smallest representable amount', () => {
    expect(decimalToRaw(0.000001, 6)).toBe('1');
  });

  it('handles number inputs that JS stringifies in exponential notation', () => {
    // The canary: String(0.0000001) === '1e-7'. A naive split on '.' reads the
    // integer part as '1e-7' and produces garbage.
    expect(String(0.0000001)).toBe('1e-7');
    expect(decimalToRaw(0.0000001, 9)).toBe('100');
  });

  it('handles large numbers that JS stringifies in exponential notation', () => {
    // String(1e21) === '1e+21' — the same hazard at the other end of the range.
    expect(String(1e21)).toBe('1e+21');
    expect(decimalToRaw(1e21, 0)).toBe('1' + '0'.repeat(21));
  });

  it('truncates fraction digits beyond the mint decimals', () => {
    expect(decimalToRaw('1.23456789', 6)).toBe('1234567');
  });

  it('returns "0" for zero regardless of how it is written', () => {
    expect(decimalToRaw(0, 9)).toBe('0');
    expect(decimalToRaw('0.000', 9)).toBe('0');
  });

  it('is exact for string inputs but inherits float precision loss for numbers', () => {
    // A number input has already lost precision before this function sees it:
    // the double nearest 123456789.123456789 stringifies as
    // '123456789.12345679'. decimalToRaw is exact on whatever it receives, so
    // it reproduces that value faithfully rather than the literal typed above.
    // Callers that need full precision must pass the amount as a string.
    const asNumber = decimalToRaw(123456789.123456789, 9);
    expect(asNumber).toBe(decimalToRaw(String(123456789.123456789), 9));
    expect(asNumber).toBe('123456789123456790');

    expect(decimalToRaw('123456789.123456789', 9)).toBe('123456789123456789');
    expect(decimalToRaw('123456789.123456789', 9)).not.toBe(asNumber);
  });
});

describe('mapSolanaHistory', () => {
  describe('constant row fields', () => {
    it('stamps every row with solana metadata and empty annotations', () => {
      const rows = mapSolanaHistory(A, [tx({ native: [nativeTransfer()] })], NO_MINTS);

      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.chain).toBe('solana');
      expect(row.txHash).toBe(SIG);
      expect(row.blockNumber).toBe(SLOT);
      expect(row.timestamp).toBe(new Date(TIMESTAMP * 1000).toISOString());
      expect(row.notes).toBe('');
      expect(row.tags).toEqual([]);
      expect(row.crossTrace).toBe(false);
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('gives every row a distinct id', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            native: [nativeTransfer(), nativeTransfer({ amount: 2_000 })],
          }),
        ],
        NO_MINTS,
      );
      expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    });
  });

  // 1 ------------------------------------------------------------------
  describe('incoming native SOL', () => {
    it('emits a lamport-denominated row with SOL/9 token metadata', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            native: [
              nativeTransfer({ from: 'SenderWa11et', to: A, amount: 1_500_000_000 }),
            ],
          }),
        ],
        NO_MINTS,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe('SenderWa11et');
      expect(rows[0].to).toBe(A);
      // Lamports verbatim — never rescaled.
      expect(rows[0].amount).toBe('1500000000');
      expect(rows[0].token).toEqual({ address: '', symbol: 'SOL', decimals: 9 });
    });

    it('renders the amount as plain digits even for a huge lamport value', () => {
      // Amounts are strings on the wire and in exhibits; exponential notation
      // ('1e+21') must never leak into one.
      const rows = mapSolanaHistory(
        A,
        [tx({ native: [nativeTransfer({ amount: 1e21 })] })],
        NO_MINTS,
      );

      expect(rows[0].amount).toMatch(/^\d+$/);
      expect(rows[0].amount).toBe('1' + '0'.repeat(21));
    });

    it('carries a native context with no mint or token-account fields', () => {
      const rows = mapSolanaHistory(
        A,
        [tx({ type: 'TRANSFER', source: 'SYSTEM_PROGRAM', native: [nativeTransfer()] })],
        NO_MINTS,
      );

      expect(rows[0].solana).toEqual({
        transferIndex: 0,
        feePayer: 'SenderWa11et',
        kind: 'native',
        type: 'TRANSFER',
        source: 'SYSTEM_PROGRAM',
        slot: SLOT,
      });
      expect(rows[0].solana).not.toHaveProperty('mint');
      expect(rows[0].solana).not.toHaveProperty('decimals');
      expect(rows[0].solana).not.toHaveProperty('fromTokenAccount');
      expect(rows[0].solana).not.toHaveProperty('toTokenAccount');
    });
  });

  // 2 ------------------------------------------------------------------
  describe('outgoing SPL token', () => {
    const fixture = tx({
      signature: 'sig-usdc-out',
      feePayer: A,
      native: [],
      tokens: [
        tokenTransfer({
          from: A,
          to: 'RecipientWa11et',
          amount: 1.5,
          mint: USDC,
          fromTokenAccount: 'AUsdcAcct',
          toTokenAccount: 'RecipientUsdcAcct',
        }),
      ],
    });

    it('converts the decimal-adjusted amount to raw base units', () => {
      const rows = mapSolanaHistory(A, [fixture], mints(USDC_META));

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe(A);
      expect(rows[0].to).toBe('RecipientWa11et');
      expect(rows[0].amount).toBe('1500000');
      expect(rows[0].token).toEqual({ address: USDC, symbol: 'USDC', decimals: 6 });
    });

    it('carries the raw token accounts as evidence on the spl context', () => {
      const rows = mapSolanaHistory(A, [fixture], mints(USDC_META));

      expect(rows[0].solana).toEqual({
        transferIndex: 0,
        feePayer: A,
        kind: 'spl',
        mint: USDC,
        decimals: 6,
        fromTokenAccount: 'AUsdcAcct',
        toTokenAccount: 'RecipientUsdcAcct',
        type: 'TRANSFER',
        source: 'SYSTEM_PROGRAM',
        slot: SLOT,
      });
    });
  });

  // 3 ------------------------------------------------------------------
  describe('swap (one native + two token legs)', () => {
    const fixture = tx({
      signature: 'sig-swap',
      feePayer: A,
      type: 'SWAP',
      source: 'JUPITER',
      native: [nativeTransfer({ from: A, to: 'Poo1Wa11et', amount: 500_000_000 })],
      tokens: [
        tokenTransfer({
          from: A,
          to: 'Poo1Wa11et',
          amount: 10,
          mint: USDC,
        }),
        tokenTransfer({
          from: 'Poo1Wa11et',
          to: A,
          amount: 2.5,
          mint: USDC,
        }),
      ],
    });

    it('emits one row per transfer with native legs indexed first', () => {
      const rows = mapSolanaHistory(A, [fixture], mints(USDC_META));

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.solana?.transferIndex)).toEqual([0, 1, 2]);
      expect(rows.map((r) => r.solana?.kind)).toEqual(['native', 'spl', 'spl']);
      expect(rows.map((r) => [r.from, r.to, r.amount])).toEqual([
        [A, 'Poo1Wa11et', '500000000'],
        [A, 'Poo1Wa11et', '10000000'],
        ['Poo1Wa11et', A, '2500000'],
      ]);
    });

    it('gives each leg a distinct edge identity key under the same signature', () => {
      const rows = mapSolanaHistory(A, [fixture], mints(USDC_META));
      const keys = rows.map((r) => edgeIdentityKey(r, r.from, r.to));

      expect(keys).toEqual(['sig-swap:sol:0', 'sig-swap:sol:1', 'sig-swap:sol:2']);
      expect(new Set(keys).size).toBe(3);
    });

    it('stamps the Helius type and source on every leg', () => {
      const rows = mapSolanaHistory(A, [fixture], mints(USDC_META));
      expect(rows.every((r) => r.solana?.type === 'SWAP')).toBe(true);
      expect(rows.every((r) => r.solana?.source === 'JUPITER')).toBe(true);
    });

    it('leaves spam fields off a leg the subject participated in', () => {
      const rows = mapSolanaHistory(A, [fixture], mints(USDC_META));
      for (const row of rows) {
        expect(row.solana).not.toHaveProperty('spam');
        expect(row.solana).not.toHaveProperty('spamEvidence');
      }
    });
  });

  // 4 ------------------------------------------------------------------
  describe('unsolicited unknown-mint airdrop', () => {
    const fixture = tx({
      signature: 'sig-airdrop',
      feePayer: 'Airdr0pperWa11et',
      type: 'TRANSFER',
      source: 'UNKNOWN',
      tokens: [
        tokenTransfer({
          from: 'Airdr0pperWa11et',
          to: A,
          amount: 1000,
          mint: SPAM_MINT,
        }),
      ],
    });

    it('flags the row as spam with its evidence', () => {
      const rows = mapSolanaHistory(A, [fixture], NO_MINTS);

      expect(rows).toHaveLength(1);
      expect(rows[0].solana?.spam).toBe(true);
      expect(rows[0].solana?.spamEvidence).toEqual(['unsolicited', 'unknown-mint']);
    });

    it('falls back to a truncated-mint symbol and 0 decimals when unresolved', () => {
      const rows = mapSolanaHistory(A, [fixture], NO_MINTS);

      expect(rows[0].token).toEqual({
        address: SPAM_MINT,
        symbol: `${SPAM_MINT.slice(0, 4)}…`,
        decimals: 0,
      });
      expect(rows[0].solana?.decimals).toBe(0);
      expect(rows[0].amount).toBe('1000');
    });

    it('still names both real endpoints from the ledger', () => {
      const rows = mapSolanaHistory(A, [fixture], NO_MINTS);
      expect(rows[0].from).toBe('Airdr0pperWa11et');
      expect(rows[0].to).toBe(A);
    });
  });

  // 5 ------------------------------------------------------------------
  describe('spam evaluation scope', () => {
    it('never evaluates spam on a native transfer, however unsolicited', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-native-dust',
            feePayer: 'Stranger',
            native: [nativeTransfer({ from: 'Stranger', to: A, amount: 1 })],
          }),
        ],
        NO_MINTS,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].solana).not.toHaveProperty('spam');
      expect(rows[0].solana).not.toHaveProperty('spamEvidence');
    });

    it('never evaluates spam on an outgoing token transfer', () => {
      const recipients = Array.from({ length: 12 }, (_, i) =>
        tokenTransfer({
          from: A,
          to: `Recipient${i}`,
          amount: 1,
          mint: SPAM_MINT,
        }),
      );
      const rows = mapSolanaHistory(
        A,
        [tx({ signature: 'sig-mass-out', feePayer: 'Operator', tokens: recipients })],
        NO_MINTS,
      );

      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(row.solana).not.toHaveProperty('spam');
        expect(row.solana).not.toHaveProperty('spamEvidence');
      }
    });

    it('records evidence without flagging spam when only one heuristic fires', () => {
      // Incoming, unsolicited, but a known+resolved mint to a single
      // recipient: evidence is preserved verbatim, the verdict is not spam.
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-unsolicited-usdc',
            feePayer: 'Payer',
            tokens: [
              tokenTransfer({ from: 'Payer', to: A, amount: 25, mint: USDC }),
            ],
          }),
        ],
        mints(USDC_META),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].solana?.spam).toBe(false);
      expect(rows[0].solana?.spamEvidence).toEqual(['unsolicited']);
    });
  });

  // 6 ------------------------------------------------------------------
  describe('failed transactions', () => {
    it('emits no rows when transactionError is set', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-failed',
            error: { InstructionError: [0, { Custom: 1 }] },
            native: [nativeTransfer()],
            tokens: [tokenTransfer()],
          }),
        ],
        mints(USDC_META),
      );

      expect(rows).toEqual([]);
    });
  });

  // 7 ------------------------------------------------------------------
  describe('zero-amount transfers', () => {
    it('skips a zero-lamport native transfer', () => {
      const rows = mapSolanaHistory(
        A,
        [tx({ native: [nativeTransfer({ amount: 0 })] })],
        NO_MINTS,
      );
      expect(rows).toEqual([]);
    });

    it('skips a zero-amount token transfer', () => {
      const rows = mapSolanaHistory(
        A,
        [tx({ tokens: [tokenTransfer({ amount: 0 })] })],
        mints(USDC_META),
      );
      expect(rows).toEqual([]);
    });

    it('keeps a nonzero transfer that shares a tx with a zero-amount one', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-mixed',
            native: [
              nativeTransfer({ amount: 0 }),
              nativeTransfer({ amount: 7 }),
            ],
          }),
        ],
        NO_MINTS,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe('7');
      // Index of the surviving transfer is its position in the tx, not its
      // position among emitted rows.
      expect(rows[0].solana?.transferIndex).toBe(1);
    });
  });

  // 8 ------------------------------------------------------------------
  describe('null endpoints', () => {
    it('emits no row for a transfer with no named sender', () => {
      const rows = mapSolanaHistory(
        A,
        [tx({ native: [nativeTransfer({ from: null, to: A })] })],
        NO_MINTS,
      );
      expect(rows).toEqual([]);
    });

    it('emits no row for a transfer with no named recipient', () => {
      const rows = mapSolanaHistory(
        A,
        [tx({ native: [nativeTransfer({ from: A, to: null })] })],
        NO_MINTS,
      );
      expect(rows).toEqual([]);
    });

    it('emits no row for a token transfer with no named sender', () => {
      const rows = mapSolanaHistory(
        A,
        [tx({ tokens: [tokenTransfer({ from: null, to: A })] })],
        mints(USDC_META),
      );
      expect(rows).toEqual([]);
    });

    it('never emits a row with an empty endpoint from any fixture', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-nulls',
            native: [
              nativeTransfer({ from: null, to: A }),
              nativeTransfer({ from: A, to: null }),
              nativeTransfer({ from: 'Sender', to: A, amount: 9 }),
            ],
            tokens: [
              tokenTransfer({ from: null, to: A }),
              tokenTransfer({ from: A, to: null }),
            ],
          }),
        ],
        mints(USDC_META),
      );

      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.from !== '' && r.to !== '')).toBe(true);
      expect(rows[0].solana?.transferIndex).toBe(2);
    });

    it('treats an empty-string endpoint as unnamed, exactly like null', () => {
      // Helius renders an unresolved owner as null, but an empty string is the
      // same claim: nobody is named. A row with from: '' would draw an edge to
      // a node that does not exist on the canvas.
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-empty-endpoint',
            native: [nativeTransfer({ from: '', to: A, amount: 5 })],
            tokens: [tokenTransfer({ from: '', to: A, amount: 5 })],
          }),
        ],
        mints(USDC_META),
      );

      expect(rows).toEqual([]);
    });

    it('keeps a null token account without dropping the row', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            tokens: [
              tokenTransfer({
                from: 'Sender',
                to: A,
                fromTokenAccount: null,
                toTokenAccount: 'ToAcct',
              }),
            ],
          }),
        ],
        mints(USDC_META),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].solana?.fromTokenAccount).toBeUndefined();
      expect(rows[0].solana?.toTokenAccount).toBe('ToAcct');
    });
  });

  // 9 ------------------------------------------------------------------
  describe('self-transfer', () => {
    it('emits exactly one row for a transfer from A to A', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-self',
            feePayer: A,
            native: [nativeTransfer({ from: A, to: A, amount: 12_345 })],
          }),
        ],
        NO_MINTS,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe(A);
      expect(rows[0].to).toBe(A);
      expect(rows[0].amount).toBe('12345');
    });
  });

  // 10 -----------------------------------------------------------------
  describe('A on both sides of different transfers', () => {
    it('emits one row per qualifying transfer with distinct indices', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-both-sides',
            feePayer: A,
            native: [
              nativeTransfer({ from: A, to: 'Out', amount: 100 }),
              nativeTransfer({ from: 'In', to: A, amount: 200 }),
            ],
          }),
        ],
        NO_MINTS,
      );

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => [r.from, r.to, r.solana?.transferIndex])).toEqual([
        [A, 'Out', 0],
        ['In', A, 1],
      ]);
      expect(new Set(rows.map((r) => edgeIdentityKey(r, r.from, r.to))).size).toBe(2);
    });
  });

  // 11 -----------------------------------------------------------------
  describe('transfers not involving the subject', () => {
    it('skips transfers between two other parties', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-bystander',
            feePayer: 'Stranger1',
            native: [nativeTransfer({ from: 'Stranger1', to: 'Stranger2' })],
            tokens: [
              tokenTransfer({ from: 'Stranger1', to: 'Stranger2', mint: USDC }),
            ],
          }),
        ],
        mints(USDC_META),
      );

      expect(rows).toEqual([]);
    });

    it('keeps only the subject leg of a mixed transaction', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-mixed-parties',
            feePayer: 'Router',
            native: [
              nativeTransfer({ from: 'Stranger1', to: 'Stranger2', amount: 10 }),
              nativeTransfer({ from: 'Router', to: A, amount: 20 }),
              nativeTransfer({ from: 'Stranger3', to: 'Stranger4', amount: 30 }),
            ],
          }),
        ],
        NO_MINTS,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe('20');
      expect(rows[0].solana?.transferIndex).toBe(1);
    });

    it('returns an empty array for an empty tx list', () => {
      expect(mapSolanaHistory(A, [], NO_MINTS)).toEqual([]);
    });
  });

  // 12 -----------------------------------------------------------------
  describe('deduplication', () => {
    const fixture = tx({
      signature: 'sig-dupe',
      feePayer: A,
      native: [nativeTransfer({ from: A, to: 'Payee', amount: 100 })],
      tokens: [tokenTransfer({ from: A, to: 'Payee', amount: 1.5, mint: USDC })],
    });

    it('drops a repeated tx by edge identity key, keeping the first rows', () => {
      const once = mapSolanaHistory(A, [fixture], mints(USDC_META));
      const twice = mapSolanaHistory(A, [fixture, fixture], mints(USDC_META));

      expect(once).toHaveLength(2);
      expect(twice).toHaveLength(2);
      expect(twice.map((r) => [r.from, r.to, r.amount, r.solana?.transferIndex])).toEqual(
        once.map((r) => [r.from, r.to, r.amount, r.solana?.transferIndex]),
      );
      expect(
        new Set(twice.map((r) => edgeIdentityKey(r, r.from, r.to))).size,
      ).toBe(2);
    });

    it('does not collapse identical transfers at different indices', () => {
      const rows = mapSolanaHistory(
        A,
        [
          tx({
            signature: 'sig-identical-legs',
            feePayer: A,
            native: [
              nativeTransfer({ from: A, to: 'Payee', amount: 100 }),
              nativeTransfer({ from: A, to: 'Payee', amount: 100 }),
            ],
          }),
        ],
        NO_MINTS,
      );

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.solana?.transferIndex)).toEqual([0, 1]);
    });
  });
});
