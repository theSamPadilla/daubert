'use client';

import { useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { buildExplorerUrl } from '@/utils/addressParser';
import type { Investigation, WalletNode, TransactionEdge } from '@/types/investigation';
import type { PanelMode } from '@/types/panel';

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
    const addr = (data.address || '').toLowerCase();
    const ch = data.chain || 'ethereum';
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
      (w) => w.wallet.address.toLowerCase() === address.toLowerCase()
    );
    if (existing) return existing.wallet.id;

    const normAddress = address.toLowerCase();
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
      allWallets.some((w) => w.wallet.id === val || w.wallet.address.toLowerCase() === val.toLowerCase());
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

    const existingTxHashes = new Set<string>();
    investigation.traces.forEach((t) =>
      t.edges.forEach((e) => existingTxHashes.add(`${e.txHash}-${e.from}-${e.to}`))
    );

    const existingWalletAddresses = new Map<string, string>();
    investigation.traces.forEach((t) =>
      t.nodes.forEach((n) => existingWalletAddresses.set(n.address.toLowerCase(), n.id))
    );

    let maxX = 0;
    investigation.traces.forEach((t) =>
      t.nodes.forEach((n) => { if (n.position.x > maxX) maxX = n.position.x; })
    );
    let newNodeX = maxX + 150;
    let newNodeY = 100;
    let placedCount = 0;

    for (const tx of selected) {
      const key = `${tx.txHash}-${tx.from}-${tx.to}`;
      if (existingTxHashes.has(key)) continue;

      for (const addr of [tx.from, tx.to]) {
        if (!existingWalletAddresses.has(addr.toLowerCase())) {
          const x = newNodeX + Math.floor(placedCount / 5) * 150;
          const y = newNodeY + (placedCount % 5) * 100;
          placedCount++;
          const normAddr = addr.toLowerCase();
          const wallet: WalletNode = {
            id: crypto.randomUUID(),
            label: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
            address: normAddr,
            chain: tx.chain,
            notes: '',
            tags: [],
            position: { x, y },
            parentTrace: traceId,
          };
          addWallet(traceId, wallet);
          existingWalletAddresses.set(normAddr, wallet.id);
        }
      }

      const fromId = existingWalletAddresses.get(tx.from.toLowerCase()) || tx.from;
      const toId = existingWalletAddresses.get(tx.to.toLowerCase()) || tx.to;
      addTransaction(traceId, { ...tx, id: crypto.randomUUID(), from: fromId, to: toId });
      existingTxHashes.add(key);
    }

    const selectedIds = new Set(selected.map((s) => s.id));
    setStagedItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
  }, [investigation, addWallet, addTransaction, setStagedItems]);

  return { handleSaveNewWallet, findOrCreateWallet, handleSaveNewTransaction, handleAddStagedToTrace };
}
