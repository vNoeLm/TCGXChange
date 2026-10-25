import React from 'react';
import type { CardListingGroup } from '../../lib/marketplaceGrouping';
import { cardThumbProps, gridThumbSize } from '../../lib/supabase';
import { splitCardTitle, formatCleanCardNumber } from '../../lib/formatGameText';
import { useCurrency } from '../../lib/currency';
import { isOvernumbered, isAltArt } from '../../lib/cardVariants';

interface CardGroupTileProps {
  group: CardListingGroup;
  onClick: (group: CardListingGroup) => void;
  gridSize?: 'small' | 'normal' | 'large';
  /** One of the first cards on the page: load its image right away. */
  priority?: boolean;
}

/** One card with active listings: art, lowest/average price and how many copies are for sale. */
export const CardGroupTile = React.memo(function CardGroupTile({ group, onClick, gridSize = 'normal', priority = false }: CardGroupTileProps) {
  const isSmall = gridSize === 'small';
  const { formatPrice } = useCurrency();
  const card = group.representative;
  const imagePath = card.card_image_path || card.image_path;
  const { main, sub } = splitCardTitle(card.name);

  return (
    <button
      type="button"
      onClick={() => onClick(group)}
      className="rounded-2xl overflow-hidden flex flex-col h-full text-left cursor-pointer transition hover:-translate-y-1"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
    >
      <div className="relative w-full aspect-[63/88] overflow-hidden border-b" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
        {imagePath ? (
          <img {...cardThumbProps(imagePath, gridThumbSize(gridSize), priority)} alt={card.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl font-black" style={{ color: 'var(--text-primary)' }}>
            {card.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <span
            className="px-2 py-0.5 text-[10px] font-black rounded-lg uppercase tracking-wider shadow-md" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
            title={`${group.listing_count} listing${group.listing_count === 1 ? '' : 's'}`}
          >
            {group.listing_count} {group.listing_count === 1 ? 'listing' : 'listings'}
          </span>
          {group.has_foil && (
            <span className="px-2 py-0.5 text-[10px] font-black rounded-lg uppercase tracking-wider bg-sky-500/90 text-white border border-sky-200/60">
              Foil
            </span>
          )}
        </div>

        {/* Bottom Left Badges: ALT ART / ON */}
        <div className="absolute bottom-1.5 left-1.5 flex flex-col items-start gap-1" style={{ zIndex: 3 }}>
          {isAltArt(card) && (
            <span
              className="px-2 py-0.5 text-[10px] font-black rounded-lg uppercase tracking-wider"
              style={{
                background: "rgba(219, 39, 119, 0.95)",
                color: "#ffffff",
                border: "1.5px solid #f472b6",
                boxShadow: "0 0 12px rgba(236, 72, 153, 0.6)",
                textShadow: "0 0 6px rgba(0, 0, 0, 0.8)",
              }}
            >
              ALT ART
            </span>
          )}

          {isOvernumbered(card) && (
            <span
              className="px-2 py-0.5 text-[10px] font-black rounded-lg uppercase tracking-wider"
              style={{
                background: "rgba(99, 102, 241, 0.95)",
                color: "#ffffff",
                border: "1.5px solid #818cf8",
                boxShadow: "0 0 12px rgba(99, 102, 241, 0.6)",
                textShadow: "0 0 6px rgba(0, 0, 0, 0.8)",
              }}
            >
              ON
            </span>
          )}
        </div>
      </div>

      <div className={`${isSmall ? 'p-2 sm:p-2.5' : 'p-2.5 sm:p-3.5'} flex flex-col flex-grow`}>
        <div className="text-center my-0.5">
          <h3 className={`${isSmall ? 'text-xs' : 'text-xs sm:text-sm'} font-black leading-tight uppercase tracking-tight truncate`} style={{ color: 'var(--text-primary)' }}>{main}</h3>
          {/* Always reserve the subtitle line so single- and two-line names keep the same height. */}
          <p className="text-[10px] font-bold uppercase tracking-widest truncate min-h-[12px] leading-[12px]" style={{ color: 'var(--text-tertiary)' }}>{sub || ''}</p>
        </div>
        <p className={`${isSmall ? 'text-[10px] my-1' : 'text-[10px] sm:text-[11px] mt-1 mb-1.5'} font-medium truncate`} style={{ color: 'var(--text-secondary)' }}>
          {card.set_name || (card.card_type === 'Rune' ? 'Basic Rune' : '')}
        </p>
        <div className={`flex justify-between items-center font-mono ${isSmall ? 'text-[10px] mb-1' : 'text-[10px] sm:text-[11px] mb-2'}`} style={{ color: 'var(--text-tertiary)' }}>
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            <span>{formatCleanCardNumber(card.card_number)}</span>
          </div>
          <span className="shrink-0">{card.rarity}</span>
        </div>

        <div className={`mt-auto ${isSmall ? 'pt-1.5' : 'pt-2'}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex items-end justify-between gap-1.5 sm:gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>From</div>
              <div className={`${isSmall ? 'text-xs sm:text-sm' : 'text-sm sm:text-lg'} font-black text-[var(--positive)] leading-none whitespace-nowrap`}>
                {group.lowest_price > 0 ? formatPrice(group.lowest_price) : 'N/A'}
              </div>
            </div>
            {group.avg_price > 0 && group.listing_count > 1 && (
              <div className="text-right min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Avg</div>
                <div className={`${isSmall ? 'text-[10px] sm:text-[11px]' : 'text-xs sm:text-sm'} font-bold leading-none whitespace-nowrap`} style={{ color: 'var(--text-secondary)' }}>{formatPrice(group.avg_price)}</div>
              </div>
            )}
          </div>
          <div className="mt-1.5 text-[10px] sm:text-[11px] font-semibold truncate" style={{ color: 'var(--text-tertiary)' }}>
            {group.total_quantity} {group.total_quantity === 1 ? 'copy' : 'copies'} from {group.seller_count} {group.seller_count === 1 ? 'seller' : 'sellers'}
          </div>
        </div>
      </div>
    </button>
  );
});
