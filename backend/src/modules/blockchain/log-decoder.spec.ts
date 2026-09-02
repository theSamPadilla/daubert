import { decodeTransferLogs, RawLog } from './log-decoder';

/**
 * Logs from Polygon tx 0xb7a0ee5870a518ecf9784e447d536c3c4f17a4e7cc853d3d5c38f46e7cbcc1ef,
 * verbatim from eth_getTransactionReceipt. This transaction is the reason the decoder
 * exists: `account/tokentx` keyed on tx.from returns zero rows for it, because the
 * sender (a relayer) is not a party to any of its transfers.
 */
const REAL_LOGS: RawLog[] = [
  {
    // Approval — must be ignored, it is not a transfer
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    topics: [
      '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
      '0x000000000000000000000000c55fcca7133d58a934c0431fa14383b45b6c014e',
      '0x000000000000000000000000776023a4573bd972c4c3e2a76f611d3c2bef516e',
    ],
    data: '0x00000000000000000000000000000000000000000000000000000000017d7840',
    logIndex: '0x0',
  },
  {
    // ERC-20 Transfer: 25 USDC
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x000000000000000000000000c55fcca7133d58a934c0431fa14383b45b6c014e',
      '0x000000000000000000000000776023a4573bd972c4c3e2a76f611d3c2bef516e',
    ],
    data: '0x00000000000000000000000000000000000000000000000000000000017d7840',
    logIndex: '0x1',
  },
  {
    // ERC-20 Transfer: the onward hop
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x000000000000000000000000776023a4573bd972c4c3e2a76f611d3c2bef516e',
      '0x00000000000000000000000066dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642',
    ],
    data: '0x00000000000000000000000000000000000000000000000000000000017d7840',
    logIndex: '0x2',
  },
  {
    // ERC-20 Transfer with value 0 — a refund leg, decoded but never primary
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x000000000000000000000000776023a4573bd972c4c3e2a76f611d3c2bef516e',
      '0x000000000000000000000000c55fcca7133d58a934c0431fa14383b45b6c014e',
    ],
    data: '0x0000000000000000000000000000000000000000000000000000000000000000',
    logIndex: '0x3',
  },
  {
    // ERC-721 Transfer (mint): same topic0 as ERC-20, but FOUR topics and empty data.
    // That shape difference is the only on-chain discriminator between the standards.
    address: '0x251be3a17af4892035c37ebf5890f4a4d889dcad',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x000000000000000000000000c55fcca7133d58a934c0431fa14383b45b6c014e',
      '0x09e1862ca89d9a29a049971a30e1878ff782fbcaea19478fe94bfeb1d2bca582',
    ],
    data: '0x',
    logIndex: '0x5',
  },
  {
    // Unrelated application event — must be ignored
    address: '0x776023a4573bd972c4c3e2a76f611d3c2bef516e',
    topics: [
      '0x0538ab32a957d2b55d0ec70a4029e73fdf19f500832839b1d7bafcfbca2a5630',
      '0x00000000000000000000000066dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642',
      '0x0000000000000000000000003c499c542cef5e3811e1192ce70d8cc03d5c3359',
    ],
    data: '0x00000000000000000000000000000000000000000000000000000000017d7840',
    logIndex: '0x4',
  },
];

describe('decodeTransferLogs', () => {
  it('decodes every transfer in the reported transaction and ignores non-transfer logs', () => {
    const out = decodeTransferLogs(REAL_LOGS);
    expect(out).toHaveLength(4);
    expect(out.map((t) => t.standard)).toEqual(['erc20', 'erc20', 'erc20', 'erc721']);
  });

  it('decodes an ERC-20 transfer with checksum-free lowercased endpoints and raw value', () => {
    const [first] = decodeTransferLogs(REAL_LOGS);
    expect(first).toEqual({
      standard: 'erc20',
      contractAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      from: '0xc55fcca7133d58a934c0431fa14383b45b6c014e',
      to: '0x776023a4573bd972c4c3e2a76f611d3c2bef516e',
      value: '25000000',
      logIndex: 1,
    });
  });

  it('decodes an ERC-721 transfer by topic count, carrying tokenId and a unit value', () => {
    const nft = decodeTransferLogs(REAL_LOGS).find((t) => t.standard === 'erc721');
    expect(nft).toEqual({
      standard: 'erc721',
      contractAddress: '0x251be3a17af4892035c37ebf5890f4a4d889dcad',
      from: '0x0000000000000000000000000000000000000000',
      to: '0xc55fcca7133d58a934c0431fa14383b45b6c014e',
      value: '1',
      tokenId:
        '4469282264829956043634515469381478210621183059247356743393779657588816520578',
      logIndex: 5,
    });
  });

  it('retains zero-value transfers — filtering them is the caller\'s decision', () => {
    const zero = decodeTransferLogs(REAL_LOGS).filter((t) => t.value === '0');
    expect(zero).toHaveLength(1);
    expect(zero[0].logIndex).toBe(3);
  });

  it('decodes an ERC-1155 TransferSingle', () => {
    const out = decodeTransferLogs([
      {
        address: '0xabc0000000000000000000000000000000000001',
        topics: [
          '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
          '0x000000000000000000000000000000000000000000000000000000000000dead',
          '0x0000000000000000000000001111111111111111111111111111111111111111',
          '0x0000000000000000000000002222222222222222222222222222222222222222',
        ],
        data:
          '0x0000000000000000000000000000000000000000000000000000000000000007' +
          '0000000000000000000000000000000000000000000000000000000000000003',
        logIndex: '0xa',
      },
    ]);
    expect(out).toEqual([
      {
        standard: 'erc1155',
        contractAddress: '0xabc0000000000000000000000000000000000001',
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        value: '3',
        tokenId: '7',
        logIndex: 10,
      },
    ]);
  });

  it('decodes an ERC-1155 TransferBatch into one entry per id/value pair', () => {
    const out = decodeTransferLogs([
      {
        address: '0xabc0000000000000000000000000000000000001',
        topics: [
          '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
          '0x000000000000000000000000000000000000000000000000000000000000dead',
          '0x0000000000000000000000001111111111111111111111111111111111111111',
          '0x0000000000000000000000002222222222222222222222222222222222222222',
        ],
        // offset(ids)=0x40, offset(values)=0xa0, ids=[1,2], values=[10,20]
        data:
          '0x0000000000000000000000000000000000000000000000000000000000000040' +
          '00000000000000000000000000000000000000000000000000000000000000a0' +
          '0000000000000000000000000000000000000000000000000000000000000002' +
          '0000000000000000000000000000000000000000000000000000000000000001' +
          '0000000000000000000000000000000000000000000000000000000000000002' +
          '0000000000000000000000000000000000000000000000000000000000000002' +
          '000000000000000000000000000000000000000000000000000000000000000a' +
          '0000000000000000000000000000000000000000000000000000000000000014',
        logIndex: '0xb',
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((t) => [t.tokenId, t.value])).toEqual([
      ['1', '10'],
      ['2', '20'],
    ]);
  });

  it('returns an empty array for an empty or malformed log set rather than throwing', () => {
    expect(decodeTransferLogs([])).toEqual([]);
    expect(
      decodeTransferLogs([
        { address: '0xa', topics: [], data: '0x', logIndex: '0x0' },
        {
          address: '0xb',
          topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
          data: '0x',
          logIndex: '0x1',
        },
      ]),
    ).toEqual([]);
  });
});
