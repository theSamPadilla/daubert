import { useState, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { FaXmark, FaChevronDown, FaChevronRight, FaArrowUpRightFromSquare, FaArrowRightToBracket, FaArrowRightFromBracket } from 'react-icons/fa6';
import { CopyButton } from '@/components/Common/CopyButton';
import { WalletNode, TransactionEdge, Trace, Group, EdgeBundle } from '@/types/investigation';
import { type ScriptRun } from '@/lib/api-client';
import { WalletForm } from '@/components/Forms/WalletForm';
import { TransactionForm } from '@/components/Forms/TransactionForm';
import { TraceForm } from '@/components/Forms/TraceForm';
import { formatTokenAmount, normalizeToken, parseTimestamp } from '@/utils/formatAmount';
import { buildTxExplorerUrl } from '@/utils/addressParser';
import { useLabeledEntities } from '@/hooks/useLabeledEntities';
import { MultiTxDetails } from './MultiTxDetails';
import { GroupColorPicker } from '@/components/Common/GroupColorPicker';

interface EdgeBundleDetailsProps {
  bundle: EdgeBundle;
  traces: Trace[];
  onToggle: () => void;
  onDelete: () => void;
  onUpdate?: (updates: Partial<EdgeBundle>) => void;
  onArcEdge?: (delta: number | null) => void;
}

function EdgeBundleDetails({ bundle, traces, onToggle, onDelete, onUpdate, onArcEdge }: EdgeBundleDetailsProps) {
  const trace = traces.find((t) => t.id === bundle.traceId);
  const fromNode = trace?.nodes.find((n) => n.id === bundle.fromNodeId);
  const toNode = trace?.nodes.find((n) => n.id === bundle.toNodeId);
  const bundleEdges = bundle.edgeIds
    .map((id) => trace?.edges.find((e) => e.id === id))
    .filter(Boolean) as TransactionEdge[];

  const fromLabel = fromNode?.label || bundle.fromNodeId.slice(0, 8) + '…';
  const toLabel = toNode?.label || bundle.toNodeId.slice(0, 8) + '…';
  const staticTitle = `${fromLabel} → ${toLabel}`;

  // Derive the display token from actual edges (bundle.token may be stale/wrong)
  const displayToken = bundleEdges.length > 0 ? normalizeToken(bundleEdges[0].token).symbol : bundle.token;

  return (
    <MultiTxDetails
      key={bundle.id}
      edges={bundleEdges}
      staticTitle={staticTitle}
      editableLabel={onUpdate ? {
        value: bundle.label || '',
        onChange: (next) => onUpdate({ label: next || undefined }),
      } : undefined}
      headerKind="bundle"
      tokenChip={displayToken}
      onColorChange={onUpdate ? (c) => onUpdate({ color: c }) : undefined}
      color={bundle.color}
      onArcEdge={onArcEdge && bundle.collapsed ? onArcEdge : undefined}
      actions={
        <div className="flex gap-2 pt-1">
          <button
            onClick={onToggle}
            className="flex-1 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 rounded text-xs font-medium transition-colors"
          >
            {bundle.collapsed ? 'Expand bundle' : 'Collapse bundle'}
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-xs transition-colors"
          >
            Unbundle
          </button>
        </div>
      }
    />
  );
}

interface AggregatedEdgeDetailsProps {
  edges: TransactionEdge[];
  fromLabel: string;
  toLabel: string;
  traceId: string;
  onArcEdge?: (delta: number | null) => void;
}

function AggregatedEdgeDetails({ edges, fromLabel, toLabel, onArcEdge }: AggregatedEdgeDetailsProps) {
  return (
    <MultiTxDetails
      edges={edges}
      staticTitle={`${fromLabel} → ${toLabel}`}
      headerKind="aggregated"
      tokenChip={null}
      onArcEdge={onArcEdge}
    />
  );
}

interface DetailsPanelProps {
  selectedItem: any | null;
  traces: Trace[];
  allWallets: { wallet: WalletNode; traceId: string }[];
  onUpdateWallet: (traceId: string, walletId: string, updates: Partial<WalletNode>) => void;
  onDeleteWallet: (traceId: string, walletId: string) => void;
  onUpdateTransaction: (traceId: string, txId: string, updates: Partial<TransactionEdge>) => void;
  onDeleteTransaction: (traceId: string, txId: string) => void;
  onUpdateTrace: (traceId: string, updates: Partial<Trace>) => void;
  onDeleteTrace: (traceId: string) => void;
  onUpdateGroup: (traceId: string, groupId: string, updates: Partial<Group>) => void;
  onDeleteGroup: (traceId: string, groupId: string) => void;
  onSetNodeGroup: (traceId: string, nodeIds: string[], groupId: string | null) => void;
  onFetchHistory: (address: string, chain: string) => void;
  onBundleAllOutbound?: (walletId: string, color: string) => void;
  onDeleteAllOutbound?: (walletId: string) => void;
  onBundleAllInbound?: (walletId: string, color: string) => void;
  onDeleteAllInbound?: (walletId: string) => void;
  onRerunScript?: (scriptRunId: string) => Promise<void>;
  onToggleEdgeBundle?: (traceId: string, bundleId: string) => void;
  onUpdateEdgeBundle?: (traceId: string, bundleId: string, updates: Partial<EdgeBundle>) => void;
  onDeleteEdgeBundle?: (traceId: string, bundleId: string) => void;
  onArcEdge?: (edgeId: string, delta: number | null) => void;
}

const ADDRESS_TYPE_LABELS: Record<string, string> = {
  wallet: 'Wallet',
  contract: 'Contract',
  unknown: 'Unknown',
};

const ADDRESS_TYPE_COLORS: Record<string, string> = {
  wallet: 'bg-brand/20 text-brand',
  contract: 'bg-purple-500/20 text-purple-300',
  unknown: 'bg-surface-raised/50 text-ink-muted',
};

const NODE_SHAPES: { value: WalletNode['shape']; label: string; icon: string }[] = [
  { value: 'ellipse',        label: 'Circle',   icon: '⬤' },
  { value: 'rectangle',      label: 'Rect',     icon: '▬' },
  { value: 'roundrectangle', label: 'Round',    icon: '▢' },
  { value: 'diamond',        label: 'Diamond',  icon: '◆' },
  { value: 'hexagon',        label: 'Hex',      icon: '⬡' },
  { value: 'triangle',       label: 'Triangle', icon: '▲' },
];

function getCategoryStyle(category: string): string {
  switch (category) {
    case 'exchange': return 'bg-blue-900/50 text-blue-300';
    case 'mixer': return 'bg-red-900/50 text-red-300';
    case 'bridge': return 'bg-purple-900/50 text-purple-300';
    case 'protocol': return 'bg-green-900/50 text-green-300';
    case 'individual': return 'bg-yellow-900/50 text-yellow-300';
    case 'contract': return 'bg-cyan-900/50 text-cyan-300';
    case 'government': return 'bg-orange-900/50 text-orange-300';
    case 'custodian': return 'bg-indigo-900/50 text-indigo-300';
    default: return 'bg-surface-raised text-ink-muted';
  }
}

const BUNDLE_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // green
  '#f97316', // orange
  '#8b5cf6', // purple
  '#eab308', // yellow
];

function WalletDetails({
  wallet,
  onFetchHistory,
  onBundleAllOutbound,
  onDeleteAllOutbound,
  onBundleAllInbound,
  onDeleteAllInbound,
  onUpdate,
  lookupAddress,
}: {
  wallet: WalletNode;
  onFetchHistory: (address: string, chain: string) => void;
  onBundleAllOutbound?: (walletId: string, color: string) => void;
  onDeleteAllOutbound?: (walletId: string) => void;
  onBundleAllInbound?: (walletId: string, color: string) => void;
  onDeleteAllInbound?: (walletId: string) => void;
  onUpdate?: (updates: Partial<WalletNode>) => void;
  lookupAddress: (address: string) => import('@/lib/api-client').LabeledEntity | undefined;
}) {
  const hasAddress = !!wallet.address;
  const addrType = wallet.addressType || 'unknown';
  const [notes, setNotes] = useState(wallet.notes || '');
  const [pickingBundleColor, setPickingBundleColor] = useState(false);
  const [confirmDeleteOutbound, setConfirmDeleteOutbound] = useState(false);
  const [pickingInboundBundleColor, setPickingInboundBundleColor] = useState(false);
  const [confirmDeleteInbound, setConfirmDeleteInbound] = useState(false);

  const walletId = wallet.id;
  const prevWalletId = useRef(walletId);
  if (prevWalletId.current !== walletId) {
    prevWalletId.current = walletId;
    setNotes(wallet.notes || '');
    setPickingBundleColor(false);
    setConfirmDeleteOutbound(false);
    setPickingInboundBundleColor(false);
    setConfirmDeleteInbound(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-ink-muted uppercase">{hasAddress ? 'Address' : 'Node'}</h4>
        {hasAddress && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ADDRESS_TYPE_COLORS[addrType]}`}>
            {ADDRESS_TYPE_LABELS[addrType]}
          </span>
        )}
      </div>
      <p className="text-sm font-semibold">{wallet.label}</p>
      {hasAddress && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Address</h4>
          <div className="flex items-start gap-1.5">
            {wallet.explorerUrl ? (
              <a
                href={wallet.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-brand hover:text-brand break-all underline decoration-brand/30 hover:decoration-brand/60 transition-colors"
              >
                {wallet.address}
              </a>
            ) : (
              <p className="text-xs font-mono text-ink-muted break-all">{wallet.address}</p>
            )}
            <CopyButton text={wallet.address} />
          </div>
          {(() => {
            const matchedEntity = lookupAddress(wallet.address);
            if (!matchedEntity) return null;
            return (
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getCategoryStyle(matchedEntity.category)}`}>
                  {matchedEntity.category}
                </span>
                <span className="text-sm text-ink-muted">{matchedEntity.name}</span>
              </div>
            );
          })()}
        </div>
      )}
      {hasAddress && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Chain</h4>
          <p className="text-sm text-ink-muted">{wallet.chain}</p>
        </div>
      )}
      {wallet.tags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Tags</h4>
          <div className="flex flex-wrap gap-1">
            {wallet.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-surface-raised rounded text-xs">{tag}</span>
            ))}
          </div>
        </div>
      )}
      {onUpdate && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Shape</h4>
          <div className="grid grid-cols-3 gap-1">
            {NODE_SHAPES.map(({ value, label, icon }) => (
              <button
                key={value}
                onClick={() => onUpdate({ shape: value })}
                title={label}
                className={`py-1.5 rounded text-xs transition-colors border flex flex-col items-center gap-0.5 ${
                  (wallet.shape || 'ellipse') === value
                    ? 'border-brand bg-brand/20 text-brand'
                    : 'border-line-strong text-ink-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                <span className="text-base leading-none">{icon}</span>
                <span className="text-[10px]">{label}</span>
              </button>
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
          onBlur={() => { if (onUpdate && notes !== (wallet.notes || '')) onUpdate({ notes }); }}
          ref={(el) => {
            if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
          }}
          placeholder="Add notes…"
          rows={3}
          className="w-full bg-surface-raised/50 border border-line-strong rounded px-2 py-1.5 text-sm text-ink-muted placeholder-ink-faint focus:outline-none focus:border-brand resize-none overflow-hidden"
        />
      </div>
      {hasAddress && (
        <div className="pt-2 border-t border-line-strong space-y-1.5">
          <button
            onClick={() => onFetchHistory(wallet.address, wallet.chain)}
            className="w-full px-3 py-1.5 bg-surface-raised hover:bg-surface-raised/80 rounded text-sm transition-colors text-left"
          >
            Fetch Transactions
          </button>
          {/* Bundle row */}
          {(onBundleAllInbound || onBundleAllOutbound) && !pickingInboundBundleColor && !pickingBundleColor && (
            <div className="grid grid-cols-2 gap-1.5">
              {onBundleAllInbound && (
                <button
                  onClick={() => setPickingInboundBundleColor(true)}
                  className="px-3 py-1.5 bg-surface-raised hover:bg-emerald-900/40 hover:text-emerald-300 rounded text-sm transition-colors flex items-center justify-center gap-1.5 border border-emerald-500/30"
                >
                  <FaArrowRightToBracket className="text-emerald-400" />
                  <span>Bundle IN</span>
                </button>
              )}
              {onBundleAllOutbound && (
                <button
                  onClick={() => setPickingBundleColor(true)}
                  className="px-3 py-1.5 bg-surface-raised hover:bg-amber-900/40 hover:text-amber-300 rounded text-sm transition-colors flex items-center justify-center gap-1.5 border border-amber-500/30"
                >
                  <FaArrowRightFromBracket className="text-amber-400" />
                  <span>Bundle OUT</span>
                </button>
              )}
            </div>
          )}
          {onBundleAllInbound && pickingInboundBundleColor && (
            <div className="w-full px-3 py-1.5 bg-surface-raised rounded text-sm flex items-center gap-2 border border-emerald-500/30">
              <FaArrowRightToBracket className="text-emerald-400" />
              <span className="text-emerald-300 text-xs font-medium">IN color:</span>
              <div className="flex items-center gap-1.5 flex-1">
                {BUNDLE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      onBundleAllInbound(wallet.id, c);
                      setPickingInboundBundleColor(false);
                    }}
                    className="w-5 h-5 rounded-full border-2 border-transparent hover:border-white transition-transform hover:scale-110"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                onClick={() => setPickingInboundBundleColor(false)}
                className="text-ink-muted hover:text-ink text-xs"
                title="Cancel"
              >
                <FaXmark />
              </button>
            </div>
          )}
          {onBundleAllOutbound && pickingBundleColor && (
            <div className="w-full px-3 py-1.5 bg-surface-raised rounded text-sm flex items-center gap-2 border border-amber-500/30">
              <FaArrowRightFromBracket className="text-amber-400" />
              <span className="text-amber-300 text-xs font-medium">OUT color:</span>
              <div className="flex items-center gap-1.5 flex-1">
                {BUNDLE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      onBundleAllOutbound(wallet.id, c);
                      setPickingBundleColor(false);
                    }}
                    className="w-5 h-5 rounded-full border-2 border-transparent hover:border-white transition-transform hover:scale-110"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                onClick={() => setPickingBundleColor(false)}
                className="text-ink-muted hover:text-ink text-xs"
                title="Cancel"
              >
                <FaXmark />
              </button>
            </div>
          )}

          {/* Delete row */}
          {(onDeleteAllInbound || onDeleteAllOutbound) && !confirmDeleteInbound && !confirmDeleteOutbound && (
            <div className="grid grid-cols-2 gap-1.5">
              {onDeleteAllInbound && (
                <button
                  onClick={() => setConfirmDeleteInbound(true)}
                  className="px-3 py-1.5 bg-surface-raised hover:bg-red-900/40 hover:text-red-300 rounded text-sm transition-colors flex items-center justify-center gap-1.5 border border-emerald-500/30"
                >
                  <FaArrowRightToBracket className="text-emerald-400" />
                  <span>Delete IN</span>
                </button>
              )}
              {onDeleteAllOutbound && (
                <button
                  onClick={() => setConfirmDeleteOutbound(true)}
                  className="px-3 py-1.5 bg-surface-raised hover:bg-red-900/40 hover:text-red-300 rounded text-sm transition-colors flex items-center justify-center gap-1.5 border border-amber-500/30"
                >
                  <FaArrowRightFromBracket className="text-amber-400" />
                  <span>Delete OUT</span>
                </button>
              )}
            </div>
          )}
          {onDeleteAllInbound && confirmDeleteInbound && (
            <div className="w-full px-3 py-1.5 bg-surface-raised rounded text-sm flex items-center gap-2 border border-emerald-500/30">
              <FaArrowRightToBracket className="text-emerald-400 shrink-0" />
              <span className="text-ink-muted text-xs flex-1">Delete all <span className="text-emerald-300 font-medium">INBOUND</span> transactions?</span>
              <button
                onClick={() => {
                  onDeleteAllInbound(wallet.id);
                  setConfirmDeleteInbound(false);
                }}
                className="text-[11px] px-2 py-0.5 bg-red-600 hover:bg-red-500 rounded text-white"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDeleteInbound(false)}
                className="text-[11px] text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          )}
          {onDeleteAllOutbound && confirmDeleteOutbound && (
            <div className="w-full px-3 py-1.5 bg-surface-raised rounded text-sm flex items-center gap-2 border border-amber-500/30">
              <FaArrowRightFromBracket className="text-amber-400 shrink-0" />
              <span className="text-ink-muted text-xs flex-1">Delete all <span className="text-amber-300 font-medium">OUTBOUND</span> transactions?</span>
              <button
                onClick={() => {
                  onDeleteAllOutbound(wallet.id);
                  setConfirmDeleteOutbound(false);
                }}
                className="text-[11px] px-2 py-0.5 bg-red-600 hover:bg-red-500 rounded text-white"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDeleteOutbound(false)}
                className="text-[11px] text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

const LINE_STYLES: { value: 'solid' | 'dashed' | 'dotted'; label: string; preview: string }[] = [
  { value: 'solid',  label: 'Solid',  preview: '——' },
  { value: 'dashed', label: 'Dashed', preview: '- -' },
  { value: 'dotted', label: 'Dotted', preview: '···' },
];

function TransactionDetails({
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

function fmtFlow(amount: number): string {
  if (amount >= 1e12) return `${(amount / 1e12).toFixed(2).replace(/\.?0+$/, '')}T`;
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2).replace(/\.?0+$/, '')}K`;
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function GroupDetails({
  group,
  traces,
  onUpdate,
  onDelete,
  onSetNodeGroup,
}: {
  group: Group;
  traces: Trace[];
  onUpdate: (updates: Partial<Group>) => void;
  onDelete: () => void;
  onSetNodeGroup: (traceId: string, nodeIds: string[], groupId: string | null) => void;
}) {
  const [name, setName] = useState(group.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [view, setView] = useState<'members' | 'flows'>('members');

  const trace = traces.find((t) => t.id === group.traceId);
  const members = useMemo(
    () => trace?.nodes.filter((n) => n.groupId === group.id) || [],
    [trace, group.id]
  );
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  // Aggregate external flows for the Flows tab
  const { inflows, outflows } = useMemo(() => {
    if (!trace) return { inflows: [] as any[], outflows: [] as any[] };
    type Entry = { label: string; symbol: string; amount: number; usd: number };
    const inMap = new Map<string, Entry>();
    const outMap = new Map<string, Entry>();

    for (const edge of trace.edges) {
      const fromIn = memberIds.has(edge.from);
      const toIn = memberIds.has(edge.to);
      if (fromIn === toIn) continue;

      const tok = normalizeToken(edge.token);
      const raw = parseFloat(String(edge.amount)) || 0;
      const human = tok.decimals > 0 ? raw / Math.pow(10, tok.decimals) : raw;
      const usd = edge.usdValue || 0;

      if (!fromIn && toIn) {
        const ext = trace.nodes.find((n) => n.id === edge.from);
        const key = `${edge.from}::${tok.symbol}`;
        const existing = inMap.get(key);
        if (existing) { existing.amount += human; existing.usd += usd; }
        else inMap.set(key, { label: ext?.label || ext?.address || edge.from, symbol: tok.symbol, amount: human, usd });
      } else {
        const ext = trace.nodes.find((n) => n.id === edge.to);
        const key = `${edge.to}::${tok.symbol}`;
        const existing = outMap.get(key);
        if (existing) { existing.amount += human; existing.usd += usd; }
        else outMap.set(key, { label: ext?.label || ext?.address || edge.to, symbol: tok.symbol, amount: human, usd });
      }
    }
    return { inflows: [...inMap.values()], outflows: [...outMap.values()] };
  }, [trace, memberIds]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-ink-muted uppercase">Subgroup</h4>
        <button
          onClick={() => onUpdate({ collapsed: !group.collapsed })}
          className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors"
          title={group.collapsed ? 'Expand group in graph' : 'Collapse group in graph'}
        >
          {group.collapsed
            ? <><FaChevronRight size={9} /> Expand</>
            : <><FaChevronDown size={9} /> Collapse</>}
        </button>
      </div>

      {/* Name */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name !== group.name) onUpdate({ name: name.trim() }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full bg-surface-raised border border-line-strong rounded px-2 py-1 text-sm text-ink focus:outline-none focus:border-brand"
      />

      {/* Color */}
      <div>
        <h4 className="text-xs font-semibold text-ink-muted uppercase mb-2">Color</h4>
        <GroupColorPicker color={group.color ?? undefined} onChange={(c) => onUpdate({ color: c ?? null })} />
      </div>

      {/* Tab toggle */}
      <div className="flex gap-0.5 bg-surface-raised/50 rounded p-0.5">
        <button
          onClick={() => setView('members')}
          className={`flex-1 py-1 text-xs rounded transition-colors ${view === 'members' ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink'}`}
        >
          Members ({members.length})
        </button>
        <button
          onClick={() => setView('flows')}
          className={`flex-1 py-1 text-xs rounded transition-colors ${view === 'flows' ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink'}`}
        >
          Flows
        </button>
      </div>

      {/* Members view */}
      {view === 'members' && (
        <div className="space-y-0.5 max-h-40 overflow-y-auto [scrollbar-width:thin]">
          {members.map((n) => (
            <div key={n.id} className="flex items-center justify-between py-0.5 group/member">
              <span className="text-xs text-ink-muted truncate flex-1">{n.label || n.address}</span>
              <button
                onClick={() => onSetNodeGroup(group.traceId, [n.id], null)}
                className="text-ink-faint hover:text-red-400 opacity-0 group-hover/member:opacity-100 ml-2 shrink-0 transition-opacity"
                title="Remove from group"
              >
                <FaXmark size={10} />
              </button>
            </div>
          ))}
          {members.length === 0 && <p className="text-xs text-ink-faint">No members</p>}
        </div>
      )}

      {/* Flows view */}
      {view === 'flows' && (
        <div className="space-y-3 max-h-52 overflow-y-auto [scrollbar-width:thin]">
          {inflows.length > 0 && (
            <div>
              <h5 className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">Inflows</h5>
              <div className="space-y-1">
                {inflows.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted truncate">{f.label}</span>
                    <span className="text-xs text-emerald-300 shrink-0 font-mono">+{fmtFlow(f.amount)} {f.symbol}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {outflows.length > 0 && (
            <div>
              <h5 className="text-[10px] font-semibold text-red-400 uppercase mb-1">Outflows</h5>
              <div className="space-y-1">
                {outflows.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted truncate">{f.label}</span>
                    <span className="text-xs text-red-300 shrink-0 font-mono">-{fmtFlow(f.amount)} {f.symbol}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {inflows.length === 0 && outflows.length === 0 && (
            <p className="text-xs text-ink-faint">No external flows for this group</p>
          )}
        </div>
      )}

      {/* Dissolve */}
      <div className="pt-2 border-t border-line-strong">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-400">Dissolve group?</span>
            <button onClick={() => { onDelete(); setConfirmDelete(false); }} className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs text-white">Confirm</button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-ink-muted hover:text-ink">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="w-full px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300 rounded text-xs">
            Dissolve group
          </button>
        )}
      </div>
    </div>
  );
}

function TraceDetails({ trace, onEdit }: { trace: Trace; onEdit: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-ink-muted uppercase">Trace</h4>
        <button onClick={onEdit} className="text-xs text-brand hover:text-brand">Edit</button>
      </div>
      <p className="text-sm font-semibold">{trace.name}</p>
      <div>
        <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Type</h4>
        <p className="text-sm text-ink-muted capitalize">{trace.criteria.type}</p>
      </div>
      {trace.criteria.timeRange && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Time Range</h4>
          <p className="text-xs text-ink-muted">
            {new Date(trace.criteria.timeRange.start).toLocaleDateString()}
          </p>
          <p className="text-xs text-ink-faint">to</p>
          <p className="text-xs text-ink-muted">
            {new Date(trace.criteria.timeRange.end).toLocaleDateString()}
          </p>
        </div>
      )}
      <div>
        <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Stats</h4>
        <p className="text-sm text-ink-muted">{trace.nodes.length} addresses</p>
        <p className="text-sm text-ink-muted">{trace.edges.length} transactions</p>
      </div>
    </div>
  );
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  success: { label: 'Success', cls: 'bg-emerald-500/20 text-emerald-300' },
  error: { label: 'Error', cls: 'bg-red-500/20 text-red-300' },
  timeout: { label: 'Timeout', cls: 'bg-amber-500/20 text-amber-300' },
};

function ScriptRunDetails({
  scriptRun,
  onRerun,
}: {
  scriptRun: ScriptRun;
  onRerun?: () => Promise<void>;
}) {
  const [showCode, setShowCode] = useState(true);
  const [running, setRunning] = useState(false);
  const badge = STATUS_BADGE[scriptRun.status] || STATUS_BADGE.error;

  const handleRerun = async () => {
    if (!onRerun) return;
    setRunning(true);
    try {
      await onRerun();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-xs font-semibold text-ink-muted uppercase">Script</h4>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        <span className="text-[10px] text-ink-faint ml-auto">
          {scriptRun.durationMs}ms
        </span>
        {onRerun && (
          <button
            onClick={handleRerun}
            disabled={running}
            className="px-2 py-0.5 bg-indigo-600/20 hover:bg-indigo-600/40 disabled:opacity-40 text-indigo-300 hover:text-indigo-200 rounded text-[10px] transition-colors"
          >
            {running ? 'Running…' : '▶ Re-run'}
          </button>
        )}
      </div>

      <p className="text-sm font-semibold">{scriptRun.name}</p>

      <div className="text-[10px] text-ink-faint">
        {new Date(scriptRun.createdAt).toLocaleString()}
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 border-b border-line-strong">
        <button
          onClick={() => setShowCode(true)}
          className={`px-2 py-1 text-xs transition-colors ${
            showCode
              ? 'text-brand border-b border-brand -mb-px'
              : 'text-ink-faint hover:text-ink-muted'
          }`}
        >
          Code
        </button>
        <button
          onClick={() => setShowCode(false)}
          className={`px-2 py-1 text-xs transition-colors ${
            !showCode
              ? 'text-brand border-b border-brand -mb-px'
              : 'text-ink-faint hover:text-ink-muted'
          }`}
        >
          Output
        </button>
      </div>

      {showCode ? (
        <pre className="text-[11px] font-mono text-ink-muted bg-surface rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all [scrollbar-width:thin]">
          {scriptRun.code}
        </pre>
      ) : (
        <pre className={`text-[11px] font-mono rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all [scrollbar-width:thin] ${
          scriptRun.status === 'error' || scriptRun.status === 'timeout'
            ? 'text-red-300 bg-red-950/30'
            : 'text-ink-muted bg-surface'
        }`}>
          {scriptRun.output || '(no output)'}
        </pre>
      )}
    </div>
  );
}

const TYPE_DISPLAY: Record<string, string> = {
  wallet: 'Address',
  transaction: 'Transaction',
  trace: 'Trace',
  group: 'Subgroup',
  scriptRun: 'Script',
  edgeBundle: 'Edge Bundle',
  aggregatedEdge: 'Aggregated Transactions',
};

export interface DetailsPanelHandle {
  startEdit: () => void;
}

export const DetailsPanel = forwardRef<DetailsPanelHandle, DetailsPanelProps>(function DetailsPanel({
  selectedItem,
  traces,
  allWallets,
  onUpdateWallet,
  onDeleteWallet,
  onUpdateTransaction,
  onDeleteTransaction,
  onUpdateTrace,
  onDeleteTrace,
  onUpdateGroup,
  onDeleteGroup,
  onSetNodeGroup,
  onFetchHistory,
  onBundleAllOutbound,
  onDeleteAllOutbound,
  onBundleAllInbound,
  onDeleteAllInbound,
  onRerunScript,
  onToggleEdgeBundle,
  onUpdateEdgeBundle,
  onDeleteEdgeBundle,
  onArcEdge,
}: DetailsPanelProps, ref) {
  const [editing, setEditing] = useState(false);
  useImperativeHandle(ref, () => ({ startEdit: () => setEditing(true) }), []);
  const { lookupAddress } = useLabeledEntities();

  // Reset editing when selection changes
  const selectedId = selectedItem?.data?.id;
  const [lastSelectedId, setLastSelectedId] = useState<string | undefined>();
  if (selectedId !== lastSelectedId) {
    setLastSelectedId(selectedId);
    if (editing) setEditing(false);
  }

  if (!selectedItem) {
    return (
      <div className="p-4 text-ink-muted text-sm">
        Select an address, transaction, or trace to view details
      </div>
    );
  }

  if (editing && selectedItem.type === 'wallet') {
    const wallet = selectedItem.data as WalletNode;
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-ink-muted uppercase mb-4">Edit Address</h3>
        <WalletForm
          wallet={wallet}
          traces={traces}
          selectedTraceId={wallet.parentTrace}
          onSave={(traceId, updates) => {
            onUpdateWallet(traceId, wallet.id, updates);
            setEditing(false);
          }}
          onDelete={(traceId) => {
            onDeleteWallet(traceId, wallet.id);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  if (editing && selectedItem.type === 'transaction') {
    const tx = selectedItem.data as TransactionEdge;
    // Find trace containing this transaction
    const traceId = traces.find((t) => t.edges.some((e) => e.id === tx.id))?.id || '';
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-ink-muted uppercase mb-4">Edit Transaction</h3>
        <TransactionForm
          transaction={tx}
          traces={traces}
          allWallets={allWallets}
          onSave={(_tid, updates) => {
            // Always use traceId found by edge lookup — the form's tid may be wrong
            // for cross-trace edges where `from` is a wallet in a different trace.
            onUpdateTransaction(traceId, tx.id, updates);
            setEditing(false);
          }}
          onDelete={(_tid) => {
            onDeleteTransaction(traceId, tx.id);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  if (editing && selectedItem.type === 'trace') {
    const trace = selectedItem.data as Trace;
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-ink-muted uppercase mb-4">Edit Trace</h3>
        <TraceForm
          trace={trace}
          onSave={(updates) => {
            onUpdateTrace(trace.id, updates);
            setEditing(false);
          }}
          onDelete={() => {
            onDeleteTrace(trace.id);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="p-4">
      {selectedItem.type === 'wallet' && (
        <WalletDetails
          wallet={selectedItem.data}
          onFetchHistory={onFetchHistory}
          onBundleAllOutbound={onBundleAllOutbound}
          onDeleteAllOutbound={onDeleteAllOutbound}
          onBundleAllInbound={onBundleAllInbound}
          onDeleteAllInbound={onDeleteAllInbound}
          onUpdate={(updates) => {
            const w = selectedItem.data as WalletNode;
            onUpdateWallet(w.parentTrace, w.id, updates);
          }}
          lookupAddress={lookupAddress}
        />
      )}
      {selectedItem.type === 'transaction' && (
        <TransactionDetails
          transaction={selectedItem.data}
          allWallets={allWallets}
          onUpdate={(updates) => {
            const tx = selectedItem.data as TransactionEdge;
            const traceId = traces.find((t) => t.edges.some((e) => e.id === tx.id))?.id || '';
            onUpdateTransaction(traceId, tx.id, updates);
          }}
          onArcEdge={onArcEdge ? (delta) => onArcEdge((selectedItem.data as TransactionEdge).id, delta) : undefined}
        />
      )}
      {selectedItem.type === 'trace' && (
        <TraceDetails trace={selectedItem.data} onEdit={() => setEditing(true)} />
      )}
      {selectedItem.type === 'group' && (
        <GroupDetails
          group={selectedItem.data}
          traces={traces}
          onUpdate={(updates) => onUpdateGroup(selectedItem.data.traceId, selectedItem.data.id, updates)}
          onDelete={() => onDeleteGroup(selectedItem.data.traceId, selectedItem.data.id)}
          onSetNodeGroup={onSetNodeGroup}
        />
      )}
      {selectedItem.type === 'scriptRun' && (
        <ScriptRunDetails
          scriptRun={selectedItem.data}
          onRerun={onRerunScript ? () => onRerunScript(selectedItem.data.id) : undefined}
        />
      )}
      {selectedItem.type === 'edgeBundle' && (
        <EdgeBundleDetails
          bundle={selectedItem.data as EdgeBundle}
          traces={traces}
          onToggle={() => onToggleEdgeBundle?.(selectedItem.data.traceId, selectedItem.data.id)}
          onUpdate={onUpdateEdgeBundle ? (updates) => onUpdateEdgeBundle(selectedItem.data.traceId, selectedItem.data.id, updates) : undefined}
          onDelete={() => onDeleteEdgeBundle?.(selectedItem.data.traceId, selectedItem.data.id)}
          onArcEdge={onArcEdge ? (delta) => onArcEdge((selectedItem.data as EdgeBundle).id, delta) : undefined}
        />
      )}
      {selectedItem.type === 'aggregatedEdge' && (
        <AggregatedEdgeDetails
          edges={selectedItem.data.edges}
          fromLabel={selectedItem.data.fromLabel}
          toLabel={selectedItem.data.toLabel}
          traceId={selectedItem.data.traceId}
          onArcEdge={onArcEdge ? (delta) => onArcEdge(selectedItem.data.syntheticEdgeId, delta) : undefined}
        />
      )}
    </div>
  );
});
