import { edgeIdentityKey } from '../generated/shared/edge-identity';

describe('edgeIdentityKey', () => {
  it('keys account-model edges by txHash + lowercased endpoint addresses', () => {
    const key = edgeIdentityKey({ txHash: '0xABC', chain: 'ethereum' }, '0xFROM', '0xTO');
    expect(key).toBe('0xABC-0xfrom-0xto');
  });

  it('lowercases mixed-case addresses regardless of order', () => {
    const key = edgeIdentityKey({ txHash: '0xabc', chain: 'ethereum' }, '0xAaAa', '0xBbBb');
    expect(key).toBe('0xabc-0xaaaa-0xbbbb');
  });

  it('keys a BTC payment (output) leg by txid + vout', () => {
    const key = edgeIdentityKey(
      { chain: 'bitcoin', txHash: 'txid1', utxo: { vout: 2 } },
      'bc1qfrom',
      'bc1qto'
    );
    expect(key).toBe('txid1:2');
  });

  it('keys a BTC junction input leg by txid + leg index', () => {
    const key = edgeIdentityKey(
      { chain: 'bitcoin', txHash: 'txid1', utxo: { legType: 'input', legIndex: 0 } },
      'bc1qfrom',
      'bc1qto'
    );
    expect(key).toBe('txid1:in:0');
  });

  it('falls back to the composite key for BTC edges with no utxo context', () => {
    const key = edgeIdentityKey({ chain: 'bitcoin', txHash: 'txid1' }, 'bc1qFROM', 'bc1qTO');
    expect(key).toBe('txid1-bc1qfrom-bc1qto');
  });

  it('regression: a persisted edge resolved from node ids to addresses matches a staged row keyed by raw addresses', () => {
    // Mirrors the fix in WorkspaceModals.tsx / useWalletTransactionAuthoring.ts:
    // persisted edges reference node UUIDs, so `from`/`to` must be resolved through
    // a nodeId -> address map before computing the key. Previously the persisted
    // key was built straight from the UUIDs, so it could never match a staged
    // row's key (which is built from raw addresses) — nothing was ever flagged
    // as a duplicate.
    const nodes = [
      { id: 'uuid1', address: '0xAAA' },
      { id: 'uuid2', address: '0xBBB' },
    ];
    const nodeAddressById = new Map(nodes.map((n) => [n.id, n.address]));

    const persistedEdge = { from: 'uuid1', to: 'uuid2', txHash: '0xh' };
    const resolvedFrom = nodeAddressById.get(persistedEdge.from) ?? persistedEdge.from;
    const resolvedTo = nodeAddressById.get(persistedEdge.to) ?? persistedEdge.to;
    const persistedKey = edgeIdentityKey(persistedEdge, resolvedFrom, resolvedTo);

    const stagedTx = { from: '0xaaa', to: '0xbbb', txHash: '0xh' };
    const stagedKey = edgeIdentityKey(stagedTx, stagedTx.from, stagedTx.to);

    expect(persistedKey).toBe(stagedKey);
  });

  it('falls back to the raw endpoint value when it is not a known node id (edges predating import normalization)', () => {
    const nodeAddressById = new Map<string, string>(); // empty — nothing resolves
    const edge = { from: '0xRAW1', to: '0xRAW2', txHash: '0xh2' };
    const resolvedFrom = nodeAddressById.get(edge.from) ?? edge.from;
    const resolvedTo = nodeAddressById.get(edge.to) ?? edge.to;
    const key = edgeIdentityKey(edge, resolvedFrom, resolvedTo);
    expect(key).toBe('0xh2-0xraw1-0xraw2');
  });

  it('keys two solana transfers in the same signature by transferIndex, producing distinct keys', () => {
    const key0 = edgeIdentityKey(
      { chain: 'solana', txHash: 'sig', solana: { transferIndex: 0 } },
      'solFrom',
      'solTo'
    );
    const key1 = edgeIdentityKey(
      { chain: 'solana', txHash: 'sig', solana: { transferIndex: 1 } },
      'solFrom',
      'solTo'
    );
    expect(key0).toBe('sig:sol:0');
    expect(key1).toBe('sig:sol:1');
    expect(key0).not.toBe(key1);
  });

  it('dedups the same solana transfer seen twice to a single key', () => {
    const keyA = edgeIdentityKey(
      { chain: 'solana', txHash: 'sig', solana: { transferIndex: 0 } },
      'solFrom',
      'solTo'
    );
    const keyB = edgeIdentityKey(
      { chain: 'solana', txHash: 'sig', solana: { transferIndex: 0 } },
      'solFrom',
      'solTo'
    );
    expect(keyA).toBe(keyB);
  });

  it('falls back to the generic composite key for a solana row with no solana context', () => {
    const key = edgeIdentityKey({ chain: 'solana', txHash: 'sig' }, 'solFROM', 'solTO');
    expect(key).toBe('sig-solfrom-solto');
  });
});
