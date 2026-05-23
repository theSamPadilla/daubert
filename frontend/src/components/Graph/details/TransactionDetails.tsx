import { useState, useRef } from 'react';
import { FaArrowUpRightFromSquare } from 'react-icons/fa6';
import { TransactionEdge, WalletNode } from '@/types/investigation';
import { CopyButton } from '@/components/Common/CopyButton';
import { formatTokenAmount, normalizeToken, parseTimestamp } from '@/utils/formatAmount';
import { buildTxExplorerUrl } from '@/utils/addressParser';

function resolveWalletDisplay(id: string, allWallets: { wallet: WalletNode; traceId: string }[]) {
  const match = allWallets.find((w) => w.wallet.id === id);
  if (match) {
    const addr = match.wallet.address;
    const truncated = addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
    return { label: match.wallet.label, address: truncated, fullAddress: addr };
  }
  // Fallback: treat as raw address
  const truncated = id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
  return { label: truncated, address: '', fullAddress: id };
}

const LINE_STYLES: { value: 'solid' | 'dashed' | 'dotted'; label: string; preview: string }[] = [
  { value: 'solid',  label: 'Solid',  preview: '——' },
  { value: 'dashed', label: 'Dashed', preview: '- -' },
  { value: 'dotted', label: 'Dotted', preview: '···' },
];

function TransactionHeader({
  transaction,
  onUpdate,
}: {
  transaction: TransactionEdge;
  onUpdate?: (updates: Partial<TransactionEdge>) => void;
}) {
  const tok = normalizeToken(transaction.token);
  const fallback = `${formatTokenAmount(transaction.amount, tok.decimals)} ${tok.symbol}`;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(transaction.label || '');

  const txId = transaction.id;
  const prevId = useRef(txId);
  if (prevId.current !== txId) {
    prevId.current = txId;
    setValue(transaction.label || '');
    setEditing(false);
  }

  const commit = () => {
    setEditing(false);
    const next = value.trim();
    const prev = transaction.label || '';
    if (next !== prev) onUpdate?.({ label: next || undefined });
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        placeholder={fallback}
        className="w-full bg-surface-raised/50 border border-brand rounded px-2 py-0.5 text-sm font-semibold text-ink placeholder-ink-faint focus:outline-none"
      />
    );
  }

  return (
    <p
      className={`text-sm font-semibold ${onUpdate ? 'cursor-pointer hover:text-brand transition-colors' : ''}`}
      onClick={() => onUpdate && setEditing(true)}
      title={onUpdate ? 'Click to rename' : undefined}
    >
      {transaction.label || fallback}
    </p>
  );
}

export function TransactionDetails({
  transaction,
  allWallets,
  onUpdate,
  onArcEdge,
}: {
  transaction: TransactionEdge;
  allWallets: { wallet: WalletNode; traceId: string }[];
  onUpdate?: (updates: Partial<TransactionEdge>) => void;
  onArcEdge?: (delta: number | null) => void;
}) {
  const fromDisplay = resolveWalletDisplay(transaction.from, allWallets);
  const toDisplay = resolveWalletDisplay(transaction.to, allWallets);
  const currentStyle = transaction.lineStyle || 'solid';
  const [notes, setNotes] = useState(transaction.notes || '');

  // Keep local state in sync when a different transaction is selected
  const txId = transaction.id;
  const prevTxId = useRef(txId);
  if (prevTxId.current !== txId) {
    prevTxId.current = txId;
    setNotes(transaction.notes || '');
  }

  return (
    <div className="space-y-3">
      <TransactionHeader transaction={transaction} onUpdate={onUpdate} />
      {transaction.usdValue && (
        <p className="text-xs text-ink-muted">${transaction.usdValue.toLocaleString()}</p>
      )}
      {transaction.chain && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Chain</h4>
          <p className="text-sm text-ink-muted capitalize">{transaction.chain}</p>
        </div>
      )}
      {transaction.txHash && (() => {
        const explorerUrl = buildTxExplorerUrl(transaction.chain, transaction.txHash);
        return (
          <div>
            <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Hash</h4>
            <div className="flex items-start gap-2">
              {explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-brand hover:text-brand break-all underline decoration-brand/30 hover:decoration-brand/60 transition-colors min-w-0"
                >
                  {transaction.txHash}
                  <FaArrowUpRightFromSquare size={10} className="shrink-0 opacity-60" />
                </a>
              ) : (
                <p className="text-xs font-mono text-ink-muted break-all min-w-0">{transaction.txHash}</p>
              )}
              <CopyButton text={transaction.txHash} title="Copy tx hash" />
            </div>
          </div>
        );
      })()}
      {onUpdate && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Line style</h4>
          <div className="flex gap-1.5">
            {LINE_STYLES.map(({ value, label, preview }) => (
              <button
                key={value}
                onClick={() => onUpdate({ lineStyle: value })}
                title={label}
                className={`flex-1 py-1 rounded text-xs font-mono transition-colors border ${
                  currentStyle === value
                    ? 'border-brand bg-brand/20 text-brand'
                    : 'border-line-strong text-ink-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {preview}
              </button>
            ))}
          </div>
        </div>
      )}
      {onArcEdge && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Arc</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onArcEdge(-40)}
              className="flex-1 py-1 rounded text-sm border border-line-strong text-ink-muted hover:border-line-strong hover:text-ink transition-colors"
              title="Arc left"
            >
              ◁
            </button>
            <button
              onClick={() => onArcEdge(null)}
              className="px-2 py-1 rounded text-xs border border-line-strong text-ink-faint hover:border-line-strong hover:text-ink-muted transition-colors"
              title="Reset arc"
            >
              Reset
            </button>
            <button
              onClick={() => onArcEdge(40)}
              className="flex-1 py-1 rounded text-sm border border-line-strong text-ink-muted hover:border-line-strong hover:text-ink transition-colors"
              title="Arc right"
            >
              ▷
            </button>
          </div>
        </div>
      )}
      <div>
        <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">From → To</h4>
        <p className="text-xs text-ink-muted">{fromDisplay.label}</p>
        {fromDisplay.address && (
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-mono text-ink-faint">{fromDisplay.address}</p>
            <CopyButton text={fromDisplay.fullAddress} />
          </div>
        )}
        <p className="text-xs text-ink-faint my-1">↓</p>
        <p className="text-xs text-ink-muted">{toDisplay.label}</p>
        {toDisplay.address && (
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-mono text-ink-faint">{toDisplay.address}</p>
            <CopyButton text={toDisplay.fullAddress} />
          </div>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Timestamp</h4>
        <p className="text-sm text-ink-muted">
          {parseTimestamp(transaction.timestamp).toLocaleString()}
        </p>
      </div>
      {transaction.tags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Tags</h4>
          <div className="flex flex-wrap gap-1">
            {transaction.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-surface-raised rounded text-xs">{tag}</span>
            ))}
          </div>
        </div>
      )}
      {transaction.links && transaction.links.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Links</h4>
          <div className="space-y-1">
            {transaction.links.map((link, i) => (
              <a
                key={i}
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-brand hover:text-brand underline decoration-brand/30 hover:decoration-brand/60 truncate transition-colors"
                title={link}
              >
                {link}
              </a>
            ))}
          </div>
        </div>
      )}
      <div>
        <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Notes</h4>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onBlur={() => { if (onUpdate && notes !== (transaction.notes || '')) onUpdate({ notes }); }}
          ref={(el) => {
            if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
          }}
          placeholder="Add notes…"
          rows={3}
          className="w-full bg-surface-raised/50 border border-line-strong rounded px-2 py-1.5 text-sm text-ink-muted placeholder-ink-faint focus:outline-none focus:border-brand resize-none overflow-hidden"
        />
      </div>
    </div>
  );
}
