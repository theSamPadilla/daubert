import { useState, useRef, useEffect } from 'react';
import { FaSpinner } from 'react-icons/fa6';
import { ChainSelect } from './ChainSelect';
import { inspectInput } from '../utils/addressParser';
import { apiClient } from '../lib/api-client';
import type { WalletNode, TransactionEdge } from '../types/investigation';

interface QuickAddInputProps {
  onResolveAddress: (prefill: Partial<WalletNode>) => void;
  onResolveTransaction: (prefill: Partial<TransactionEdge>) => void;
  investigationId?: string;  // used to reset state when investigation changes
  disabled?: boolean;
}

const CHAIN_OPTIONS = ['ethereum', 'arbitrum', 'base', 'polygon', 'tron'];

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

        // Token-transfer-first, native-tx fallback — load-bearing for tokenized txs.
        const primaryTransfer = detail.tokenTransfers[0];
        const token = primaryTransfer?.token || detail.token;
        const amount = primaryTransfer?.amount || detail.amount;
        const from = primaryTransfer?.from || detail.from;
        const to = primaryTransfer?.to || detail.to;

        const prefill: Partial<TransactionEdge> = {
          txHash: detail.txHash,
          from,
          to,
          chain: detail.chain,
          amount,
          token,
          timestamp: detail.timestamp,
          blockNumber: detail.blockNumber,
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
    <div className="flex flex-col gap-1 bg-gray-800/90 border border-gray-700 rounded-lg shadow-lg p-1.5 backdrop-blur-sm">
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
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono pr-8 disabled:opacity-50"
          />
          {loading && (
            <FaSpinner
              size={13}
              className="absolute right-2.5 text-gray-400 animate-spin pointer-events-none"
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
