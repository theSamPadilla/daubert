import type { TransferLeg } from '@/types/investigation';
import { formatTokenAmount, normalizeToken } from '@/utils/formatAmount';
import { truncateMiddle } from '@/utils/utxoDisplay';

const STANDARD_LABELS: Record<TransferLeg['standard'], string> = {
  erc20: 'ERC-20',
  erc721: 'ERC-721',
  erc1155: 'ERC-1155',
};

/** What a leg moved: a token id for an NFT, an amount + symbol otherwise. */
function legValue(leg: TransferLeg): string {
  const tok = normalizeToken(leg.token);
  if (leg.standard === 'erc721' && leg.tokenId !== undefined) return `#${leg.tokenId}`;
  return `${formatTokenAmount(leg.amount, tok.decimals)} ${tok.symbol}`;
}

/**
 * Presentational picker over the transfers decoded from one transaction's
 * receipt. A relayed call routinely emits several, and the one the edge
 * currently mirrors is often not the one the investigator cares about, so the
 * panel has to offer the choice.
 *
 * Renders nothing below two legs: a single-transfer transaction offers no
 * choice, and an empty section would only add noise to the panel.
 */
export function TransferPicker({
  transfers,
  selectedIndex,
  onSelect,
}: {
  transfers?: TransferLeg[];
  selectedIndex?: number;
  onSelect: (index: number) => void;
}) {
  if (!transfers || transfers.length < 2) return null;

  return (
    <div>
      <h4 className="text-xs font-semibold text-canvas-muted uppercase mb-1">
        Transfers in this transaction
      </h4>
      <div className="space-y-1">
        {transfers.map((leg, index) => {
          const active = index === selectedIndex;
          return (
            <button
              key={`${leg.logIndex}-${index}`}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(index)}
              title={`${leg.from} → ${leg.to}`}
              className={`w-full text-left px-2 py-1.5 rounded-lg border transition-colors ${
                active
                  ? 'bg-brand text-white border-brand'
                  : 'bg-canvas-fill border-canvas-line text-canvas-ink hover:border-white/25'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                    active ? 'bg-white/20 text-white' : 'bg-canvas-line/60 text-canvas-muted'
                  }`}
                >
                  {STANDARD_LABELS[leg.standard]}
                </span>
                <span className="text-xs font-medium truncate">{legValue(leg)}</span>
              </div>
              <p
                className={`text-[10px] font-mono mt-0.5 truncate ${
                  active ? 'text-white/80' : 'text-canvas-muted'
                }`}
              >
                {truncateMiddle(leg.from)} → {truncateMiddle(leg.to)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
