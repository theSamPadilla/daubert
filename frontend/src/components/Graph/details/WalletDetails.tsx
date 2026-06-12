import { useState, useRef } from 'react';
import { FaXmark, FaArrowRightToBracket, FaArrowRightFromBracket } from 'react-icons/fa6';
import { CopyButton } from '@/components/Common/CopyButton';
import { WalletNode } from '@/types/investigation';
import type { LabeledEntity } from '@/lib/api-client';

const ADDRESS_TYPE_LABELS: Record<string, string> = {
  wallet: 'Wallet',
  contract: 'Contract',
  unknown: 'Unknown',
};

const ADDRESS_TYPE_COLORS: Record<string, string> = {
  wallet: 'bg-brand text-white',
  contract: 'bg-purple-500/20 text-purple-300',
  unknown: 'bg-canvas-fill text-canvas-muted',
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
    default: return 'bg-canvas-fill text-canvas-muted';
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

export function WalletDetails({
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
  lookupAddress: (address: string) => LabeledEntity | undefined;
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
        <h4 className="text-xs font-semibold text-canvas-muted uppercase">{hasAddress ? 'Address' : 'Node'}</h4>
        {hasAddress && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ADDRESS_TYPE_COLORS[addrType]}`}>
            {ADDRESS_TYPE_LABELS[addrType]}
          </span>
        )}
      </div>
      <p className="text-sm font-semibold">{wallet.label}</p>
      {hasAddress && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Address</h4>
          <div className="flex items-start gap-1.5">
            {wallet.explorerUrl ? (
              <a
                href={wallet.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-accent hover:text-canvas-ink break-all underline decoration-accent/40 hover:decoration-accent/70 transition-colors"
              >
                {wallet.address}
              </a>
            ) : (
              <p className="text-xs font-mono text-canvas-muted break-all">{wallet.address}</p>
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
                <span className="text-sm text-canvas-muted">{matchedEntity.name}</span>
              </div>
            );
          })()}
        </div>
      )}
      {hasAddress && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Chain</h4>
          <p className="text-sm text-canvas-muted">{wallet.chain}</p>
        </div>
      )}
      {wallet.tags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Tags</h4>
          <div className="flex flex-wrap gap-1">
            {wallet.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-canvas-fill rounded text-xs">{tag}</span>
            ))}
          </div>
        </div>
      )}
      {onUpdate && (
        <div>
          <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Shape</h4>
          <div className="grid grid-cols-3 gap-1">
            {NODE_SHAPES.map(({ value, label, icon }) => (
              <button
                key={value}
                onClick={() => onUpdate({ shape: value })}
                title={label}
                className={`py-1.5 rounded-lg text-xs transition-colors border flex flex-col items-center gap-0.5 ${
                  (wallet.shape || 'ellipse') === value
                    ? 'border-brand bg-brand text-white'
                    : 'border-canvas-line text-canvas-muted hover:border-white/25 hover:text-canvas-ink'
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
        <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">Notes</h4>
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
          className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-2 py-1.5 text-sm text-canvas-ink placeholder:text-canvas-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 resize-none overflow-hidden"
        />
      </div>
      {hasAddress && (
        <div className="pt-2 border-t border-canvas-line space-y-1.5">
          <button
            onClick={() => onFetchHistory(wallet.address, wallet.chain)}
            className="w-full px-3 py-1.5 bg-canvas-fill hover:bg-white/10 text-canvas-ink rounded-lg text-sm transition-colors text-left"
          >
            Fetch Transactions
          </button>
          {/* Bundle row */}
          {(onBundleAllInbound || onBundleAllOutbound) && !pickingInboundBundleColor && !pickingBundleColor && (
            <div className="grid grid-cols-2 gap-1.5">
              {onBundleAllInbound && (
                <button
                  onClick={() => setPickingInboundBundleColor(true)}
                  className="px-3 py-1.5 bg-canvas-fill hover:bg-emerald-900/40 hover:text-emerald-300 rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5 border border-emerald-500/30"
                >
                  <FaArrowRightToBracket className="text-emerald-400" />
                  <span>Bundle IN</span>
                </button>
              )}
              {onBundleAllOutbound && (
                <button
                  onClick={() => setPickingBundleColor(true)}
                  className="px-3 py-1.5 bg-canvas-fill hover:bg-amber-900/40 hover:text-amber-300 rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5 border border-amber-500/30"
                >
                  <FaArrowRightFromBracket className="text-amber-400" />
                  <span>Bundle OUT</span>
                </button>
              )}
            </div>
          )}
          {onBundleAllInbound && pickingInboundBundleColor && (
            <div className="w-full px-3 py-1.5 bg-canvas-fill rounded-lg text-sm flex items-center gap-2 border border-emerald-500/30">
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
                className="text-canvas-muted hover:text-canvas-ink text-xs"
                title="Cancel"
              >
                <FaXmark />
              </button>
            </div>
          )}
          {onBundleAllOutbound && pickingBundleColor && (
            <div className="w-full px-3 py-1.5 bg-canvas-fill rounded-lg text-sm flex items-center gap-2 border border-amber-500/30">
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
                className="text-canvas-muted hover:text-canvas-ink text-xs"
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
                  className="px-3 py-1.5 bg-canvas-fill hover:bg-red-900/40 hover:text-red-300 rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5 border border-emerald-500/30"
                >
                  <FaArrowRightToBracket className="text-emerald-400" />
                  <span>Delete IN</span>
                </button>
              )}
              {onDeleteAllOutbound && (
                <button
                  onClick={() => setConfirmDeleteOutbound(true)}
                  className="px-3 py-1.5 bg-canvas-fill hover:bg-red-900/40 hover:text-red-300 rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5 border border-amber-500/30"
                >
                  <FaArrowRightFromBracket className="text-amber-400" />
                  <span>Delete OUT</span>
                </button>
              )}
            </div>
          )}
          {onDeleteAllInbound && confirmDeleteInbound && (
            <div className="w-full px-3 py-1.5 bg-canvas-fill rounded-lg text-sm flex items-center gap-2 border border-emerald-500/30">
              <FaArrowRightToBracket className="text-emerald-400 shrink-0" />
              <span className="text-canvas-muted text-xs flex-1">Delete all <span className="text-emerald-300 font-medium">INBOUND</span> transactions?</span>
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
                className="text-[11px] text-canvas-muted hover:text-canvas-ink"
              >
                Cancel
              </button>
            </div>
          )}
          {onDeleteAllOutbound && confirmDeleteOutbound && (
            <div className="w-full px-3 py-1.5 bg-canvas-fill rounded-lg text-sm flex items-center gap-2 border border-amber-500/30">
              <FaArrowRightFromBracket className="text-amber-400 shrink-0" />
              <span className="text-canvas-muted text-xs flex-1">Delete all <span className="text-amber-300 font-medium">OUTBOUND</span> transactions?</span>
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
                className="text-[11px] text-canvas-muted hover:text-canvas-ink"
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
