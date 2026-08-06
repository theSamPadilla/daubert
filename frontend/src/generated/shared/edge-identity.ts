// Canonical duplicate-detection key for a transaction edge.
// BTC edges key on txid + output index (extended in the BTC tasks);
// Solana edges key on signature + transfer index (one signature can carry
// several transfers -- native SOL + SPL token legs -- each its own edge);
// account-model edges key on txHash + normalized endpoint addresses.
export interface EdgeIdentity {
  chain?: string; txHash?: string;
  utxo?: { vout?: number; legType?: 'input' | 'output'; legIndex?: number };
  solana?: { transferIndex?: number };
}
export function edgeIdentityKey(e: EdgeIdentity, fromAddress: string, toAddress: string): string {
  if (e.chain === 'bitcoin' && e.utxo) {
    if (e.utxo.legType === 'input' && e.utxo.legIndex != null) return `${e.txHash}:in:${e.utxo.legIndex}`;
    if (e.utxo.vout != null) return `${e.txHash}:${e.utxo.vout}`;
  }
  if (e.chain === 'solana' && e.solana?.transferIndex != null) return `${e.txHash}:sol:${e.solana.transferIndex}`;
  return `${e.txHash}-${(fromAddress || '').toLowerCase()}-${(toAddress || '').toLowerCase()}`;
}
