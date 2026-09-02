import { useState, useRef, useEffect } from 'react';
import { FaSpinner } from 'react-icons/fa6';
import { ChainSelect } from './ChainSelect';
import { inspectInput } from '@/utils/addressParser';
import { apiClient } from '@/lib/api-client';
import { CHAIN_IDS } from '@/generated/shared/chains';
import { selectPrimaryTransfer } from '@/utils/selectPrimaryTransfer';
import type { WalletNode, TransactionEdge } from '@/types/investigation';

interface QuickAddInputProps {
  onResolveAddress: (prefill: Partial<WalletNode>) => void;
  onResolveTransaction: (prefill: Partial<TransactionEdge>) => void;
  investigationId?: string;  // used to reset state when investigation changes
  disabled?: boolean;
}

// Derived from the shared chain registry (insertion order keeps ethereum first).
const CHAIN_OPTIONS = CHAIN_IDS;

function truncate(addr: string): string {
  return addr.length <= 10 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function QuickAddInput({
  onResolveAddress,
  onResolveTransaction,
  investigationId,
  disabled,
}: QuickAddInputProps) {
  const [value, setValue] = useState('');
  const [chain, setChain] = useState('ethereum');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Holds the AbortController for any in-flight tx fetch
  const abortRef = useRef<AbortController | null>(null);

  // Reset state and abort in-flight fetch when investigation changes
  useEffect(() => {
    setValue('');
    setLoading(false);
    setError('');
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [investigationId]);

  // Abort in-flight fetch on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // Compute chain dropdown gating from current input value on every render
  const trimmedValue = value.trim();
  const inspected = trimmedValue ? inspectInput(trimmedValue) : null;

  function getChainSelectProps(): React.ComponentProps<typeof ChainSelect> {
    if (inspected?.family === 'tron') {
      return { value: 'tron', options: ['tron'], onChange: () => {}, disabled: true };
    }
    if (inspected?.chain) {
      return { value: inspected.chain, options: [inspected.chain], onChange: () => {}, disabled: true };
    }
    return { value: chain, options: CHAIN_OPTIONS, onChange: setChain };
  }

  const chainSelectProps = getChainSelectProps();

  // The chain that will be used for prefill — derived from inspected result or dropdown
  function resolvedChain(): string {
    if (inspected?.family === 'tron') return 'tron';
    return inspected?.chain ?? chain;
  }

  async function handleSubmit() {
    if (!trimmedValue || loading || disabled) return;

    const result = inspectInput(trimmedValue);
    setError('');

    if (result.kind === 'address') {
      const rc = result.chain ?? (result.family === 'tron' ? 'tron' : chain);
      const addr = result.address ?? trimmedValue;
      const prefill: Partial<WalletNode> = {
        address: addr,
        chain: rc,
        label: truncate(addr),
        explorerUrl: result.explorerUrl,
      };
      // Clear synchronously before callback to prevent double-submit
      setValue('');
      onResolveAddress(prefill);
      return;
    }

    if (result.kind === 'transaction') {
      const rc = result.chain ?? chain;

      if (rc === 'bitcoin') {
        setError("Bitcoin transactions can't be added from Quick Add — a UTXO transaction has no single sender. Use Fetch History on one of its addresses.");
        return;
      }

      setLoading(true);

      // Cancel any previous in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // apiClient.getTransaction does not accept an AbortSignal — guard via
        // controller.signal.aborted after the fetch completes to avoid acting
        // on a stale response.
        const detail = await apiClient.getTransaction(result.txHash!, rc);

        // If this request was superseded (input changed, unmounted, investigation
        // switched), discard the response.
        if (controller.signal.aborted) return;

        // Decoded receipt legs are authoritative when present. `tokenTransfers`
        // remains the fallback for chains without log decoding (Tron, Solana),
        // and the native tx is the last resort.
        const legs = detail.transfers ?? [];
        const primaryIndex = selectPrimaryTransfer(legs, detail.from);
        const primary = primaryIndex >= 0 ? legs[primaryIndex] : undefined;
        const legacy = detail.tokenTransfers[0];

        const token = primary?.token || legacy?.token || detail.token;
        // `selectPrimaryTransfer` can land on a leg that moved nothing (every
        // leg zero-value) — its amount is legitimately '0', which `||` would
        // skip past in favor of the native amount. `??` only falls through on
        // an actually-absent leg.
        const amount = primary?.amount ?? legacy?.amount ?? detail.amount;
        const from = primary?.from ?? legacy?.from ?? detail.from;
        const to = primary?.to ?? legacy?.to ?? detail.to;

        const prefill: Partial<TransactionEdge> = {
          txHash: detail.txHash,
          from,
          to,
          chain: detail.chain,
          amount,
          token,
          timestamp: detail.timestamp,
          blockNumber: detail.blockNumber,
          transfers: legs.length ? legs : undefined,
          selectedTransferIndex: primaryIndex >= 0 ? primaryIndex : undefined,
          tokenStandard: primary?.standard,
          tokenId: primary?.tokenId,
          // Carried through so the authored edge's identity key is
          // `${txHash}:sol:${transferIndex}` (edgeIdentityKey's solana branch),
          // matching what the fetch path produces — without it, a QuickAdd-authored
          // Solana edge never dedups against the same transfer added via Fetch History.
          ...(detail.solana ? { solana: detail.solana } : {}),
        };

        // Clear synchronously before callback to prevent double-submit
        setValue('');
        onResolveTransaction(prefill);
        setLoading(false);
      } catch (err: any) {
        // Ignore errors from aborted/superseded requests
        if (controller.signal.aborted) return;
        setError(err.message || 'Failed to fetch transaction');
        setLoading(false);
      } finally {
        // Clear the ref if this controller is still current
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
      return;
    }

    // kind === 'unknown'
    setError('Not a recognized address or transaction');
  }

  return (
    <div className="flex flex-col gap-1 bg-canvas/90 border border-canvas-line rounded-xl text-canvas-ink shadow-lg p-1.5 backdrop-blur">
      <div className="flex items-center gap-1.5">
        <ChainSelect {...chainSelectProps} />

        <div className="relative flex items-center w-[300px]">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
              // Abort any in-flight tx fetch when user edits the input
              if (abortRef.current) {
                abortRef.current.abort();
                abortRef.current = null;
                setLoading(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmedValue && !loading) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={disabled || loading}
            placeholder="Paste address, tx hash, or URL"
            className="w-full bg-canvas-fill border border-canvas-line rounded-lg text-canvas-ink placeholder:text-canvas-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 px-3 py-1.5 text-sm font-mono pr-8 disabled:opacity-50"
          />
          {loading && (
            <FaSpinner
              size={13}
              className="absolute right-2.5 text-canvas-muted animate-spin pointer-events-none"
            />
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 ml-0.5">{error}</p>
      )}
    </div>
  );
}
