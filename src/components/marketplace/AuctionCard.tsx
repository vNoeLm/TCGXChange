import React, { useState, useEffect } from 'react';
import type { MarketplaceAuction } from '../../types';
import { getCardImageUrl } from '../../lib/supabase';
import { useCurrency } from '../../lib/currency';
import { CountryFlag } from '../CountryFlag';
import { ListingLikeButton } from './ListingLikeButton';
import { formatPricePerCard, extractAuctionBulkInfo } from '../../lib/bulkHelpers';
import { ImageViewer } from '../CardImageViewer';

interface AuctionCardProps {
  auction: MarketplaceAuction;
  onClick: (auction: MarketplaceAuction) => void;
}

export function formatAuctionCountdown(endsAt: string, now: number): { text: string; isEnded: boolean; isUrgent: boolean } {
  const diffMs = new Date(endsAt).getTime() - now;
  if (isNaN(diffMs) || diffMs <= 0) {
    return { text: 'Ended', isEnded: true, isUrgent: false };
  }
  const totalSec = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const isUrgent = totalSec < 600; // under 10 mins
  if (days > 0) {
    return { text: `${days}d ${hours}h ${mins}m`, isEnded: false, isUrgent };
  }
  if (hours > 0) {
    return { text: `${hours}h ${mins}m ${secs}s`, isEnded: false, isUrgent };
  }
  return { text: `${mins}m ${secs}s`, isEnded: false, isUrgent };
}

export function AuctionCard({ auction, onClick }: AuctionCardProps) {
  const { formatPrice } = useCurrency();
  const [now, setNow] = useState(() => Date.now());
  const [imageViewerOpen, setImageViewerOpen] = useState(false);

  useEffect(() => {
    if (auction.status !== 'active') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [auction.status]);

  const countdown = formatAuctionCountdown(auction.ends_at, now);
  const imgUrl = auction.images?.[0] || (auction.card?.image_path ? getCardImageUrl(auction.card.image_path) : '');
  const currentPrice = auction.current_bid_huf || auction.base_price_huf;

  const bulkInfo = extractAuctionBulkInfo(auction);
  const pricePerCard = bulkInfo.isBulk
    ? formatPricePerCard(currentPrice, bulkInfo.exactCount, bulkInfo.approxCount, formatPrice)
    : null;

  return (
    <>
      <div
        onClick={() => onClick(auction)}
        className="rounded-2xl overflow-hidden flex flex-col h-full cursor-pointer transition-all duration-200 border group hover:-translate-y-1 shadow-md hover:shadow-xl relative"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        {/* Top Status / Countdown Bar */}
        <div
          className="px-3.5 py-2 flex items-center justify-between gap-2 border-b"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                auction.status === 'active' && !countdown.isEnded
                  ? countdown.isUrgent
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
              }`}
            >
              {auction.status === 'active' ? countdown.text : auction.status.toUpperCase()}
            </span>
            {auction.extension_minutes > 0 && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-bold border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                title={`Every bid extends auction end time by +${auction.extension_minutes} minutes`}
              >
                +{auction.extension_minutes}m/bid
              </span>
            )}
          </div>
          <span className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>
            {auction.bid_count || 0} {auction.bid_count === 1 ? 'bid' : 'bids'}
          </span>
        </div>

        {/* Image */}
        <div className="relative aspect-[4/3] w-full bg-zinc-900 flex items-center justify-center p-2 overflow-hidden">
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={auction.title}
              className="max-h-full max-w-full object-contain rounded-lg transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="text-xs font-bold text-zinc-500">Auction Item</div>
          )}

          {/* Top Left Like Button */}
          <div className="absolute top-2 left-2 z-10">
            <ListingLikeButton id={auction.id} type="listing" initialCount={auction.likes_count || 0} alwaysShowCount size="sm" />
          </div>

          {/* Top Right Card Count Badge (for Bulk Auctions) */}
          {bulkInfo.isBulk && (
            <div className="absolute top-2.5 right-2.5 flex flex-col items-end gap-1 z-10">
              <span className="px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider bg-indigo-600/95 text-white border border-indigo-400/50 shadow-lg">
                BULK · {bulkInfo.countLabel}
              </span>
              {auction.is_foil && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-500/90 text-zinc-950">
                  + FOILS
                </span>
              )}
            </div>
          )}

          {/* Bid Step Badge (bottom right if not zoom, or bottom right) */}
          <div className="absolute bottom-2 right-2 flex items-center gap-1 z-10">
            <span className="px-2 py-0.5 rounded bg-black/80 text-white text-[10px] font-bold border border-white/15">
              Step: +{formatPrice(auction.bid_step_huf)}
            </span>
          </div>

          {/* Zoom Button (bottom left) */}
          {imgUrl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setImageViewerOpen(true);
              }}
              title="Open full image"
              aria-label="Open full image"
              className="absolute bottom-2 left-2 w-7 h-7 rounded-lg border flex items-center justify-center text-white bg-black/70 hover:bg-black/90 backdrop-blur-sm transition z-10 cursor-pointer shadow-md"
              style={{ borderColor: 'rgba(255,255,255,0.2)' }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
          )}
        </div>

        {/* Details */}
        <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                {auction.condition}
              </span>
              {auction.is_foil && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  FOIL
                </span>
              )}
            </div>
            <h3 className="text-sm font-black line-clamp-1" style={{ color: 'var(--text-primary)' }}>
              {auction.title}
            </h3>
            {auction.highest_bidder_name && (
              <div className="text-[11px] font-semibold mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
                Top bidder: <span style={{ color: 'var(--text-primary)' }}>{auction.highest_bidder_name}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="pt-2.5 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-1.5 min-w-0">
              {auction.seller_avatar ? (
                <img src={auction.seller_avatar} alt={auction.seller_name} className="w-5 h-5 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0" style={{ background: 'var(--accent-strong)' }}>
                  {(auction.seller_name || 'S')[0].toUpperCase()}
                </div>
              )}
              <span className="text-xs font-bold truncate" style={{ color: 'var(--text-secondary)' }}>
                {auction.seller_name || 'Seller'}
              </span>
              {auction.seller_country && (
                <CountryFlag countryCode={auction.seller_country} className="w-3.5 h-2.5 shrink-0 rounded-xs" />
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                {auction.bid_count > 0 ? 'Current Bid' : 'Base Price'}
              </div>
              <div className="text-sm font-black text-amber-400">
                {formatPrice(currentPrice)}
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
          images={auction.images && auction.images.length > 0 ? auction.images : (imgUrl ? [imgUrl] : [])}
          src={imgUrl}
          alt={auction.title}
        />
      )}
    </>
  );
}
