'use client';

import { useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { buildExplorerUrl, buildTxExplorerUrl } from '@/utils/addressParser';
import type { Investigation, WalletNode, TransactionEdge, UtxoContext } from '@/types/investigation';
import type { PanelMode } from '@/types/panel';
import { edgeIdentityKey } from '../generated/shared/edge-identity';
import { planJunction } from '../generated/shared/utxo';
import { normalizeAddressForChain } from '../generated/shared/address';

/**
 * Canonical case-insensitive lookup key for an address. Mirrors
 * `addressKey` in `backend/src/modules/traces/traces.service.ts` — trimmed
 * AND lowercased, so a differently-cased or whitespace-padded spelling of
 * the same address still resolves to the same node. The PERSISTED value on
 * the node is chain-aware (see `normalizeAddressForChain`); only the lookup
 * key is uniform across chains.
 */
function addressKey(addr: string): string {
  return addr.trim().toLowerCase();
}

/** Bitcoin edges carry the structured token; built fresh per edge so no two
 * edges share (and could mutually mutate) the same object. */
function btcToken() {
  return { address: '', symbol: 'BTC', decimals: 8 };
}

interface UseWalletTransactionAuthoringArgs {
  investigation: Investigation | null;
  allWallets: { wallet: WalletNode; traceId: string }[];
  panelMode: PanelMode;
  setPanelMode: (mode: PanelMode) => void;
  setSelectedItem: (item: any) => void;
  setStagedItems: (updater: (prev: TransactionEdge[]) => TransactionEdge[]) => void;
  addWallet: (traceId: string, wallet: WalletNode) => void;
  updateWallet: (traceId: string, walletId: string, patch: Partial<WalletNode>) => void;
  addTransaction: (traceId: string, tx: TransactionEdge) => void;
}

export function useWalletTransactionAuthoring(args: UseWalletTransactionAuthoringArgs) {
  const {
    investigation, allWallets, panelMode, setPanelMode, setSelectedItem,
    setStagedItems, addWallet, updateWallet, addTransaction,
  } = args;

  const handleSaveNewWallet = useCallback((traceId: string, data: Partial<WalletNode>) => {
    const position = panelMode.type === 'createWallet' && panelMode.position
      ? panelMode.position
      : { x: Math.random() * 400, y: Math.random() * 400 };
    const ch = data.chain || 'ethereum';
    const raw = (data.address || '').trim();
    const addr = normalizeAddressForChain(raw, ch);
    const wallet: WalletNode = {
      id: crypto.randomUUID(),
      label: data.label || 'New Node',
      address: addr,
      chain: ch,
      color: data.color || '#60a5fa',
      size: data.size,
      notes: data.notes || '',
      tags: data.tags || [],
      position,
      parentTrace: traceId,
      addressType: addr ? 'unknown' : undefined,
      explorerUrl: addr ? buildExplorerUrl(ch, addr) : undefined,
    };
    addWallet(traceId, wallet);
    setPanelMode({ type: 'none' });
    setSelectedItem({ type: 'wallet', data: wallet });

    if (addr) {
      apiClient.getAddressInfo(addr, ch).then((info) => {
        updateWallet(traceId, wallet.id, { addressType: info.addressType });
      }).catch(() => {});
    }
  }, [panelMode, addWallet, updateWallet, setPanelMode, setSelectedItem]);

  const findOrCreateWallet = useCallback((address: string, chain: string, traceId: string): string => {
    const existing = allWallets.find(
      (w) => addressKey(w.wallet.address) === addressKey(address)
    );
    if (existing) return existing.wallet.id;

    const normAddress = normalizeAddressForChain(address, chain);
    const walletId = crypto.randomUUID();
    const wallet: WalletNode = {
      id: walletId,
      label: normAddress.length > 10 ? `${normAddress.slice(0, 6)}...${normAddress.slice(-4)}` : normAddress,
      address: normAddress,
      chain,
      notes: '',
      tags: [],
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      parentTrace: traceId,
      addressType: 'unknown',
      explorerUrl: buildExplorerUrl(chain, normAddress),
    };
    addWallet(traceId, wallet);

    apiClient.getAddressInfo(normAddress, chain).then((info) => {
      updateWallet(traceId, walletId, { addressType: info.addressType });
    }).catch(() => {});

    return wallet.id;
  }, [allWallets, addWallet, updateWallet]);

  const handleSaveNewTransaction = useCallback((traceId: string, data: Partial<TransactionEdge>) => {
    const ch = data.chain || 'ethereum';
    let fromId = data.from || '';
    let toId = data.to || '';
    const isExistingWallet = (val: string) =>
      allWallets.some((w) => w.wallet.id === val || addressKey(w.wallet.address) === addressKey(val));
    if (fromId && !isExistingWallet(fromId)) fromId = findOrCreateWallet(fromId, ch, traceId);
    if (toId && !isExistingWallet(toId)) toId = findOrCreateWallet(toId, ch, traceId);

    const fromTrace = allWallets.find((w) => w.wallet.id === fromId)?.traceId;
    const toTrace = allWallets.find((w) => w.wallet.id === toId)?.traceId;
    const crossTrace = !!(fromTrace && toTrace && fromTrace !== toTrace);

    const transaction: TransactionEdge = {
      id: crypto.randomUUID(),
      from: fromId,
      to: toId,
      txHash: data.txHash || '0x',
      chain: ch,
      timestamp: data.timestamp || new Date().toISOString(),
      amount: data.amount || '0',
      token: data.token || { address: '0x', symbol: 'ETH', decimals: 18 },
      usdValue: data.usdValue,
      color: data.color || '#10b981',
      label: data.label || '',
      notes: data.notes || '',
      tags: data.tags || [],
      blockNumber: data.blockNumber || 0,
      crossTrace,
    };
    addTransaction(traceId, transaction);
    setPanelMode({ type: 'none' });
    setSelectedItem({ type: 'transaction', data: transaction });
  }, [addTransaction, allWallets, findOrCreateWallet, setPanelMode, setSelectedItem]);

  const handleAddStagedToTrace = useCallback((traceId: string, selected: TransactionEdge[]) => {
    if (!investigation) return;

    // Edges reference node UUIDs after import, not raw addresses — resolve through
    // a nodeId -> address map before computing the dedup key (fall back to the raw
    // value for edges that predate import normalization).
    const nodeAddressById = new Map<string, string>();
    investigation.traces.forEach((t) =>
      t.nodes.forEach((n) => nodeAddressById.set(n.id, n.address))
    );

    // Tracks which trace each node lives in, so newly-authored junction leg
    // edges can compute `crossTrace` correctly (an endpoint resolved from a
    // sibling trace, same as `findOrCreateWallet`/`handleSaveNewTransaction`).
    const nodeTraceById = new Map<string, string>();
    investigation.traces.forEach((t) =>
      t.nodes.forEach((n) => nodeTraceById.set(n.id, t.id))
    );

    const existingTxHashes = new Set<string>();
    investigation.traces.forEach((t) =>
      t.edges.forEach((e) => {
        const fromAddr = nodeAddressById.get(e.from) ?? e.from;
        const toAddr = nodeAddressById.get(e.to) ?? e.to;
        existingTxHashes.add(edgeIdentityKey(e, fromAddr, toAddr));
      })
    );

    const existingWalletAddresses = new Map<string, string>();
    investigation.traces.forEach((t) =>
      t.nodes.forEach((n) => existingWalletAddresses.set(addressKey(n.address), n.id))
    );

    let maxX = 0;
    investigation.traces.forEach((t) =>
      t.nodes.forEach((n) => { if (n.position.x > maxX) maxX = n.position.x; })
    );
    const newNodeX = maxX + 150;
    const newNodeY = 100;
    let placedCount = 0;

    const nextPosition = () => {
      const x = newNodeX + Math.floor(placedCount / 5) * 150;
      const y = newNodeY + (placedCount % 5) * 100;
      placedCount++;
      return { x, y };
    };

    /**
     * Creates the wallet node for `addr` on `chain` unless one already exists
     * (case-insensitively), and returns the id it resolves to. Shared by both
     * the non-junction row loop and the junction leg-endpoint loop below, so
     * BTC leg endpoints go through exactly the same minimal node shape as
     * every other staged-row endpoint.
     *
     * Persisted value is chain-aware via `normalizeAddressForChain`, matching
     * the backend import path: EVM lowercased, Tron and Bitcoin case-preserved
     * (both are case-sensitive base58/bech32). Lookup stays case-insensitive
     * via `addressKey`.
     */
    const ensureWalletNode = (addr: string, chain: string): string | undefined => {
      if (!addr) return undefined;
      const key = addressKey(addr);
      if (!existingWalletAddresses.has(key)) {
        const persisted = normalizeAddressForChain(addr, chain);
        const { x, y } = nextPosition();
        const wallet: WalletNode = {
          id: crypto.randomUUID(),
          label: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
          address: persisted,
          chain,
          notes: '',
          tags: [],
          position: { x, y },
          parentTrace: traceId,
        };
        addWallet(traceId, wallet);
        existingWalletAddresses.set(key, wallet.id);
        nodeTraceById.set(wallet.id, traceId);
      }
      return existingWalletAddresses.get(key);
    };

    // Bitcoin junction-flagged rows are grouped by txid first: every row
    // derived from the same transaction carries the SAME full utxo context
    // (inputs/outputs shared by reference), so planning from any one of them
    // converges on the same node and the same legs — mirrors the backend
    // import path (traces.service.ts), which relies on the same convergence
    // property. `processedJunctionTx` collapses N staged rows of one
    // transaction into a single planning pass instead of re-running
    // `planJunction` (and re-deduping every leg) N times.
    const processedJunctionTx = new Set<string>();

    for (const tx of selected) {
      const isJunctionRow = tx.chain === 'bitcoin' && !!tx.utxo?.junction;

      if (isJunctionRow) {
        if (!tx.txHash || !tx.utxo || processedJunctionTx.has(tx.txHash)) continue;
        processedJunctionTx.add(tx.txHash);
        // Captured as locals (rather than read off `tx` inside the `addLeg`
        // closure below) so TypeScript keeps them narrowed to non-undefined —
        // narrowing on `tx.txHash`/`tx.utxo` does not survive into a nested closure.
        const txHash = tx.txHash;
        const utxoCtx = tx.utxo;

        const plan = planJunction(txHash, utxoCtx);

        // The junction node dedups through the same address-keyed map as
        // wallets: its "address" is the txid — globally unique lowercase hex.
        const junctionKey = addressKey(plan.node.address);
        let junctionId = existingWalletAddresses.get(junctionKey);
        if (!junctionId) {
          const { x, y } = nextPosition();

          // vout/legType/legIndex/junction describe the ROW that produced
          // this plan, not the transaction — keeping them here would assert
          // the whole tx is "vout 0". Arrays are copied because a fetched
          // row's inputs/outputs are shared by reference with every sibling
          // row of the same transaction; persisted state must never alias
          // the staged item.
          const {
            vout: _vout,
            legType: _legType,
            legIndex: _legIndex,
            junction: _junction,
            ...ledger
          } = utxoCtx;

          const node: WalletNode = {
            id: crypto.randomUUID(),
            label: plan.node.label,
            address: plan.node.address,
            chain: 'bitcoin',
            kind: plan.node.kind,
            utxoTx: { ...ledger, inputs: [...utxoCtx.inputs], outputs: [...utxoCtx.outputs] },
            notes: '',
            tags: [],
            position: { x, y },
            parentTrace: traceId,
            addressType: 'unknown',
            explorerUrl: buildTxExplorerUrl('bitcoin', txHash),
          };
          addWallet(traceId, node);
          junctionId = node.id;
          existingWalletAddresses.set(junctionKey, junctionId);
          nodeTraceById.set(junctionId, traceId);
        }

        // Mirrors the backend's `pushLeg`: one leg edge per real participant,
        // deduped on the txid + leg position (never on the endpoints, so
        // relabeling or re-fetching the same leg is still the same fact).
        const addLeg = (
          counterpartyAddr: string,
          direction: 'input' | 'output',
          amountSats: string,
          legUtxo: UtxoContext,
        ) => {
          const key = edgeIdentityKey(
            { chain: 'bitcoin', txHash, utxo: legUtxo },
            direction === 'input' ? counterpartyAddr : plan.node.address,
            direction === 'input' ? plan.node.address : counterpartyAddr,
          );
          if (existingTxHashes.has(key)) return;
          const counterpartyId = ensureWalletNode(counterpartyAddr, 'bitcoin');
          if (!counterpartyId || !junctionId) return;

          const fromId = direction === 'input' ? counterpartyId : junctionId;
          const toId = direction === 'input' ? junctionId : counterpartyId;
          const crossTrace = nodeTraceById.get(fromId) !== traceId || nodeTraceById.get(toId) !== traceId;

          addTransaction(traceId, {
            id: crypto.randomUUID(),
            from: fromId,
            to: toId,
            txHash,
            chain: 'bitcoin',
            timestamp: tx.timestamp,
            amount: amountSats,
            token: btcToken(),
            notes: '',
            tags: [],
            blockNumber: tx.blockNumber || 0,
            crossTrace,
            utxo: legUtxo,
          });
          existingTxHashes.add(key);
        };

        for (const leg of plan.inputLegs) {
          // Input legs carry no output record of their own — the junction
          // node's utxoTx already holds the full ledger — so the arrays stay
          // empty.
          addLeg(leg.fromAddress, 'input', leg.amountSats, {
            inputs: [],
            outputs: [],
            fee: '',
            legType: 'input',
            legIndex: leg.legIndex,
          });
        }

        for (const leg of plan.outputLegs) {
          addLeg(leg.toAddress, 'output', leg.amountSats, {
            inputs: [],
            // A single-entry `outputs` array describing THIS leg's output —
            // keeps the change verdict on the edge while staying a valid
            // UtxoContext (which has no root-level `change` field).
            outputs: [
              {
                address: leg.toAddress,
                value: leg.amountSats,
                index: leg.vout,
                ...(leg.change !== undefined ? { change: leg.change } : {}),
              },
            ],
            fee: '',
            legType: 'output',
            vout: leg.vout,
          });
        }

        continue;
      }

      // Non-junction row (EVM, Tron, or a direct BTC payment edge).
      const key = edgeIdentityKey(tx, tx.from, tx.to);
      if (existingTxHashes.has(key)) continue;

      for (const addr of [tx.from, tx.to]) {
        // A BTC row can legitimately have an empty endpoint (the fetch path
        // emits `from: ''` on unattributed incoming rows) — never mint a node
        // for it. Junction rows with an empty endpoint are handled above and
        // never reach this branch.
        if (tx.chain === 'bitcoin' && !addr) continue;
        ensureWalletNode(addr, tx.chain);
      }

      const fromId = existingWalletAddresses.get(addressKey(tx.from)) || tx.from;
      const toId = existingWalletAddresses.get(addressKey(tx.to)) || tx.to;
      const authored: TransactionEdge = { ...tx, id: crypto.randomUUID(), from: fromId, to: toId };
      // Defensive copy: a direct BTC row's `utxo.inputs`/`outputs` arrays are
      // shared by reference with the staged item (and any sibling rows of the
      // same fetch); persisted state must never alias them.
      if (tx.utxo) authored.utxo = { ...tx.utxo, inputs: [...tx.utxo.inputs], outputs: [...tx.utxo.outputs] };
      addTransaction(traceId, authored);
      existingTxHashes.add(key);
    }

    const selectedIds = new Set(selected.map((s) => s.id));
    setStagedItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
  }, [investigation, addWallet, addTransaction, setStagedItems]);

  return { handleSaveNewWallet, findOrCreateWallet, handleSaveNewTransaction, handleAddStagedToTrace };
}
