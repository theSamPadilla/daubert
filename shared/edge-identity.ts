// Canonical duplicate-detection key for a transaction edge.
// BTC edges key on txid + output index (extended in the BTC tasks);
// account-model edges key on txHash + normalized endpoint addresses.
export interface EdgeIdentity {
  chain?: string; txHash?: string;
  utxo?: { vout?: number; legType?: 'input' | 'output'; legIndex?: number };
}
export function edgeIdentityKey(e: EdgeIdentity, fromAddress: string, toAddress: string): string {
  if (e.chain === 'bitcoin' && e.utxo) {
    if (e.utxo.legType === 'input' && e.utxo.legIndex != null) return `${e.txHash}:in:${e.utxo.legIndex}`;
    if (e.utxo.vout != null) return `${e.txHash}:${e.utxo.vout}`;
  }
  return `${e.txHash}-${(fromAddress || '').toLowerCase()}-${(toAddress || '').toLowerCase()}`;
}
