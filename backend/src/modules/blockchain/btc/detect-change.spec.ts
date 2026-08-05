import { EsploraTx, EsploraVin, EsploraVout } from '../esplora-client';
import { ChangeVerdict, detectChange } from './detect-change';
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

describe('detectChange', () => {
  it('classic 1-in-2-out: flags the output paying back to the input prevout address', () => {
    const vin = [
      makeVin({
        prevout: { scriptpubkey_address: 'addr-input', scriptpubkey_type: 'p2pkh', value: 100_000 },
      }),
    ];
    const vout = [
      makeVout({ scriptpubkey_address: 'addr-payee', value: 60_000 }),
      makeVout({ scriptpubkey_address: 'addr-input', value: 39_000 }),
    ];

    expect(detectChange(makeTx(vin, vout))).toEqual([
      { index: 0, change: false, evidence: [] },
      { index: 1, change: true, evidence: ['address-reuse'] },
    ]);
  });

  it('modern 2-in-2-out: flags the differently-typed, non-round output as change', () => {
    const vin = [
      makeVin({ prevout: { scriptpubkey_address: 'in0', scriptpubkey_type: 'v0_p2wpkh', value: 30_000_000 } }),
      makeVin({ prevout: { scriptpubkey_address: 'in1', scriptpubkey_type: 'v0_p2wpkh', value: 25_000_000 } }),
    ];
    const vout = [
      makeVout({ scriptpubkey_address: 'out0', scriptpubkey_type: 'p2sh', value: 50_000_000 }),
      makeVout({ scriptpubkey_address: 'out1', scriptpubkey_type: 'v0_p2wpkh', value: 4_983_120 }),
    ];

    expect(detectChange(makeTx(vin, vout))).toEqual([
      { index: 0, change: false, evidence: [] },
      { index: 1, change: true, evidence: ['script-type-match', 'non-round-value'] },
    ]);
  });

  it('negative: same shape but both outputs share the input script type -> no match (no differing type)', () => {
    const vin = [
      makeVin({ prevout: { scriptpubkey_address: 'in0', scriptpubkey_type: 'v0_p2wpkh', value: 30_000_000 } }),
      makeVin({ prevout: { scriptpubkey_address: 'in1', scriptpubkey_type: 'v0_p2wpkh', value: 25_000_000 } }),
    ];
    const vout = [
      makeVout({ scriptpubkey_address: 'out0', scriptpubkey_type: 'v0_p2wpkh', value: 50_000_000 }),
      makeVout({ scriptpubkey_address: 'out1', scriptpubkey_type: 'v0_p2wpkh', value: 4_983_120 }),
    ];

    expect(detectChange(makeTx(vin, vout))).toEqual([
      { index: 0, change: false, evidence: [] },
      { index: 1, change: false, evidence: [] },
    ]);
  });

  it('negative: same shape but both output values are non-round -> no match (no round comparator)', () => {
    const vin = [
      makeVin({ prevout: { scriptpubkey_address: 'in0', scriptpubkey_type: 'v0_p2wpkh', value: 30_000_000 } }),
      makeVin({ prevout: { scriptpubkey_address: 'in1', scriptpubkey_type: 'v0_p2wpkh', value: 25_000_000 } }),
    ];
    const vout = [
      makeVout({ scriptpubkey_address: 'out0', scriptpubkey_type: 'p2sh', value: 50_000_123 }),
      makeVout({ scriptpubkey_address: 'out1', scriptpubkey_type: 'v0_p2wpkh', value: 4_983_120 }),
    ];

    expect(detectChange(makeTx(vin, vout))).toEqual([
      { index: 0, change: false, evidence: [] },
      { index: 1, change: false, evidence: [] },
    ]);
  });

  it('Wasabi-style coinjoin (50-in/50-out, equal outputs, one output reuses an input address): guard suppresses all verdicts', () => {
    const vin = Array.from({ length: 50 }, (_, i) =>
      makeVin({
        prevout: { scriptpubkey_address: `in${i}`, scriptpubkey_type: 'v0_p2wpkh', value: 1_000_000 },
      }),
    );
    const vout = Array.from({ length: 50 }, (_, i) =>
      makeVout({ scriptpubkey_address: `out${i}`, scriptpubkey_type: 'v0_p2wpkh', value: 1_000_000 }),
    );
    // Output 0 reuses input 0's address -- would be a certain address-reuse
    // hit outside a CoinJoin, but the guard must suppress it here.
    vout[0] = { ...vout[0], scriptpubkey_address: 'in0' };
    const tx = makeTx(vin, vout);

    expect(detectPatterns(tx)).toContain('possible-coinjoin');

    const verdicts = detectChange(tx);
    expect(verdicts).toHaveLength(50);
    expect(
      verdicts.every(
        (v: ChangeVerdict) => v.change === false && v.evidence.length === 0,
      ),
    ).toBe(true);
  });

  it('12-in-1-out consolidation: single output with no other output to compare against -> all false', () => {
    const vin = Array.from({ length: 12 }, (_, i) =>
      makeVin({
        prevout: { scriptpubkey_address: `in${i}`, scriptpubkey_type: 'p2pkh', value: 50_000 },
      }),
    );
    const vout = [makeVout({ scriptpubkey_address: 'consolidated', scriptpubkey_type: 'p2pkh', value: 590_000 })];
    const tx = makeTx(vin, vout);

    expect(detectPatterns(tx)).toEqual(['consolidation', 'multi-input']);
    expect(detectChange(tx)).toEqual([{ index: 0, change: false, evidence: [] }]);
  });

  it('coinbase tx: no input prevouts to compare against -> all false', () => {
    const tx = makeTx(
      [makeVin({ is_coinbase: true, prevout: null })],
      [makeVout({ scriptpubkey_address: 'miner', scriptpubkey_type: 'v0_p2wpkh', value: 625_000_000 })],
    );

    expect(detectPatterns(tx)).toEqual(['coinbase']);
    expect(detectChange(tx)).toEqual([{ index: 0, change: false, evidence: [] }]);
  });

  it('OP_RETURN output among 1-in-3-out: op_return verdict stays false even though the script-type heuristic fires for another output', () => {
    const vin = [
      makeVin({ prevout: { scriptpubkey_address: 'addr-in', scriptpubkey_type: 'v0_p2wpkh', value: 10_000_000 } }),
    ];
    const vout: EsploraVout[] = [
      makeVout({ scriptpubkey_address: 'addr-out0', scriptpubkey_type: 'p2sh', value: 6_000_000 }),
      { scriptpubkey_type: 'op_return', value: 0 },
      makeVout({ scriptpubkey_address: 'addr-out2', scriptpubkey_type: 'v0_p2wpkh', value: 3_983_120 }),
    ];

    expect(detectChange(makeTx(vin, vout))).toEqual([
      { index: 0, change: false, evidence: [] },
      { index: 1, change: false, evidence: [] },
      { index: 2, change: true, evidence: ['script-type-match', 'non-round-value'] },
    ]);
  });
});
