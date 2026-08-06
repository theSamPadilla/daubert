import { classifySolanaRow } from './classifySolanaRow';
import { TransactionEdge } from '@/types/investigation';

const SOL_TOKEN = { address: '', symbol: 'SOL', decimals: 9 };
const EVM_TOKEN = { address: '0xabc', symbol: 'USDC', decimals: 6 };

type SolanaContext = {
  transferIndex: number;
  feePayer: string;
  kind: 'native' | 'spl';
  mint?: string;
  decimals?: number;
  fromTokenAccount?: string;
  toTokenAccount?: string;
  type?: string;
  source?: string;
  slot?: number;
  spam?: boolean;
  spamEvidence?: string[];
};

function makeSolana(overrides: Partial<SolanaContext> = {}): SolanaContext {
  return {
    transferIndex: 0,
    feePayer: 'SenderAddr111',
    kind: 'native',
    ...overrides,
  };
}

function makeTx(overrides: Partial<TransactionEdge> & { solana?: SolanaContext } = {}): TransactionEdge {
  return {
    id: 'tx-1',
    from: 'SenderAddr111',
    to: 'RecipientAddr222',
    txHash: 'sig1',
    chain: 'solana',
    timestamp: '2024-01-01T00:00:00.000Z',
    amount: '1000000000',
    token: SOL_TOKEN,
    notes: '',
    tags: [],
    blockNumber: 0,
    crossTrace: false,
    solana: makeSolana(),
    ...overrides,
  } as TransactionEdge;
}

describe('classifySolanaRow', () => {
  it('returns null for non-Solana rows without a solana field', () => {
    const tx = makeTx({ solana: undefined, token: EVM_TOKEN });
    expect(classifySolanaRow(tx, '0xFetchedAddress')).toBeNull();
  });

  it('flags isSpam true and returns evidence when solana.spam is true', () => {
    const tx = makeTx({ solana: makeSolana({ spam: true, spamEvidence: ['low-value-airdrop', 'unknown-mint'] }) });
    const result = classifySolanaRow(tx, 'SenderAddr111');
    expect(result?.isSpam).toBe(true);
    expect(result?.evidence).toEqual(['low-value-airdrop', 'unknown-mint']);
  });

  it('flags isSpam false with empty evidence for a clean row', () => {
    const tx = makeTx({ solana: makeSolana({ spam: false }) });
    const result = classifySolanaRow(tx, 'SenderAddr111');
    expect(result?.isSpam).toBe(false);
    expect(result?.evidence).toEqual([]);
  });

  it('defaults evidence to [] when spamEvidence is absent even if spam is true', () => {
    const tx = makeTx({ solana: makeSolana({ spam: true, spamEvidence: undefined }) });
    const result = classifySolanaRow(tx, 'SenderAddr111');
    expect(result?.evidence).toEqual([]);
  });

  it('classifies direction "out" when from === fetchedAddress and to !== fetchedAddress', () => {
    const tx = makeTx({ from: 'SenderAddr111', to: 'RecipientAddr222' });
    const result = classifySolanaRow(tx, 'SenderAddr111');
    expect(result?.direction).toBe('out');
  });

  it('classifies direction "in" when to === fetchedAddress and from !== fetchedAddress', () => {
    const tx = makeTx({ from: 'SenderAddr111', to: 'RecipientAddr222' });
    const result = classifySolanaRow(tx, 'RecipientAddr222');
    expect(result?.direction).toBe('in');
  });

  it('classifies direction "self" when from and to both equal fetchedAddress', () => {
    const tx = makeTx({ from: 'SameAddr333', to: 'SameAddr333' });
    const result = classifySolanaRow(tx, 'SameAddr333');
    expect(result?.direction).toBe('self');
  });

  it('falls back to "in" when neither from nor to matches the fetched address (e.g. no address context)', () => {
    const tx = makeTx({ from: 'SenderAddr111', to: 'RecipientAddr222' });
    const result = classifySolanaRow(tx, '');
    expect(result?.direction).toBe('in');
  });

  it('degrades gracefully with an empty fetchedAddress: still classifies, spam badge unaffected', () => {
    const tx = makeTx({
      from: 'SenderAddr111',
      to: 'RecipientAddr222',
      solana: makeSolana({ spam: true, spamEvidence: ['low-value-airdrop'] }),
    });
    const result = classifySolanaRow(tx, '');
    expect(result).not.toBeNull();
    expect(result?.isSpam).toBe(true);
    expect(result?.evidence).toEqual(['low-value-airdrop']);
  });

  it('is case-sensitive when comparing addresses (Solana addresses are case-sensitive base58)', () => {
    const tx = makeTx({ from: 'SenderAddr111', to: 'RecipientAddr222' });
    const result = classifySolanaRow(tx, 'senderaddr111');
    // 'SenderAddr111' !== 'senderaddr111' -> not treated as the outgoing endpoint
    expect(result?.direction).not.toBe('out');
  });
});
