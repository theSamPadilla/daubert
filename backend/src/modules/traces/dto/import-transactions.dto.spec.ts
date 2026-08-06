/**
 * ImportTransactionsDto — the `utxo` / `solana` whitelist-survival canary.
 *
 * The global pipe in `main.ts` is
 *   `new ValidationPipe({ whitelist: true, transform: true,
 *                         transformOptions: { enableImplicitConversion: true } })`
 * and `whitelist: true` DELETES every property that no class-validator
 * decorator declares — silently, with no error. A Bitcoin import whose
 * `utxo` provenance is not declared on the DTO therefore reaches
 * TracesService stripped of its inputs/outputs/fee, and the graph loses the
 * evidence without anyone noticing. A Solana import whose `solana` context is
 * not declared loses its transferIndex, and every transfer of a multi-leg
 * signature then collapses onto one edge identity.
 *
 * These tests instantiate a REAL ValidationPipe with main.ts's exact config
 * and assert the payload that comes out the other side still carries the
 * complete provenance block.
 */

import 'reflect-metadata';
import { ValidationPipe, BadRequestException, ArgumentMetadata } from '@nestjs/common';

import { ImportTransactionsDto } from './import-transactions.dto';

// Mirrors backend/src/main.ts:66-70 exactly.
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const META: ArgumentMetadata = {
  type: 'body',
  metatype: ImportTransactionsDto,
  data: '',
};

// A realistic BTC payment row: two inputs (one with a non-decodable address),
// three outputs (one change, one OP_RETURN with a null address), warnings,
// and the trailing per-row slice fields.
const FULL_UTXO = {
  inputs: [
    {
      address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      value: '250000',
      prevTxid: 'a'.repeat(64),
      prevVout: 0,
      scriptType: 'v0_p2wpkh',
    },
    {
      address: null,
      value: '100000',
      prevTxid: 'b'.repeat(64),
      prevVout: 3,
      scriptType: 'bare_multisig',
      coinbase: false,
    },
  ],
  outputs: [
    {
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      value: '300000',
      index: 0,
      scriptType: 'p2pkh',
    },
    {
      address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      value: '48000',
      index: 1,
      scriptType: 'v0_p2wpkh',
      change: true,
      changeEvidence: ['self-send back to an input address', 'matching script type'],
    },
    {
      address: null,
      value: '0',
      index: 2,
      scriptType: 'op_return',
      opReturn: true,
    },
  ],
  fee: '2000',
  warnings: ['coinjoin-like structure'],
  confirmed: true,
  blockHeight: 830000,
  vout: 0,
  legType: 'output',
  legIndex: 0,
  junction: false,
};

const btcItem = (utxo: unknown) => ({
  from: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  to: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  txHash: 'c'.repeat(64),
  chain: 'bitcoin',
  timestamp: '2026-01-01T00:00:00Z',
  amount: '300000',
  token: 'BTC',
  utxo,
});

// An SPL transfer row with EVERY SolanaContext field populated — the point of
// the canary is that no single field can go missing unnoticed.
const FULL_SOLANA = {
  transferIndex: 2,
  feePayer: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  kind: 'spl',
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
  fromTokenAccount: 'H7bTHGb5Cvo5fGe5jBDNDPUwBHcQ3sBrCXbBrjSyPk5S',
  toTokenAccount: '3emsAVdmGKERbHjmGfQ6oZ1e35dkf5iYcS6U4CPKFVaa',
  type: 'TRANSFER',
  source: 'JUPITER',
  slot: 250_000_000,
  spam: true,
  spamEvidence: ['unsolicited', 'unknown-mint'],
};

const solItem = (solana: unknown) => ({
  from: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  to: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  txHash: '5'.repeat(87),
  chain: 'solana',
  timestamp: '2026-01-01T00:00:00Z',
  amount: '125.5',
  token: 'USDC',
  solana,
});

describe('ImportTransactionsDto through ValidationPipe({ whitelist, transform })', () => {
  it('THE CANARY: a full utxo payload survives whitelisting intact', async () => {
    const payload = { transactions: [btcItem(FULL_UTXO)] };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);

    const item = result.transactions[0];
    expect(item.utxo).toBeDefined();
    // Deep-equal against the original: nothing added, nothing dropped.
    expect(JSON.parse(JSON.stringify(item.utxo))).toEqual(FULL_UTXO);
  });

  it('keeps null input/output addresses (bare scripts, OP_RETURN) as null', async () => {
    const payload = { transactions: [btcItem(FULL_UTXO)] };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);
    const utxo = result.transactions[0].utxo!;

    expect(utxo.inputs[1].address).toBeNull();
    expect(utxo.outputs[2].address).toBeNull();
    expect(utxo.outputs[2].opReturn).toBe(true);
  });

  it('keeps change flags and their evidence strings', async () => {
    const payload = { transactions: [btcItem(FULL_UTXO)] };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);
    const change = result.transactions[0].utxo!.outputs[1];

    expect(change.change).toBe(true);
    expect(change.changeEvidence).toEqual([
      'self-send back to an input address',
      'matching script type',
    ]);
  });

  it('keeps the per-row slice fields (vout, legType, legIndex, junction) and warnings', async () => {
    const payload = {
      transactions: [
        btcItem({ ...FULL_UTXO, junction: true, legType: 'input', legIndex: 1, vout: 2 }),
      ],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);
    const utxo = result.transactions[0].utxo!;

    expect(utxo.junction).toBe(true);
    expect(utxo.legType).toBe('input');
    expect(utxo.legIndex).toBe(1);
    expect(utxo.vout).toBe(2);
    expect(utxo.fee).toBe('2000');
    expect(utxo.warnings).toEqual(['coinjoin-like structure']);
    expect(utxo.confirmed).toBe(true);
    expect(utxo.blockHeight).toBe(830000);
  });

  it('accepts blockHeight: null (unconfirmed / mempool rows)', async () => {
    const payload = {
      transactions: [btcItem({ ...FULL_UTXO, confirmed: false, blockHeight: null })],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);

    expect(result.transactions[0].utxo!.blockHeight).toBeNull();
    expect(result.transactions[0].utxo!.confirmed).toBe(false);
  });

  it('strips (does not reject) an undeclared junk key inside utxo', async () => {
    const payload = {
      transactions: [btcItem({ ...FULL_UTXO, rawHex: '0200000001...', secret: 'nope' })],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);
    const utxo = result.transactions[0].utxo!;

    expect(utxo).not.toHaveProperty('rawHex');
    expect(utxo).not.toHaveProperty('secret');
    // The declared payload is otherwise untouched.
    expect(JSON.parse(JSON.stringify(utxo))).toEqual(FULL_UTXO);
  });

  it('strips an undeclared junk key nested inside an output', async () => {
    const outputs = FULL_UTXO.outputs.map((o, i) =>
      i === 0 ? { ...o, spentBy: 'deadbeef' } : o,
    );
    const payload = { transactions: [btcItem({ ...FULL_UTXO, outputs })] };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);

    expect(result.transactions[0].utxo!.outputs[0]).not.toHaveProperty('spentBy');
  });

  it('rejects a structurally invalid utxo (inputs not an array)', async () => {
    const payload = {
      transactions: [btcItem({ ...FULL_UTXO, inputs: 'not-an-array' })],
    };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an input whose prevVout is not numeric', async () => {
    const inputs = [{ ...FULL_UTXO.inputs[0], prevVout: 'first' }, FULL_UTXO.inputs[1]];
    const payload = { transactions: [btcItem({ ...FULL_UTXO, inputs })] };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('coerces a numeric satoshi value to a string (global enableImplicitConversion)', async () => {
    // Pinning pre-existing global behavior: main.ts enables implicit
    // conversion, so a JSON number in a `string`-typed satoshi field is
    // stringified rather than rejected — exactly what already happens to
    // `amount` on EVM imports. Downstream code can rely on `value` being a
    // string regardless of what the client sent.
    const inputs = [{ ...FULL_UTXO.inputs[0], value: 250000 }, FULL_UTXO.inputs[1]];
    const payload = { transactions: [btcItem({ ...FULL_UTXO, inputs })] };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);

    expect(result.transactions[0].utxo!.inputs[0].value).toBe('250000');
  });

  it('rejects a utxo missing its fee', async () => {
    const { fee: _fee, ...noFee } = FULL_UTXO;
    const payload = { transactions: [btcItem(noFee)] };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an out-of-range legType', async () => {
    const payload = { transactions: [btcItem({ ...FULL_UTXO, legType: 'sideways' })] };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an absurd input count (ArrayMaxSize guard)', async () => {
    const inputs = Array.from({ length: 501 }, (_v, i) => ({
      address: null,
      value: '1000',
      prevTxid: 'd'.repeat(64),
      prevVout: i,
    }));
    const payload = { transactions: [btcItem({ ...FULL_UTXO, inputs })] };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('EVM regression: an item with no utxo still validates and gains no utxo field', async () => {
    const payload = {
      transactions: [
        {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          txHash: '0xabc',
          chain: 'ethereum',
          timestamp: '2026-01-01T00:00:00Z',
          amount: '1.5',
          token: 'USDT',
          blockNumber: 19000000,
          fromLabel: 'Alpha',
          toLabel: 'Beta',
        },
      ],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);
    const item = result.transactions[0];

    expect(item.utxo).toBeUndefined();
    expect(item.from).toBe('0x1234567890123456789012345678901234567890');
    expect(item.blockNumber).toBe(19000000);
    expect(item.fromLabel).toBe('Alpha');
    expect(item.toLabel).toBe('Beta');
  });

  it('still strips undeclared top-level keys on the item (existing whitelist behavior)', async () => {
    const payload = {
      transactions: [{ ...btcItem(FULL_UTXO), sneaky: 'value' }],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);

    expect(result.transactions[0]).not.toHaveProperty('sneaky');
    expect(result.transactions[0].utxo).toBeDefined();
  });

  it('rejects an absurd top-level transactions count (ArrayMaxSize guard)', async () => {
    const transactions = Array.from({ length: 5001 }, (_v, i) => ({
      from: '0x1234567890123456789012345678901234567890',
      to: '0x0987654321098765432109876543210987654321',
      txHash: `0x${i}`,
      chain: 'ethereum',
      timestamp: '2026-01-01T00:00:00Z',
      amount: '1.5',
      token: 'ETH',
    }));
    const payload = { transactions };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('imports a mixed EVM + BTC batch in one payload', async () => {
    const payload = {
      transactions: [
        {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          txHash: '0xabc',
          chain: 'ethereum',
          timestamp: '2026-01-01T00:00:00Z',
          amount: '1.5',
          token: 'ETH',
        },
        btcItem(FULL_UTXO),
      ],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].utxo).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result.transactions[1].utxo))).toEqual(FULL_UTXO);
  });

  // -------------------------------------------------------------------------
  // Solana per-transfer context. Same failure mode as `utxo`, different loss:
  // without a declared `solana`, whitelisting deletes `transferIndex`, and
  // every transfer of a multi-leg signature collapses onto a single edge
  // identity — the graph silently loses legs rather than fields.
  // -------------------------------------------------------------------------

  it('THE CANARY: a full solana payload survives whitelisting intact', async () => {
    const payload = { transactions: [solItem(FULL_SOLANA)] };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);

    const item = result.transactions[0];
    expect(item.solana).toBeDefined();
    // Deep-equal against the original: nothing added, nothing dropped.
    expect(JSON.parse(JSON.stringify(item.solana))).toEqual(FULL_SOLANA);
  });

  it('keeps every solana field individually (field-by-field readout)', async () => {
    const payload = { transactions: [solItem(FULL_SOLANA)] };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);
    const sol = result.transactions[0].solana!;

    expect(sol.transferIndex).toBe(2);
    expect(sol.feePayer).toBe('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
    expect(sol.kind).toBe('spl');
    expect(sol.mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(sol.decimals).toBe(6);
    expect(sol.fromTokenAccount).toBe('H7bTHGb5Cvo5fGe5jBDNDPUwBHcQ3sBrCXbBrjSyPk5S');
    expect(sol.toTokenAccount).toBe('3emsAVdmGKERbHjmGfQ6oZ1e35dkf5iYcS6U4CPKFVaa');
    expect(sol.type).toBe('TRANSFER');
    expect(sol.source).toBe('JUPITER');
    expect(sol.slot).toBe(250_000_000);
    expect(sol.spam).toBe(true);
    expect(sol.spamEvidence).toEqual(['unsolicited', 'unknown-mint']);
  });

  it('accepts a native SOL row carrying only the required fields', async () => {
    const payload = {
      transactions: [
        solItem({
          transferIndex: 0,
          feePayer: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
          kind: 'native',
        }),
      ],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);
    const sol = result.transactions[0].solana!;

    expect(sol.kind).toBe('native');
    expect(sol.transferIndex).toBe(0);
    expect(sol.mint).toBeUndefined();
    expect(sol.spamEvidence).toBeUndefined();
  });

  it('strips (does not reject) an undeclared junk key inside solana', async () => {
    const payload = {
      transactions: [
        solItem({ ...FULL_SOLANA, rawHex: '0x00', instructions: ['nope'] }),
      ],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);
    const sol = result.transactions[0].solana!;

    expect(sol).not.toHaveProperty('rawHex');
    expect(sol).not.toHaveProperty('instructions');
    // The declared payload is otherwise untouched.
    expect(JSON.parse(JSON.stringify(sol))).toEqual(FULL_SOLANA);
  });

  it('rejects an out-of-range kind', async () => {
    const payload = { transactions: [solItem({ ...FULL_SOLANA, kind: 'nft' })] };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a solana context missing transferIndex', async () => {
    const { transferIndex: _i, ...noIndex } = FULL_SOLANA;
    const payload = { transactions: [solItem(noIndex)] };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a solana context missing feePayer', async () => {
    const { feePayer: _f, ...noPayer } = FULL_SOLANA;
    const payload = { transactions: [solItem(noPayer)] };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a solana context missing kind', async () => {
    const { kind: _k, ...noKind } = FULL_SOLANA;
    const payload = { transactions: [solItem(noKind)] };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a non-numeric transferIndex', async () => {
    const payload = {
      transactions: [solItem({ ...FULL_SOLANA, transferIndex: 'first' })],
    };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an oversized spamEvidence array (ArrayMaxSize guard)', async () => {
    const spamEvidence = Array.from({ length: 11 }, (_v, i) => `reason-${i}`);
    const payload = { transactions: [solItem({ ...FULL_SOLANA, spamEvidence })] };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects non-string entries inside spamEvidence', async () => {
    const payload = {
      transactions: [solItem({ ...FULL_SOLANA, spamEvidence: [{ why: 'spam' }] })],
    };

    await expect(pipe.transform(payload, META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('EVM regression: an item with no solana still validates and gains no solana field', async () => {
    const payload = {
      transactions: [
        {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          txHash: '0xabc',
          chain: 'ethereum',
          timestamp: '2026-01-01T00:00:00Z',
          amount: '1.5',
          token: 'USDT',
        },
      ],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);

    expect(result.transactions[0].solana).toBeUndefined();
    expect(result.transactions[0].utxo).toBeUndefined();
  });

  it('imports a mixed EVM + BTC + SOL batch, each keeping its own context', async () => {
    const payload = {
      transactions: [
        {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          txHash: '0xabc',
          chain: 'ethereum',
          timestamp: '2026-01-01T00:00:00Z',
          amount: '1.5',
          token: 'ETH',
        },
        btcItem(FULL_UTXO),
        solItem(FULL_SOLANA),
      ],
    };

    const result: ImportTransactionsDto = await pipe.transform(payload, META);

    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0].utxo).toBeUndefined();
    expect(result.transactions[0].solana).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result.transactions[1].utxo))).toEqual(FULL_UTXO);
    expect(result.transactions[1].solana).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result.transactions[2].solana))).toEqual(
      FULL_SOLANA,
    );
    expect(result.transactions[2].utxo).toBeUndefined();
  });
});
