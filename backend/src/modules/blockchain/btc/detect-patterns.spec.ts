import { EsploraTx, EsploraVin, EsploraVout } from '../esplora-client';
import { detectPatterns } from './detect-patterns';

function makeVin(overrides: Partial<EsploraVin> = {}): EsploraVin {
  return {
    txid: 'prev-txid',
    vout: 0,
    is_coinbase: false,
    prevout: {
      scriptpubkey_address: 'input-addr',
      scriptpubkey_type: 'p2pkh',
      value: 100_000,
    },
    ...overrides,
  };
}

function makeVout(overrides: Partial<EsploraVout> = {}): EsploraVout {
  return {
    scriptpubkey_address: 'output-addr',
    scriptpubkey_type: 'p2pkh',
    value: 50_000,
    ...overrides,
  };
}

function makeTx(vin: EsploraVin[], vout: EsploraVout[]): EsploraTx {
  return {
    txid: 'tx',
    fee: 1_000,
    vin,
    vout,
    status: { confirmed: true, block_height: 800_000, block_time: 1_700_000_000 },
  };
}

describe('detectPatterns', () => {
  it("returns ['coinbase'] only for a coinbase tx, even with other qualifying shapes", () => {
    const vin = [makeVin({ is_coinbase: true, prevout: null })];
    const vout = Array.from({ length: 6 }, (_, i) =>
      makeVout({ scriptpubkey_address: `out${i}`, value: 100_000 }),
    );
    expect(detectPatterns(makeTx(vin, vout))).toEqual(['coinbase']);
  });

  it("flags ['possible-coinjoin', 'multi-input'] for 6-in-6-out with 3 equal-value outputs (exact array + order)", () => {
    const vin = Array.from({ length: 6 }, (_, i) =>
      makeVin({
        prevout: { scriptpubkey_address: `in${i}`, scriptpubkey_type: 'v0_p2wpkh', value: 1_000_000 },
      }),
    );
    const vout = [
      makeVout({ scriptpubkey_address: 'out0', value: 100_000 }),
      makeVout({ scriptpubkey_address: 'out1', value: 100_000 }),
      makeVout({ scriptpubkey_address: 'out2', value: 100_000 }),
      makeVout({ scriptpubkey_address: 'out3', value: 200_000 }),
      makeVout({ scriptpubkey_address: 'out4', value: 300_000 }),
      makeVout({ scriptpubkey_address: 'out5', value: 400_000 }),
    ];
    expect(detectPatterns(makeTx(vin, vout))).toEqual([
      'possible-coinjoin',
      'multi-input',
    ]);
  });

  it("flags ['consolidation', 'multi-input'] for 12-in-1-out", () => {
    const vin = Array.from({ length: 12 }, (_, i) =>
      makeVin({
        prevout: { scriptpubkey_address: `in${i}`, scriptpubkey_type: 'p2pkh', value: 50_000 },
      }),
    );
    const vout = [makeVout({ scriptpubkey_address: 'consolidated', value: 590_000 })];
    expect(detectPatterns(makeTx(vin, vout))).toEqual(['consolidation', 'multi-input']);
  });

  it("flags only ['multi-input'] for an ordinary 2-in-2-out payment", () => {
    const vin = [
      makeVin({ prevout: { scriptpubkey_address: 'in0', scriptpubkey_type: 'v0_p2wpkh', value: 30_000_000 } }),
      makeVin({ prevout: { scriptpubkey_address: 'in1', scriptpubkey_type: 'v0_p2wpkh', value: 25_000_000 } }),
    ];
    const vout = [
      makeVout({ scriptpubkey_address: 'out0', scriptpubkey_type: 'p2sh', value: 50_000_000 }),
      makeVout({ scriptpubkey_address: 'out1', scriptpubkey_type: 'v0_p2wpkh', value: 4_983_120 }),
    ];
    expect(detectPatterns(makeTx(vin, vout))).toEqual(['multi-input']);
  });

  it('returns [] for a plain 1-in-1-out tx (no qualifying pattern)', () => {
    const vin = [makeVin()];
    const vout = [makeVout()];
    expect(detectPatterns(makeTx(vin, vout))).toEqual([]);
  });

  it('does not flag possible-coinjoin when fewer than 3 outputs share an exact value', () => {
    const vin = Array.from({ length: 6 }, (_, i) =>
      makeVin({
        prevout: { scriptpubkey_address: `in${i}`, scriptpubkey_type: 'v0_p2wpkh', value: 1_000_000 },
      }),
    );
    const vout = [
      makeVout({ scriptpubkey_address: 'out0', value: 100_000 }),
      makeVout({ scriptpubkey_address: 'out1', value: 100_000 }),
      makeVout({ scriptpubkey_address: 'out2', value: 200_000 }),
      makeVout({ scriptpubkey_address: 'out3', value: 300_000 }),
      makeVout({ scriptpubkey_address: 'out4', value: 400_000 }),
      makeVout({ scriptpubkey_address: 'out5', value: 500_000 }),
    ];
    expect(detectPatterns(makeTx(vin, vout))).toEqual(['multi-input']);
  });
});
