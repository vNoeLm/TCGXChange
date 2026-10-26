import React, { useState } from 'react';
import type { MarketplaceBulkListing } from '../../types';
import { CountryFlag } from '../CountryFlag';
import { ListingLikeButton } from './ListingLikeButton';
import { useCurrency } from '../../lib/currency';
import { formatPricePerCard, getBulkCountLabel } from '../../lib/bulkHelpers';
import { ImageViewer } from '../CardImageViewer';

interface BulkCardProps {
  bulk: MarketplaceBulkListing;
  onClick: (bulk: MarketplaceBulkListing) => void;
}

export function BulkCard({ bulk, onClick }: BulkCardProps) {
  const { formatPrice } = useCurrency();
  const [imageViewerOpen, setImageViewerOpen] = useState(false);

  const countLabel = getBulkCountLabel(bulk.exact_card_count, bulk.approx_card_count);
  const pricePerCard = formatPricePerCard(bulk.price_huf, bulk.exact_card_count, bulk.approx_card_count, formatPrice);
  const mainPhoto = bulk.images?.[0] || '';

  return (
    <>
      <div
        onClick={() => onClick(bulk)}
        className="rounded-2xl overflow-hidden flex flex-col h-full cursor-pointer transition-all duration-200 border group hover:-translate-y-1 shadow-md hover:shadow-xl relative"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        {bulk.status === 'on_hold' && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 py-1.5 px-2 bg-black/90 border-y border-amber-500/70 shadow-[0_0_20px_rgba(245,158,11,0.5)] flex items-center justify-center gap-1.5 z-20 pointer-events-none">
            <svg className="w-3.5 h-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="text-[11px] font-black tracking-widest uppercase text-amber-400">
              ON HOLD
            </span>
          </div>
        )}

        {/* Image Banner */}
        <div className="relative aspect-[4/3] w-full bg-zinc-900 overflow-hidden">
          {mainPhoto ? (
            <img
              src={mainPhoto}
              alt={bulk.title}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs font-bold text-zinc-500">
              Bulk Card Lot
            </div>
          )}

          {/* Top Left Like & Badges */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
            <ListingLikeButton id={bulk.id} type="listing" initialCount={bulk.likes_count || 0} alwaysShowCount size="sm" />
          </div>

          {/* Top Right Card Count Badge */}
          <div className="absolute top-2.5 right-2.5 flex flex-col items-end gap-1 z-10">
            <span className="px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider bg-indigo-600/95 text-white border border-indigo-400/50 shadow-lg">
              BULK · {countLabel}
            </span>
            {bulk.includes_foil && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-500/90 text-zinc-950">
                + FOILS
              </span>
            )}
          </div>

          {/* Bottom Zoom Button */}
          {mainPhoto && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setImageViewerOpen(true);
              }}
              title="Open full image"
              aria-label="Open full image"
              className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-lg border flex items-center justify-center text-white bg-black/70 hover:bg-black/90 backdrop-blur-sm transition z-10 cursor-pointer shadow-md"
              style={{ borderColor: 'rgba(255,255,255,0.2)' }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}>
                {bulk.game}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                {bulk.condition}
              </span>
            </div>
            <h3 className="text-sm font-black line-clamp-2 leading-snug" style={{ color: 'var(--text-primary)' }}>
              {bulk.title}
            </h3>
            {bulk.description && (
              <p className="text-xs line-clamp-2 mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {bulk.description}
              </p>
            )}
          </div>

          {/* Footer: Seller & Price */}
          <div className="pt-2.5 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-1.5 min-w-0">
              {bulk.seller_avatar ? (
                <img src={bulk.seller_avatar} alt={bulk.seller_name} className="w-5 h-5 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0" style={{ background: 'var(--accent-strong)' }}>
                  {(bulk.seller_name || 'S')[0].toUpperCase()}
                </div>
              )}
              <span className="text-xs font-bold truncate" style={{ color: 'var(--text-secondary)' }}>
                {bulk.seller_name || 'Seller'}
              </span>
              {bulk.seller_country && (
                <CountryFlag countryCode={bulk.seller_country} className="w-3.5 h-2.5 shrink-0 rounded-xs" />
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-black text-emerald-400">
                {formatPrice(bulk.price_huf)}
              </div>
              {pricePerCard && (
                <div className="text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }}>
                  {pricePerCard}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {imageViewerOpen && (
        <ImageViewer
          open={imageViewerOpen}
          onClose={() => setImageViewerOpen(false)}
          images={bulk.images}
          src={mainPhoto}
          alt={bulk.title}
        />
      )}
    </>
  );
}
