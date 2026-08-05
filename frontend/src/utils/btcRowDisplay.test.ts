import { classifyBtcRow } from './btcRowDisplay';
import { TransactionEdge, UtxoContext } from '@/types/investigation';

const BTC_TOKEN = { address: '', symbol: 'BTC', decimals: 8 };
const EVM_TOKEN = { address: '0xabc', symbol: 'USDC', decimals: 6 };

function makeUtxo(overrides: Partial<UtxoContext> = {}): UtxoContext {
  return {
    inputs: [{ address: 'bc1qsender', value: '100000', prevTxid: 'prevtx', prevVout: 0 }],
    outputs: [
      { address: 'bc1qrecipient', value: '50000', index: 0 },
      { address: 'bc1qchange', value: '48000', index: 1, change: true, changeEvidence: ['address-reuse'] },
    ],
    fee: '2000',
    ...overrides,
  };
}

function makeTx(overrides: Partial<TransactionEdge> = {}): TransactionEdge {
  return {
    id: 'tx-1',
    from: 'bc1qsender',
    to: 'bc1qrecipient',
    txHash: 'txhash1',
    chain: 'bitcoin',
    timestamp: '2024-01-01T00:00:00.000Z',
    amount: '50000',
    token: BTC_TOKEN,
    notes: '',
    tags: [],
    blockNumber: 820000,
    crossTrace: false,
    utxo: makeUtxo({ vout: 0 }),
    ...overrides,
  };
}

describe('classifyBtcRow', () => {
  it('returns null for non-BTC (EVM) rows without a utxo field', () => {
    const tx = makeTx({ utxo: undefined, token: EVM_TOKEN });
    expect(classifyBtcRow(tx, '0xFetchedAddress')).toBeNull();
  });

  it('classifies direction "out" when from === fetchedAddress and to !== fetchedAddress', () => {
    const tx = makeTx({ from: 'bc1qsender', to: 'bc1qrecipient' });
    const result = classifyBtcRow(tx, 'bc1qsender');
    expect(result?.direction).toBe('out');
  });

  it('classifies direction "in" when to === fetchedAddress and from !== fetchedAddress', () => {
    const tx = makeTx({ from: 'bc1qsender', to: 'bc1qrecipient' });
    const result = classifyBtcRow(tx, 'bc1qrecipient');
    expect(result?.direction).toBe('in');
  });

  it('classifies direction "self" when from and to both equal fetchedAddress', () => {
    const tx = makeTx({ from: 'bc1qsame', to: 'bc1qsame' });
    const result = classifyBtcRow(tx, 'bc1qsame');
    expect(result?.direction).toBe('self');
  });

  it('falls back to "in" when neither from nor to matches the fetched address (e.g. no address context)', () => {
    const tx = makeTx({ from: 'bc1qsender', to: 'bc1qrecipient' });
    const result = classifyBtcRow(tx, '');
    expect(result?.direction).toBe('in');
  });

  it('is case-sensitive when comparing addresses (Bitcoin addresses are case-sensitive)', () => {
    const tx = makeTx({ from: 'bc1qSender', to: 'bc1qrecipient' });
    const result = classifyBtcRow(tx, 'bc1qsender');
    // 'bc1qSender' !== 'bc1qsender' -> not treated as the outgoing endpoint
    expect(result?.direction).not.toBe('out');
  });

  it('flags change when the row\'s own vout output has change: true', () => {
    const tx = makeTx({ utxo: makeUtxo({ vout: 1 }) });
    const result = classifyBtcRow(tx, 'bc1qsender');
    expect(result?.isChange).toBe(true);
    expect(result?.changeEvidence).toEqual(['address-reuse']);
  });

  it('does not flag change when the row\'s own vout output has change: false/undefined', () => {
    const tx = makeTx({ utxo: makeUtxo({ vout: 0 }) });
    const result = classifyBtcRow(tx, 'bc1qsender');
    expect(result?.isChange).toBe(false);
    expect(result?.changeEvidence).toEqual([]);
  });

  it('returns isChange false and empty evidence when vout is undefined', () => {
    const tx = makeTx({ utxo: makeUtxo({ vout: undefined }) });
    const result = classifyBtcRow(tx, 'bc1qsender');
    expect(result?.isChange).toBe(false);
    expect(result?.changeEvidence).toEqual([]);
  });

  it('resolves the own output by its index field, not array position, when they differ', () => {
    const utxo = makeUtxo({
      vout: 1,
      outputs: [
        { address: 'bc1qchange', value: '48000', index: 1, change: true, changeEvidence: ['non-round-value'] },
        { address: 'bc1qrecipient', value: '50000', index: 0 },
      ],
    });
    const tx = makeTx({ utxo });
    const result = classifyBtcRow(tx, 'bc1qsender');
    expect(result?.isChange).toBe(true);
    expect(result?.changeEvidence).toEqual(['non-round-value']);
  });

  it('reports isJunction true when utxo.junction is true', () => {
    const tx = makeTx({ utxo: makeUtxo({ vout: 0, junction: true }) });
    const result = classifyBtcRow(tx, 'bc1qsender');
    expect(result?.isJunction).toBe(true);
  });

  it('reports isJunction false when utxo.junction is absent', () => {
    const tx = makeTx({ utxo: makeUtxo({ vout: 0 }) });
    const result = classifyBtcRow(tx, 'bc1qsender');
    expect(result?.isJunction).toBe(false);
  });

  it('counts inputs and outputs from the utxo record', () => {
    const utxo = makeUtxo({
      vout: 0,
      inputs: [
        { address: 'bc1qa', value: '1000', prevTxid: 't1', prevVout: 0 },
        { address: 'bc1qb', value: '2000', prevTxid: 't2', prevVout: 1 },
      ],
      outputs: [
        { address: 'bc1qc', value: '1500', index: 0 },
        { address: 'bc1qd', value: '1400', index: 1 },
        { address: 'bc1qe', value: '50', index: 2, change: true },
      ],
    });
    const tx = makeTx({ utxo });
    const result = classifyBtcRow(tx, 'bc1qsender');
    expect(result?.inCount).toBe(2);
    expect(result?.outCount).toBe(3);
  });

  it('handles missing inputs array defensively (defaults inCount to 0)', () => {
    const utxo = makeUtxo({ vout: 0, inputs: undefined as any });
    const tx = makeTx({ utxo });
    const result = classifyBtcRow(tx, 'bc1qsender');
    expect(result?.inCount).toBe(0);
  });
});
