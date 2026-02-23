import { Investigation } from '../types/investigation';

export const mockInvestigation: Investigation = {
  id: 'inv-1',
  name: 'JS Matter Investigation',
  description: 'Tracking NFT auction purchase flows',
  createdAt: '2024-11-01T00:00:00Z',
  metadata: {},
  traces: [
    {
      id: 'trace-1',
      name: 'J.S. Purchase Nov 2021',
      criteria: {
        type: 'time',
        timeRange: {
          start: '2021-11-21T00:00:00Z',
          end: '2021-11-27T23:59:59Z',
        },
      },
      visible: true,
      collapsed: false,
      color: '#3b82f6',
      position: { x: 0, y: 0 },
      nodes: [
        {
          id: '0x3ddfa',
          label: 'JS Wallet',
          address: '0x3ddfa',
          chain: 'ethereum',
          color: '#60a5fa',
          notes: 'Main buyer wallet',
          tags: ['buyer'],
          position: { x: 100, y: 100 },
          parentTrace: 'trace-1',
        },
        {
          id: '0xE0de',
          label: 'Purchase Target',
          address: '0xE0de',
          chain: 'ethereum',
          color: '#34d399',
          notes: 'NFT seller',
          tags: ['seller'],
          position: { x: 300, y: 100 },
          parentTrace: 'trace-1',
        },
      ],
      edges: [
        {
          id: 'tx-1',
          from: '0x3ddfa',
          to: '0xE0de',
          txHash: '0xabc123',
          chain: 'ethereum',
          timestamp: '2021-11-21T15:30:00Z',
          amount: '78395999',
          token: {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            decimals: 6,
          },
          usdValue: 78395.999,
          color: '#10b981',
          label: 'Purchase',
          notes: 'Large NFT purchase',
          tags: ['purchase'],
          blockNumber: 13662000,
          crossTrace: false,
        },
      ],
    },
  ],
};
