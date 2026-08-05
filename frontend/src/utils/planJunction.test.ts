import { planJunction, UtxoContextLike } from '../generated/shared/utxo';

/** Recursively freeze so any mutation attempt throws under ES-module strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0';

describe('planJunction', () => {
  it('skips coinbase inputs and OP_RETURN outputs while preserving original indices', () => {
    const utxo: UtxoContextLike = {
      inputs: [
        // index 0 — coinbase: no sender exists, no leg.
        { address: null, value: '625000000', coinbase: true },
        // index 1 — real spender.
        { address: 'bc1qspender1', value: '100000' },
        // index 2 — undecodable script: no attribution.
        { address: null, value: '5000' },
        // index 3 — real spender; its legIndex must stay 3, not 1.
        { address: '1SpenderTwoAddressXXXXXXXXXX', value: '250000' },
      ],
      outputs: [
        // vout 0 — data carrier, no recipient.
        { address: null, value: '0', index: 0, opReturn: true },
        { address: 'bc1qrecipient', value: '300000', index: 1 },
        { address: null, value: '1000', index: 2 },
        { address: 'bc1qchange', value: '60000', index: 3, change: true },
      ],
      fee: '14000',
    };

    const plan = planJunction(TXID, utxo);

    expect(plan.inputLegs).toEqual([
      { fromAddress: 'bc1qspender1', amountSats: '100000', legIndex: 1 },
      { fromAddress: '1SpenderTwoAddressXXXXXXXXXX', amountSats: '250000', legIndex: 3 },
    ]);
    expect(plan.outputLegs).toEqual([
      { toAddress: 'bc1qrecipient', amountSats: '300000', vout: 1 },
      { toAddress: 'bc1qchange', amountSats: '60000', vout: 3, change: true },
    ]);
  });

  it('labels the node with the RAW in/out counts, including skipped slots', () => {
    const plan = planJunction(TXID, {
      inputs: [
        { address: null, value: '0', coinbase: true },
        { address: 'bc1qa', value: '1' },
      ],
      outputs: [
        { address: null, value: '0', index: 0, opReturn: true },
        { address: 'bc1qb', value: '1', index: 1 },
        { address: 'bc1qc', value: '1', index: 2 },
      ],
      fee: '0',
    });

    // 2 legs total, but the label reports the transaction as it exists on-chain.
    expect(plan.node.label).toBe('2 in / 3 out');
    expect(plan.inputLegs).toHaveLength(1);
    expect(plan.outputLegs).toHaveLength(2);
  });

  it('uses the txid as the junction node address and tags it txJunction', () => {
    const plan = planJunction(TXID, { inputs: [], outputs: [], fee: '0' });
    expect(plan.node).toEqual({
      address: TXID,
      label: '0 in / 0 out',
      kind: 'txJunction',
    });
  });

  it('carries the change verdict through, and omits it when the source did not assess', () => {
    const plan = planJunction(TXID, {
      inputs: [],
      outputs: [
        { address: 'bc1qpay', value: '10', index: 0 },
        { address: 'bc1qchange', value: '20', index: 1, change: true },
        { address: 'bc1qnotchange', value: '30', index: 2, change: false },
      ],
      fee: '0',
    });

    expect(plan.outputLegs[0]).not.toHaveProperty('change');
    expect(plan.outputLegs[1].change).toBe(true);
    expect(plan.outputLegs[2].change).toBe(false);
  });

  it('falls back to the array position when an output omits its index', () => {
    const plan = planJunction(TXID, {
      inputs: [],
      outputs: [
        { address: 'bc1qa', value: '1' },
        { address: 'bc1qb', value: '2' },
      ],
      fee: '0',
    });
    expect(plan.outputLegs.map((l) => l.vout)).toEqual([0, 1]);
  });

  it('does not mutate the context it is handed', () => {
    // A fetched row's inputs/outputs arrays are shared by reference across every
    // sibling row of the same transaction — mutating here corrupts all of them.
    const utxo: UtxoContextLike = deepFreeze({
      inputs: [
        { address: null, value: '0', coinbase: true },
        { address: 'bc1qa', value: '100' },
      ],
      outputs: [
        { address: 'bc1qb', value: '90', index: 0 },
        { address: null, value: '0', index: 1, opReturn: true },
      ],
      fee: '10',
      warnings: ['coinbase'],
    });
    const before = JSON.parse(JSON.stringify(utxo));

    expect(() => planJunction(TXID, utxo)).not.toThrow();

    expect(utxo).toEqual(before);
    expect(utxo.inputs).toHaveLength(2);
    expect(utxo.outputs).toHaveLength(2);
  });
});
