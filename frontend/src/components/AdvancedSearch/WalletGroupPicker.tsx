'use client';

import { useState, useMemo, useEffect } from 'react';
import { FaLayerGroup, FaWallet, FaPlus, FaXmark } from 'react-icons/fa6';
import { Investigation, Trace, WalletNode, Group } from '../../types/investigation';
import { useLabeledEntities } from '@/hooks/useLabeledEntities';
import { ADDRESS_RE, normalizeAddressForChain } from '../../generated/shared/address';

const MAX_WALLETS = 25;

type PickerValue = { traceId?: string; groupId?: string; wallets?: string[] };

type Mode = 'selector' | 'wallets' | 'address';

type Props = {
  label: string;
  investigation: Investigation;
  chain: string;
  value: PickerValue;
  onChange: (next: PickerValue) => void;
};

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletGroupPicker({ label, investigation, chain, value, onChange }: Props) {
  const { lookupAddress } = useLabeledEntities();

  // Derive initial mode from value
  const initialMode: Mode = (value.traceId != null || value.groupId != null) ? 'selector' : 'wallets';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [walletSearch, setWalletSearch] = useState('');

  // Sync mode when value is driven externally (e.g. parent resets to {}).
  useEffect(() => {
    if (value.traceId != null || value.groupId != null) {
      setMode('selector');
    }
  }, [value.traceId, value.groupId]);

  // Traces that have at least one node on the selected chain
  const filteredTraces: Trace[] = useMemo(
    () => investigation.traces.filter((t) => t.nodes.some((n) => n.chain === chain)),
    [investigation.traces, chain],
  );

  // Groups across all traces that have at least one member node on the selected chain.
  const filteredGroups: Array<{ group: Group; trace: Trace }> = useMemo(() => {
    const result: Array<{ group: Group; trace: Trace }> = [];
    for (const trace of investigation.traces) {
      for (const group of trace.groups ?? []) {
        const hasChain = trace.nodes.some((n) => n.chain === chain && n.groupId === group.id);
        if (hasChain) result.push({ group, trace });
      }
    }
    return result;
  }, [investigation.traces, chain]);

  // All wallets across all traces filtered by chain, then by search query
  const allChainNodes: Array<{ node: WalletNode; trace: Trace }> = useMemo(() => {
    const result: Array<{ node: WalletNode; trace: Trace }> = [];
    for (const trace of investigation.traces) {
      for (const node of trace.nodes) {
        if (node.chain === chain) result.push({ node, trace });
      }
    }
    return result;
  }, [investigation.traces, chain]);

  const filteredNodes = useMemo(() => {
    if (!walletSearch.trim()) return allChainNodes;
    const q = walletSearch.toLowerCase();
    return allChainNodes.filter(({ node }) => {
      const entity = lookupAddress(node.address);
      const truncAddr = truncateAddress(node.address);
      const customLabel =
        node.label && node.label !== node.address && node.label !== truncAddr ? node.label : undefined;
      const displayName = entity?.name ?? customLabel ?? '';
      return displayName.toLowerCase().includes(q) || node.address.toLowerCase().includes(q);
    });
  }, [allChainNodes, walletSearch, lookupAddress]);

  const handleModeSwitch = (next: Mode) => {
    setMode(next);
    onChange({});
    setWalletSearch('');
  };

  const selectorDisabled = filteredTraces.length === 0 && filteredGroups.length === 0;

  const selectorOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [];
    for (const trace of filteredTraces) {
      opts.push({ value: `trace:${trace.id}`, label: trace.name });
      const traceGroups = filteredGroups.filter(({ trace: gt }) => gt.id === trace.id);
      for (const { group } of traceGroups) {
        opts.push({ value: `group:${group.id}`, label: `${trace.name} → ${group.name}` });
      }
    }
    return opts;
  }, [filteredTraces, filteredGroups]);

  const currentSelectorValue = value.traceId
    ? `trace:${value.traceId}`
    : value.groupId
    ? `group:${value.groupId}`
    : '';

  const handleSelectorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (!v) {
      onChange({});
      return;
    }
    const [kind, id] = v.split(':');
    if (kind === 'trace') onChange({ traceId: id });
    else if (kind === 'group') onChange({ groupId: id });
  };

  const selectedWallets = new Set(value.wallets ?? []);
  const atCap = selectedWallets.size >= MAX_WALLETS;

  const toggleWallet = (address: string) => {
    const normalized = normalizeAddressForChain(address, chain);
    const next = new Set(selectedWallets);
    if (next.has(normalized)) {
      next.delete(normalized);
    } else {
      if (next.size >= MAX_WALLETS) return;
      next.add(normalized);
    }
    onChange(next.size > 0 ? { wallets: [...next] } : {});
  };

  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden flex flex-col">
      {/* Card header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-line bg-surface-raised/30 shrink-0">
        <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{label}</span>

        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 bg-surface rounded-lg p-0.5 border border-line">
          <button
            type="button"
            onClick={() => handleModeSwitch('selector')}
            disabled={selectorDisabled}
            title={selectorDisabled ? 'No traces or groups with wallets on this chain.' : undefined}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === 'selector' ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <FaLayerGroup className="w-3 h-3" />
            By trace/group
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('wallets')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              mode === 'wallets' ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <FaWallet className="w-3 h-3" />
            By wallets
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('address')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              mode === 'address' ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <FaPlus className="w-3 h-3" />
            Address
          </button>
        </div>
      </div>

      {/* Card body */}
      <div className="px-3 py-2.5 flex-1 min-h-0">
        {mode === 'selector' && (
          <TraceGroupPicker
            options={selectorOptions}
            value={currentSelectorValue}
            onSelect={handleSelectorChange}
          />
        )}
        {mode === 'wallets' && (
          <WalletChecklist
            nodes={filteredNodes}
            selected={selectedWallets}
            chain={chain}
            atCap={atCap}
            search={walletSearch}
            onSearchChange={setWalletSearch}
            onToggle={toggleWallet}
            lookupAddress={lookupAddress}
          />
        )}
        {mode === 'address' && (
          <AddressInput
            selected={selectedWallets}
            chain={chain}
            atCap={atCap}
            onToggle={toggleWallet}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface TraceGroupPickerProps {
  options: Array<{ value: string; label: string }>;
  value: string;
  onSelect: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

function TraceGroupPicker({ options, value, onSelect }: TraceGroupPickerProps) {
  if (options.length === 0) {
    return (
      <p className="text-xs text-ink-faint italic py-1">
        No traces or groups with wallets on this chain.
      </p>
    );
  }

  return (
    <div>
      <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">Trace or group</label>
      <select
        value={value}
        onChange={onSelect}
        className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <option value="">— Select —</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface WalletChecklistProps {
  nodes: Array<{ node: WalletNode; trace: Trace }>;
  selected: Set<string>;
  chain: string;
  atCap: boolean;
  search: string;
  onSearchChange: (q: string) => void;
  onToggle: (address: string) => void;
  lookupAddress: (address: string) => { name: string } | undefined;
}

function WalletChecklist({ nodes, selected, chain, atCap, search, onSearchChange, onToggle, lookupAddress }: WalletChecklistProps) {
  return (
    <div className="flex flex-col gap-1">
      {/* Search box */}
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Filter investigation wallets…"
        className="w-full bg-surface border border-line-strong rounded-lg px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 mb-1"
      />

      <div className="flex items-center justify-between mb-0.5">
        <label className="text-xs font-semibold text-ink-muted uppercase">Wallets</label>
        {atCap && (
          <span className="text-xs text-amber-600 font-medium">
            Max {MAX_WALLETS} wallets per side.
          </span>
        )}
      </div>

      {nodes.length === 0 ? (
        <p className="text-xs text-ink-faint italic py-1">
          {search ? 'No wallets match your filter.' : 'No wallets on this chain.'}
        </p>
      ) : (
        <div className="overflow-y-auto max-h-44 space-y-0.5 pr-0.5">
          {nodes.map(({ node, trace }) => {
            const normalized = normalizeAddressForChain(node.address, chain);
            const isChecked = selected.has(normalized);
            const isDisabled = atCap && !isChecked;
            const truncAddr = truncateAddress(node.address);
            const entity = lookupAddress(node.address);
            const customLabel =
              node.label && node.label !== node.address && node.label !== truncAddr
                ? node.label
                : undefined;
            const displayName = entity?.name ?? customLabel;

            return (
              <label
                key={node.id}
                className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs cursor-pointer transition-colors select-none ${
                  isDisabled
                    ? 'opacity-40 cursor-not-allowed'
                    : isChecked
                    ? 'bg-brand/10 hover:bg-brand/15'
                    : 'hover:bg-surface-raised/60'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isDisabled}
                  onChange={() => !isDisabled && onToggle(node.address)}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-brand shrink-0"
                />
                <span className="flex-1 min-w-0 flex flex-col gap-0">
                  <span className="flex items-center gap-1 min-w-0">
                    {displayName ? (
                      <span className="text-ink font-medium truncate">{displayName}</span>
                    ) : (
                      <span className="text-ink font-mono truncate">{truncAddr}</span>
                    )}
                    <span className="text-ink-faint text-[10px] shrink-0 ml-auto font-mono">
                      {displayName ? truncAddr : ''}
                    </span>
                  </span>
                  <span className="text-ink-faint text-[10px] truncate">{trace.name}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-ink-faint mt-0.5">
        {selected.size} / {MAX_WALLETS} selected
      </p>
    </div>
  );
}

interface AddressInputProps {
  selected: Set<string>;
  chain: string;
  atCap: boolean;
  onToggle: (address: string) => void;
}

function AddressInput({ selected, chain, atCap, onToggle }: AddressInputProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const raw = input.trim();
    if (!raw) return;
    if (!ADDRESS_RE.test(raw)) {
      setError('Invalid address. Expecting 0x… (EVM) or T… (Tron).');
      return;
    }
    const normalized = normalizeAddressForChain(raw, chain);
    if (selected.has(normalized)) {
      setError('Address already added.');
      return;
    }
    if (atCap) {
      setError(`Already at ${MAX_WALLETS}-address cap.`);
      return;
    }
    onToggle(raw);
    setInput('');
    setError(null);
  };

  const addresses = [...selected];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          placeholder="Paste an address…"
          autoFocus
          className="flex-1 bg-surface border border-line-strong rounded-lg px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!input.trim() || atCap}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
      </div>
      {error && <p className="text-[10px] text-redline">{error}</p>}

      {addresses.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {addresses.map((addr) => (
            <span
              key={addr}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-brand/10 text-brand text-[10px] font-mono"
            >
              {truncateAddress(addr)}
              <button
                type="button"
                onClick={() => onToggle(addr)}
                className="hover:text-redline transition-colors"
                aria-label={`Remove ${addr}`}
              >
                <FaXmark className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="text-[10px] text-ink-faint mt-0.5">
        {addresses.length} / {MAX_WALLETS} added
      </p>
    </div>
  );
}
