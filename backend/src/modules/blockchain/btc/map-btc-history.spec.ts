import { edgeIdentityKey } from '../../../generated/shared/edge-identity';
import { EsploraTx, EsploraVin, EsploraVout } from '../esplora-client';
import { mapBtcHistory } from './map-btc-history';

const A = 'bc1qsubjectaddress0000000000000000000000';

function vin(
  opts: {
    address?: string | null;
    value?: number;
    txid?: string;
    vout?: number;
    scriptType?: string;
    coinbase?: boolean;
  } = {},
): EsploraVin {
  const {
    address = 'bc1qcounterparty-in',
    value = 100_000,
    txid = 'prev-txid',
    vout = 0,
    scriptType = 'v0_p2wpkh',
    coinbase = false,
  } = opts;
  return {
    txid,
    vout,
    is_coinbase: coinbase,
    prevout:
      address === null
        ? null
        : {
            scriptpubkey_address: address,
            scriptpubkey_type: scriptType,
            value,
          },
  };
}

function vout(
  opts: {
    address?: string | null;
    value?: number;
    scriptType?: string;
  } = {},
): EsploraVout {
  const {
    address = 'bc1qcounterparty-out',
    value = 50_000,
    scriptType = 'v0_p2wpkh',
  } = opts;
  const out: EsploraVout = { scriptpubkey_type: scriptType, value };
  if (address !== null) out.scriptpubkey_address = address;
  return out;
}

function opReturnVout(value = 0): EsploraVout {
  return { scriptpubkey_type: 'op_return', value };
}

function tx(opts: {
  txid?: string;
  fee?: number;
  vin: EsploraVin[];
  vout: EsploraVout[];
  confirmed?: boolean;
  blockHeight?: number;
  blockTime?: number;
}): EsploraTx {
  const {
    txid = 'tx-abc',
    fee = 1_000,
    confirmed = true,
    blockHeight = 800_000,
    blockTime = 1_700_000_000,
  } = opts;
  return {
    txid,
    fee,
    vin: opts.vin,
    vout: opts.vout,
    status: confirmed
      ? { confirmed: true, block_height: blockHeight, block_time: blockTime }
      : { confirmed: false },
  };
}

describe('mapBtcHistory', () => {
  describe('constant row fields', () => {
    it('stamps every row with bitcoin/BTC/8-decimal metadata and empty annotations', () => {
      const rows = mapBtcHistory(A, [
        tx({ vin: [vin({ address: A })], vout: [vout({ address: 'payee' })] }),
      ]);

      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.chain).toBe('bitcoin');
      expect(row.token).toEqual({ address: '', symbol: 'BTC', decimals: 8 });
      expect(row.txHash).toBe('tx-abc');
      expect(row.blockNumber).toBe(800_000);
      expect(row.timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString());
      expect(row.notes).toBe('');
      expect(row.tags).toEqual([]);
      expect(row.crossTrace).toBe(false);
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('gives every row a distinct id', () => {
      const rows = mapBtcHistory(A, [
        tx({
          vin: [vin({ address: A })],
          vout: [vout({ address: 'p1' }), vout({ address: 'p2' })],
        }),
      ]);
      expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    });
  });

  // 1 ------------------------------------------------------------------
  describe('outgoing 1-in-2-out (payment + change via address reuse)', () => {
    const fixture = tx({
      txid: 'tx-out-1',
      fee: 1_000,
      vin: [vin({ address: A, value: 100_000, txid: 'funding-tx', vout: 3 })],
      vout: [
        vout({ address: 'bc1qpayee', value: 60_000 }),
        vout({ address: A, value: 39_000 }),
      ],
    });

    it('emits a payment row and a change row, both from A, neither a junction', () => {
      const rows = mapBtcHistory(A, [fixture]);

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => [r.from, r.to, r.amount, r.utxo?.vout])).toEqual([
        [A, 'bc1qpayee', '60000', 0],
        [A, A, '39000', 1],
      ]);
      expect(rows.every((r) => r.utxo?.junction === false)).toBe(true);
    });

    it('marks the reused-address output as change with its evidence', () => {
      const [row] = mapBtcHistory(A, [fixture]);

      expect(row.utxo?.outputs[0]).toMatchObject({
        change: false,
        changeEvidence: [],
      });
      expect(row.utxo?.outputs[1]).toMatchObject({
        change: true,
        changeEvidence: ['address-reuse'],
      });
    });

    it('carries the exact full utxo context payload on every row', () => {
      const rows = mapBtcHistory(A, [fixture]);

      for (const [i, row] of rows.entries()) {
        expect(row.utxo).toEqual({
          inputs: [
            {
              address: A,
              value: '100000',
              prevTxid: 'funding-tx',
              prevVout: 3,
              scriptType: 'v0_p2wpkh',
              coinbase: false,
            },
          ],
          outputs: [
            {
              address: 'bc1qpayee',
              value: '60000',
              index: 0,
              scriptType: 'v0_p2wpkh',
              change: false,
              changeEvidence: [],
              opReturn: false,
            },
            {
              address: A,
              value: '39000',
              index: 1,
              scriptType: 'v0_p2wpkh',
              change: true,
              changeEvidence: ['address-reuse'],
              opReturn: false,
            },
          ],
          fee: '1000',
          warnings: [],
          confirmed: true,
          blockHeight: 800_000,
          vout: i,
          junction: false,
        });
      }
    });
  });

  // 2 ------------------------------------------------------------------
  describe('incoming single-input', () => {
    it('attributes the single known input address as the sender', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-in-1',
          vin: [vin({ address: 'bc1qsender', value: 100_000 })],
          vout: [
            vout({ address: A, value: 60_000 }),
            vout({ address: 'bc1qsender', value: 39_000 }),
          ],
        }),
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe('bc1qsender');
      expect(rows[0].to).toBe(A);
      expect(rows[0].amount).toBe('60000');
      expect(rows[0].utxo?.vout).toBe(0);
      expect(rows[0].utxo?.junction).toBe(false);
    });
  });

  // 3 ------------------------------------------------------------------
  describe('incoming multi-input', () => {
    const fixture = tx({
      txid: 'tx-in-3',
      vin: [
        vin({ address: 'bc1qin0', value: 40_000, txid: 'p0' }),
        vin({ address: 'bc1qin1', value: 40_000, txid: 'p1' }),
        vin({ address: 'bc1qin2', value: 40_000, txid: 'p2' }),
      ],
      vout: [
        vout({ address: A, value: 90_000 }),
        vout({ address: 'bc1qother', value: 29_000 }),
      ],
    });

    it('emits a junction row with no sender rather than picking one input', () => {
      const rows = mapBtcHistory(A, [fixture]);

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe('');
      expect(rows[0].to).toBe(A);
      expect(rows[0].amount).toBe('90000');
      expect(rows[0].utxo?.vout).toBe(0);
      expect(rows[0].utxo?.junction).toBe(true);
    });

    it('never synthesizes a sender from any of the input addresses', () => {
      const rows = mapBtcHistory(A, [fixture]);
      for (const row of rows) {
        expect(['bc1qin0', 'bc1qin1', 'bc1qin2']).not.toContain(row.from);
      }
    });

    it('still preserves every input in the utxo context for the record', () => {
      const [row] = mapBtcHistory(A, [fixture]);
      expect(row.utxo?.inputs.map((i) => i.address)).toEqual([
        'bc1qin0',
        'bc1qin1',
        'bc1qin2',
      ]);
      expect(row.utxo?.warnings).toEqual(['multi-input']);
    });
  });

  // 4 ------------------------------------------------------------------
  describe('self-send', () => {
    it('uses outgoing treatment and emits a single A -> A row', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-self',
          vin: [vin({ address: A, value: 100_000 })],
          vout: [vout({ address: A, value: 95_000 })],
        }),
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe(A);
      expect(rows[0].to).toBe(A);
      expect(rows[0].amount).toBe('95000');
      expect(rows[0].utxo?.vout).toBe(0);
      expect(rows[0].utxo?.junction).toBe(false);
      expect(rows[0].utxo?.outputs[0].change).toBe(true);
    });
  });

  // 5 ------------------------------------------------------------------
  describe('coinjoin', () => {
    const fixture = tx({
      txid: 'tx-cj',
      vin: [
        vin({ address: A, value: 1_100_000, txid: 'cj-p0' }),
        vin({ address: 'bc1qcj1', value: 1_100_000, txid: 'cj-p1' }),
        vin({ address: 'bc1qcj2', value: 1_100_000, txid: 'cj-p2' }),
        vin({ address: 'bc1qcj3', value: 1_100_000, txid: 'cj-p3' }),
        vin({ address: 'bc1qcj4', value: 1_100_000, txid: 'cj-p4' }),
        vin({ address: 'bc1qcj5', value: 1_100_000, txid: 'cj-p5' }),
      ],
      vout: [
        vout({ address: A, value: 1_000_000 }),
        vout({ address: 'bc1qcjo1', value: 1_000_000 }),
        vout({ address: 'bc1qcjo2', value: 1_000_000 }),
        vout({ address: 'bc1qcjo3', value: 91_234 }),
        vout({ address: 'bc1qcjo4', value: 87_651 }),
        vout({ address: 'bc1qcjo5', value: 76_543 }),
      ],
    });

    it('flags coinjoin and marks every emitted row as a junction', () => {
      const rows = mapBtcHistory(A, [fixture]);

      expect(rows).toHaveLength(6);
      expect(rows.every((r) => r.utxo?.junction === true)).toBe(true);
      expect(rows[0].utxo?.warnings).toEqual([
        'possible-coinjoin',
        'multi-input',
      ]);
    });

    it('never guesses change inside a coinjoin, not even for A own output', () => {
      const [row] = mapBtcHistory(A, [fixture]);
      expect(row.utxo?.outputs.every((o) => o.change === false)).toBe(true);
      expect(row.utxo?.outputs.every((o) => o.changeEvidence?.length === 0)).toBe(
        true,
      );
    });

    it('does not double-emit A own output as a separate incoming row', () => {
      const rows = mapBtcHistory(A, [fixture]);
      const keys = rows.map((r) => edgeIdentityKey(r, r.from, r.to));
      expect(new Set(keys).size).toBe(6);
      expect(rows.every((r) => r.from === A)).toBe(true);
    });
  });

  // 6 ------------------------------------------------------------------
  describe('consolidation', () => {
    it('marks the consolidating row as a junction', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-consol',
          vin: [
            vin({ address: A, value: 100_000, txid: 'c0' }),
            vin({ address: 'bc1qc1', value: 100_000, txid: 'c1' }),
            vin({ address: 'bc1qc2', value: 100_000, txid: 'c2' }),
            vin({ address: 'bc1qc3', value: 100_000, txid: 'c3' }),
            vin({ address: 'bc1qc4', value: 100_000, txid: 'c4' }),
          ],
          vout: [vout({ address: 'bc1qvault', value: 499_000 })],
        }),
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe(A);
      expect(rows[0].to).toBe('bc1qvault');
      expect(rows[0].utxo?.junction).toBe(true);
      expect(rows[0].utxo?.warnings).toEqual(['consolidation', 'multi-input']);
    });
  });

  // 7 ------------------------------------------------------------------
  describe('coinbase', () => {
    it('emits one senderless junction row carrying the coinbase warning', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-coinbase',
          fee: 0,
          vin: [
            vin({
              address: null,
              coinbase: true,
              txid: '0'.repeat(64),
              vout: 4_294_967_295,
            }),
          ],
          vout: [vout({ address: A, value: 625_000_000 })],
        }),
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe('');
      expect(rows[0].to).toBe(A);
      expect(rows[0].amount).toBe('625000000');
      expect(rows[0].utxo?.junction).toBe(true);
      expect(rows[0].utxo?.warnings).toContain('coinbase');
      expect(rows[0].utxo?.inputs[0]).toMatchObject({
        address: null,
        coinbase: true,
        value: '0',
      });
    });
  });

  // 8 ------------------------------------------------------------------
  describe('op_return outputs', () => {
    const fixture = tx({
      txid: 'tx-opreturn',
      vin: [vin({ address: A, value: 100_000 })],
      vout: [
        vout({ address: 'bc1qpayee', value: 50_000 }),
        opReturnVout(0),
        vout({ address: A, value: 49_000 }),
      ],
    });

    it('never emits a row for an op_return output', () => {
      const rows = mapBtcHistory(A, [fixture]);

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.utxo?.vout)).toEqual([0, 2]);
      expect(rows.map((r) => r.to)).toEqual(['bc1qpayee', A]);
    });

    it('still records the op_return output in the utxo context', () => {
      const [row] = mapBtcHistory(A, [fixture]);
      expect(row.utxo?.outputs).toHaveLength(3);
      expect(row.utxo?.outputs[1]).toMatchObject({
        address: null,
        index: 1,
        opReturn: true,
        change: false,
        scriptType: 'op_return',
      });
      expect(row.utxo?.outputs[0].opReturn).toBe(false);
    });
  });

  // 9 ------------------------------------------------------------------
  describe('address appearing at multiple vouts', () => {
    it('emits one row per A-output with distinct vouts and identity keys', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-multivout',
          vin: [vin({ address: 'bc1qsender', value: 100_000 })],
          vout: [
            vout({ address: A, value: 10_000 }),
            vout({ address: A, value: 20_000 }),
          ],
        }),
      ]);

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.utxo?.vout)).toEqual([0, 1]);
      expect(rows.map((r) => r.amount)).toEqual(['10000', '20000']);
      expect(rows.every((r) => r.from === 'bc1qsender')).toBe(true);

      const keys = rows.map((r) => edgeIdentityKey(r, r.from, r.to));
      expect(keys).toEqual(['tx-multivout:0', 'tx-multivout:1']);
    });
  });

  // 10 -----------------------------------------------------------------
  describe('mempool transactions', () => {
    it('uses block 0, a current ISO timestamp, and confirmed:false', () => {
      const before = Date.now();
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-mempool',
          confirmed: false,
          vin: [vin({ address: A, value: 100_000 })],
          vout: [vout({ address: 'bc1qpayee', value: 99_000 })],
        }),
      ]);
      const after = Date.now();

      expect(rows).toHaveLength(1);
      expect(rows[0].blockNumber).toBe(0);
      expect(rows[0].utxo?.confirmed).toBe(false);
      expect(rows[0].utxo?.blockHeight).toBeNull();

      const parsed = Date.parse(rows[0].timestamp);
      expect(Number.isNaN(parsed)).toBe(false);
      expect(rows[0].timestamp).toBe(new Date(parsed).toISOString());
      expect(parsed).toBeGreaterThanOrEqual(before - 1000);
      expect(parsed).toBeLessThanOrEqual(after + 1000);
    });
  });

  // 11 -----------------------------------------------------------------
  describe('fan-out payments', () => {
    it('marks rows as junctions when more than 3 non-change outputs are paid', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-fanout',
          vin: [vin({ address: A, value: 500_000 })],
          vout: [
            vout({ address: 'bc1qp0', value: 91_111 }),
            vout({ address: 'bc1qp1', value: 92_222 }),
            vout({ address: 'bc1qp2', value: 93_333 }),
            vout({ address: 'bc1qp3', value: 94_444 }),
            vout({ address: 'bc1qp4', value: 95_555 }),
          ],
        }),
      ]);

      expect(rows).toHaveLength(5);
      expect(rows[0].utxo?.warnings).toEqual([]);
      expect(rows.every((r) => r.utxo?.junction === true)).toBe(true);
      expect(rows.every((r) => r.utxo?.outputs.every((o) => !o.change))).toBe(
        true,
      );
    });

    it('leaves exactly 3 non-change outputs below the junction threshold', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-fanout-3',
          vin: [vin({ address: A, value: 500_000 })],
          vout: [
            vout({ address: 'bc1qp0', value: 91_111 }),
            vout({ address: 'bc1qp1', value: 92_222 }),
            vout({ address: 'bc1qp2', value: 93_333 }),
          ],
        }),
      ]);

      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.utxo?.junction === false)).toBe(true);
    });
  });

  // 12 -----------------------------------------------------------------
  describe('deduplication', () => {
    it('drops repeated txs by edge identity key, keeping the first row', () => {
      const fixture = tx({
        txid: 'tx-dupe',
        vin: [vin({ address: A, value: 100_000 })],
        vout: [
          vout({ address: 'bc1qpayee', value: 60_000 }),
          vout({ address: A, value: 39_000 }),
        ],
      });

      const once = mapBtcHistory(A, [fixture]);
      const twice = mapBtcHistory(A, [fixture, fixture]);

      expect(twice).toHaveLength(once.length);
      expect(twice.map((r) => [r.from, r.to, r.amount, r.utxo?.vout])).toEqual(
        once.map((r) => [r.from, r.to, r.amount, r.utxo?.vout]),
      );
      expect(
        new Set(twice.map((r) => edgeIdentityKey(r, r.from, r.to))).size,
      ).toBe(2);
    });

    it('does not collapse distinct vouts of the same tx', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-distinct',
          vin: [vin({ address: A, value: 100_000 })],
          vout: [
            vout({ address: 'bc1qpayee', value: 30_000 }),
            vout({ address: 'bc1qpayee', value: 30_000 }),
            vout({ address: 'bc1qpayee', value: 39_000 }),
          ],
        }),
      ]);

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.utxo?.vout)).toEqual([0, 1, 2]);
    });
  });

  describe('edge cases', () => {
    it('returns an empty array for an empty tx list', () => {
      expect(mapBtcHistory(A, [])).toEqual([]);
    });

    it('ignores txs where A is neither an input nor an output', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-unrelated',
          vin: [vin({ address: 'bc1qstranger' })],
          vout: [vout({ address: 'bc1qother' })],
        }),
      ]);
      expect(rows).toEqual([]);
    });

    it('emits a senderless junction row when the sole input prevout is unknown', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-nullprevout',
          vin: [vin({ address: null })],
          vout: [vout({ address: A, value: 50_000 })],
        }),
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe('');
      expect(rows[0].utxo?.junction).toBe(true);
    });

    it('emits an empty `to` when an output carries no decodable address', () => {
      const rows = mapBtcHistory(A, [
        tx({
          txid: 'tx-nulloutaddr',
          vin: [vin({ address: A, value: 100_000 })],
          vout: [vout({ address: null, scriptType: 'unknown', value: 99_000 })],
        }),
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].from).toBe(A);
      expect(rows[0].to).toBe('');
      expect(rows[0].utxo?.outputs[0].address).toBeNull();
    });
  });
});
