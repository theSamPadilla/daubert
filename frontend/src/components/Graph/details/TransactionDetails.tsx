import { useState, useRef } from 'react';
import { FaArrowUpRightFromSquare } from 'react-icons/fa6';
import { TransactionEdge, WalletNode } from '@/types/investigation';
import { CopyButton } from '@/components/Common/CopyButton';
import { formatTokenAmount, normalizeToken, parseTimestamp } from '@/utils/formatAmount';
import { buildExplorerUrl, buildTxExplorerUrl } from '@/utils/addressParser';
import { truncateMiddle } from '@/utils/utxoDisplay';
import { UtxoBreakdown, ChangeBadge } from './UtxoBreakdown';
import { ChainLabel } from '@/components/Graph/ChainIcon';
import { TransferPicker } from './TransferPicker';

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

// Thickness presets in pixels. 2 matches the base edge width in cytoscapeStyle.ts.
export const THICKNESS_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Normal' },
  { value: 4, label: 'Thick' },
  { value: 6, label: 'Extra' },
  { value: 9, label: 'Heavy' },
];
export const DEFAULT_EDGE_WIDTH = 2;

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
        className="w-full bg-canvas-fill border border-brand rounded-lg px-2 py-0.5 text-sm font-semibold text-canvas-ink placeholder:text-canvas-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      />
    );
  }

  return (
    <p
      className={`text-sm font-semibold ${onUpdate ? 'cursor-pointer hover:text-accent transition-colors' : ''}`}
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
  onSelectTransfer,
}: {
  transaction: TransactionEdge;
  allWallets: { wallet: WalletNode; traceId: string }[];
  onUpdate?: (updates: Partial<TransactionEdge>) => void;
  onArcEdge?: (delta: number | null) => void;
  onSelectTransfer?: (index: number) => void;
}) {
  const fromDisplay = resolveWalletDisplay(transaction.from, allWallets);
  const toDisplay = resolveWalletDisplay(transaction.to, allWallets);
  const currentStyle = transaction.lineStyle || 'solid';
  const currentWidth = transaction.width ?? DEFAULT_EDGE_WIDTH;
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
        <p className="text-xs text-canvas-muted">${transaction.usdValue.toLocaleString()}</p>
      )}
      {transaction.chain && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Chain</h4>
          <ChainLabel chainId={transaction.chain} />
        </div>
      )}
      {transaction.txHash && (() => {
        const explorerUrl = buildTxExplorerUrl(transaction.chain, transaction.txHash);
        return (
          <div>
            <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Hash</h4>
            <div className="flex items-start gap-2">
              {explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-accent hover:text-canvas-ink break-all underline decoration-accent/40 hover:decoration-accent/70 transition-colors min-w-0"
                >
                  {transaction.txHash}
                  <FaArrowUpRightFromSquare size={10} className="shrink-0 opacity-60" />
                </a>
              ) : (
                <p className="text-xs font-mono text-canvas-muted break-all min-w-0">{transaction.txHash}</p>
              )}
              <CopyButton text={transaction.txHash} title="Copy tx hash" className="shrink-0 text-canvas-muted hover:text-canvas-ink transition-colors" />
            </div>
          </div>
        );
      })()}
      {onUpdate && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Line style</h4>
          <div className="flex gap-1.5">
            {LINE_STYLES.map(({ value, label, preview }) => (
              <button
                key={value}
                onClick={() => onUpdate({ lineStyle: value })}
                title={label}
                className={`flex-1 py-1 rounded-lg text-xs font-mono transition-colors border ${
                  currentStyle === value
                    ? 'border-brand bg-brand text-white'
                    : 'border-canvas-line text-canvas-muted hover:border-white/25 hover:text-canvas-ink'
                }`}
              >
                {preview}
              </button>
            ))}
          </div>
        </div>
      )}
      {onUpdate && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Thickness</h4>
          <div className="flex gap-1.5">
            {THICKNESS_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => onUpdate({ width: value })}
                title={label}
                className={`flex-1 py-2 rounded-lg transition-colors border flex items-center justify-center ${
                  currentWidth === value
                    ? 'border-brand bg-brand text-white'
                    : 'border-canvas-line text-canvas-muted hover:border-white/25 hover:text-canvas-ink'
                }`}
              >
                <span style={{ height: `${value}px` }} className="block w-6 rounded-full bg-current" />
              </button>
            ))}
          </div>
        </div>
      )}
      {onArcEdge && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Arc</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onArcEdge(-40)}
              className="flex-1 py-1 rounded-lg text-sm border border-canvas-line text-canvas-muted hover:border-white/25 hover:text-canvas-ink transition-colors"
              title="Arc left"
            >
              ◁
            </button>
            <button
              onClick={() => onArcEdge(null)}
              className="px-2 py-1 rounded-lg text-xs border border-canvas-line text-canvas-muted hover:border-white/25 hover:text-canvas-ink transition-colors"
              title="Reset arc"
            >
              Reset
            </button>
            <button
              onClick={() => onArcEdge(40)}
              className="flex-1 py-1 rounded-lg text-sm border border-canvas-line text-canvas-muted hover:border-white/25 hover:text-canvas-ink transition-colors"
              title="Arc right"
            >
              ▷
            </button>
          </div>
        </div>
      )}
      <div>
        <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">From → To</h4>
        <p className="text-xs text-canvas-muted">{fromDisplay.label}</p>
        {fromDisplay.address && (
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-mono text-canvas-muted">{fromDisplay.address}</p>
            <CopyButton text={fromDisplay.fullAddress} className="shrink-0 text-canvas-muted hover:text-canvas-ink transition-colors" />
          </div>
        )}
        <p className="text-xs text-canvas-muted my-1">↓</p>
        <p className="text-xs text-canvas-muted">{toDisplay.label}</p>
        {toDisplay.address && (
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-mono text-canvas-muted">{toDisplay.address}</p>
            <CopyButton text={toDisplay.fullAddress} className="shrink-0 text-canvas-muted hover:text-canvas-ink transition-colors" />
          </div>
        )}
      </div>
      <TransferPicker
        transfers={transaction.transfers}
        selectedIndex={transaction.selectedTransferIndex}
        onSelect={(index) => onSelectTransfer?.(index)}
      />
      {transaction.utxo && !transaction.utxo.legType && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">UTXO</h4>
          <UtxoBreakdown utxo={transaction.utxo} highlightVout={transaction.utxo.vout} />
        </div>
      )}
      {transaction.utxo?.legType && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">UTXO</h4>
          <p className="text-sm text-canvas-muted">
            Part of transaction{' '}
            <span className="font-mono text-canvas-ink">{truncateMiddle(transaction.txHash, 10, 6)}</span>
          </p>
          <p className="text-xs text-canvas-muted mt-1 flex items-center gap-1.5">
            {transaction.utxo.legType === 'input'
              ? `input leg #${transaction.utxo.legIndex}`
              : `output #${transaction.utxo.vout}`}
            {transaction.utxo.legType === 'output' && transaction.utxo.outputs[0]?.change && (
              <ChangeBadge evidence={transaction.utxo.outputs[0].changeEvidence} />
            )}
          </p>
        </div>
      )}
      {transaction.solana && (() => {
        const sol = transaction.solana;
        const feePayerUrl = buildExplorerUrl('solana', sol.feePayer);
        return (
          <div>
            <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Solana</h4>
            <div className="space-y-2 rounded-lg bg-canvas-fill px-2 py-2">
              <div>
                <h5 className="text-[10px] font-semibold text-canvas-muted uppercase mb-0.5">Fee payer</h5>
                <div className="flex items-center gap-1.5">
                  {feePayerUrl ? (
                    <a
                      href={feePayerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-mono text-accent hover:text-canvas-ink truncate underline decoration-accent/40 hover:decoration-accent/70 transition-colors"
                    >
                      {truncateMiddle(sol.feePayer)}
                    </a>
                  ) : (
                    <span className="text-[11px] font-mono text-canvas-muted truncate">{truncateMiddle(sol.feePayer)}</span>
                  )}
                  <CopyButton text={sol.feePayer} title="Copy fee payer" className="shrink-0 text-canvas-muted hover:text-canvas-ink transition-colors" />
                </div>
              </div>

              {(sol.source || sol.type) && (
                <div className="flex items-center gap-3 text-[11px] text-canvas-muted">
                  {sol.source && <span>Program: <span className="text-canvas-ink">{sol.source}</span></span>}
                  {sol.type && <span>Type: <span className="text-canvas-ink">{sol.type}</span></span>}
                </div>
              )}

              {sol.kind === 'spl' && sol.mint && (
                <div>
                  <h5 className="text-[10px] font-semibold text-canvas-muted uppercase mb-0.5">Mint</h5>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono text-canvas-muted truncate">{truncateMiddle(sol.mint)}</span>
                    <CopyButton text={sol.mint} title="Copy mint" className="shrink-0 text-canvas-muted hover:text-canvas-ink transition-colors" />
                  </div>
                </div>
              )}

              {sol.kind === 'spl' && (sol.fromTokenAccount || sol.toTokenAccount) && (
                <div>
                  <h5 className="text-[10px] font-semibold text-canvas-muted uppercase mb-0.5">Token accounts</h5>
                  <div className="space-y-1">
                    {sol.fromTokenAccount && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-canvas-muted w-8 shrink-0">From</span>
                        <span className="text-[11px] font-mono text-canvas-muted truncate">{truncateMiddle(sol.fromTokenAccount)}</span>
                        <CopyButton text={sol.fromTokenAccount} title="Copy from token account" className="shrink-0 text-canvas-muted hover:text-canvas-ink transition-colors" />
                      </div>
                    )}
                    {sol.toTokenAccount && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-canvas-muted w-8 shrink-0">To</span>
                        <span className="text-[11px] font-mono text-canvas-muted truncate">{truncateMiddle(sol.toTokenAccount)}</span>
                        <CopyButton text={sol.toTokenAccount} title="Copy to token account" className="shrink-0 text-canvas-muted hover:text-canvas-ink transition-colors" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {sol.spamEvidence && sol.spamEvidence.length > 0 && (
                <div>
                  <h5 className="text-[10px] font-semibold text-canvas-muted uppercase mb-0.5">Spam heuristics</h5>
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        sol.spam
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-canvas-fill text-canvas-muted'
                      }`}
                    >
                      {sol.spam ? 'Flagged' : 'Not flagged'}
                    </span>
                    {sol.spamEvidence.map((ev, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-canvas-fill text-canvas-muted">
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-canvas-muted">Transfer #{sol.transferIndex}</p>
            </div>
          </div>
        );
      })()}
      <div>
        <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Timestamp</h4>
        <p className="text-sm text-canvas-muted">
          {parseTimestamp(transaction.timestamp).toLocaleString()}
        </p>
      </div>
      {transaction.tags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Tags</h4>
          <div className="flex flex-wrap gap-1">
            {transaction.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-canvas-fill rounded text-xs">{tag}</span>
            ))}
          </div>
        </div>
      )}
      {transaction.links && transaction.links.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Links</h4>
          <div className="space-y-1">
            {transaction.links.map((link, i) => (
              <a
                key={i}
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-accent hover:text-canvas-ink underline decoration-accent/40 hover:decoration-accent/70 truncate transition-colors"
                title={link}
              >
                {link}
              </a>
            ))}
          </div>
        </div>
      )}
      <div>
        <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Notes</h4>
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
          className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-2 py-1.5 text-sm text-canvas-ink placeholder:text-canvas-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 resize-none overflow-hidden"
        />
      </div>
    </div>
  );
}
