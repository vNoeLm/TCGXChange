import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { MarketplaceAuction } from '../../types';
import { supabase, getCardImageUrl } from '../../lib/supabase';
import { useExitTransition } from '../../lib/useExitTransition';
import { useCurrentUserId } from '../../lib/useCurrentUserId';
import { useCurrency } from '../../lib/currency';
import { CountryFlag } from '../CountryFlag';
import { ListingLikeButton } from './ListingLikeButton';
import { handoverLabel } from '../../lib/handover';
import { formatAuctionCountdown } from './AuctionCard';
import { formatPricePerCard, extractAuctionBulkInfo } from '../../lib/bulkHelpers';
import { ImageViewer } from '../CardImageViewer';

interface AuctionDetailModalProps {
  auction: MarketplaceAuction | null;
  onClose: () => void;
  onChanged?: () => void;
}

export function AuctionDetailModal({ auction: initialAuction, onClose, onChanged }: AuctionDetailModalProps) {
  const { rendered, state } = useExitTransition(Boolean(initialAuction), 220);
  const currentUserId = useCurrentUserId();
  const { formatPrice } = useCurrency();

  const [auction, setAuction] = useState<MarketplaceAuction | null>(initialAuction);
  const [now, setNow] = useState(() => Date.now());
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState(0);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [bidInput, setBidInput] = useState('');
  const [placingBid, setPlacingBid] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    setAuction(initialAuction);
    setShowCancelConfirm(false);
    setErrorMsg(null);
    setToastMsg(null);
    if (initialAuction) {
      const nextMin =
        initialAuction.bid_count === 0 || !initialAuction.current_bid_huf
          ? initialAuction.base_price_huf
          : initialAuction.current_bid_huf + initialAuction.bid_step_huf;
      setBidInput(String(nextMin));
    }
  }, [initialAuction]);

  useEffect(() => {
    if (!auction || auction.status !== 'active') return;
    const timer = setInterval(() => {
      const currentNow = Date.now();
      setNow(currentNow);
      if (new Date(auction.ends_at).getTime() <= currentNow) {
        // Trigger server finalization when timer reaches zero
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) return;
          fetch('/api/marketplace/auctions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ action: 'finalize' }),
          })
            .then((r) => r.json())
            .then((json) => {
              if (json.success && Array.isArray(json.data)) {
                const updated = json.data.find((a: MarketplaceAuction) => a.id === auction.id);
                if (updated) setAuction(updated);
                if (onChanged) onChanged();
              }
            })
            .catch(() => {});
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [auction, onChanged]);

  if (!rendered || !auction) return null;

  const isSeller = Boolean(currentUserId && auction.seller_id === currentUserId);
  const isWinner = Boolean(currentUserId && auction.highest_bidder_id === currentUserId);
  const hasWinner = Boolean(auction.highest_bidder_id && (auction.bid_count > 0 || auction.current_bid_huf));
  const countdown = formatAuctionCountdown(auction.ends_at, now);
  const isLive = auction.status === 'active' && !countdown.isEnded;

  const minRequiredBid =
    auction.bid_count === 0 || !auction.current_bid_huf
      ? auction.base_price_huf
      : auction.current_bid_huf + auction.bid_step_huf;

  const imgUrl = auction.images?.[0] || (auction.card?.image_path ? getCardImageUrl(auction.card.image_path) : '');
  const photos = Array.isArray(auction.images) && auction.images.length > 0
    ? auction.images
    : (imgUrl ? [imgUrl] : []);
  const activePhoto = photos[selectedPhotoIdx] || photos[0] || imgUrl;

  const bulkInfo = extractAuctionBulkInfo(auction);
  const currentPrice = auction.current_bid_huf || auction.base_price_huf;
  const pricePerCard = bulkInfo.isBulk
    ? formatPricePerCard(currentPrice, bulkInfo.exactCount, bulkInfo.approxCount, formatPrice)
    : null;

  const submitBid = async (amountToBid: number) => {
    setPlacingBid(true);
    setErrorMsg(null);
    setToastMsg(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        setErrorMsg('Please sign in to place a bid.');
        setPlacingBid(false);
        return;
      }

      const res = await fetch('/api/marketplace/auctions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'bid',
          auction_id: auction.id,
          amount_huf: amountToBid,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to place bid.');
      }

      const updated: MarketplaceAuction = json.data;
      setAuction(updated);
      const nextStep = (updated.current_bid_huf || updated.base_price_huf) + updated.bid_step_huf;
      setBidInput(String(nextStep));
      setToastMsg(
        json.extended_by_minutes > 0
          ? `Bid placed! Auction end time extended by +${json.extended_by_minutes} minutes.`
          : 'Bid placed successfully!'
      );
      if (onChanged) onChanged();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error placing bid.');
    } finally {
      setPlacingBid(false);
    }
  };

  const handleSellerCancel = async () => {
    setCancelling(true);
    setErrorMsg(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;

      const res = await fetch('/api/marketplace/auctions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'cancel',
          auction_id: auction.id,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Could not cancel auction.');
      }

      if (onChanged) onChanged();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error cancelling auction.');
    } finally {
      setCancelling(false);
    }
  };

  return createPortal(
    <>
      <div
        data-state={state}
        className="tv-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto"
        onClick={onClose}
      >
      <div
        data-state={state}
        className="tv-modal relative w-full max-w-3xl rounded-2xl border shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
              Auction
            </span>
            {bulkInfo.isBulk && (
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shrink-0">
                BULK · {bulkInfo.countLabel}
              </span>
            )}
            <h2 className="text-base sm:text-lg font-black truncate" style={{ color: 'var(--text-primary)' }}>
              {auction.title}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ListingLikeButton id={auction.id} type="listing" initialCount={auction.likes_count || 0} alwaysShowCount showLabel variant="surface" />
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: Card Image & Bid History */}
          <div className="space-y-4">
            <div className="space-y-3">
              <div
                className={`aspect-[4/3] w-full rounded-xl overflow-hidden border bg-zinc-900 flex items-center justify-center p-3 relative ${
                  activePhoto ? 'cursor-zoom-in group' : ''
                }`}
                style={{ borderColor: 'var(--border)' }}
                onClick={() => activePhoto && setImageViewerOpen(true)}
              >
                {activePhoto ? (
                  <>
                    <img
                      src={activePhoto}
                      alt={auction.title}
                      className="max-h-full max-w-full object-contain rounded-lg transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-sm text-[11px] font-bold text-white flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition shadow-lg border border-white/20">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        <line x1="11" y1="8" x2="11" y2="14" />
                        <line x1="8" y1="11" x2="14" y2="11" />
                      </svg>
                      <span>Click to enlarge</span>
                    </div>
                  </>
                ) : (
                  <div className="text-xs font-bold text-zinc-500">Auction Item</div>
                )}
              </div>

              {photos.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map((url, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedPhotoIdx(idx)}
                      className={`w-16 h-16 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer ${
                        idx === selectedPhotoIdx ? 'border-amber-400' : 'border-transparent opacity-60'
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Bid History */}
            <div className="rounded-xl border p-3.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Bid History ({auction.bid_count || 0})
                </span>
                {auction.extension_minutes > 0 && (
                  <span className="text-[10px] font-bold text-amber-400">
                    +{auction.extension_minutes} min per bid
                  </span>
                )}
              </div>
              {Array.isArray(auction.bids) && auction.bids.length > 0 ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {auction.bids.map((b, i) => (
                    <div
                      key={b.id || i}
                      className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg border"
                      style={{
                        background: i === 0 ? 'rgba(245, 158, 11, 0.1)' : 'var(--bg-surface)',
                        borderColor: i === 0 ? 'rgba(245, 158, 11, 0.35)' : 'var(--border-subtle)',
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                          {b.bidder_name}
                        </span>
                        {i === 0 && (
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950">
                            Top
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-black text-amber-400 shrink-0">
                        {formatPrice(b.amount_huf)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs py-3 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  No bids placed yet. Be the first to bid at {formatPrice(auction.base_price_huf)}!
                </p>
              )}
            </div>
          </div>

          {/* Right: Live Stats, Bidding & Controls */}
          <div className="flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              {/* Countdown & Price Box */}
              <div className="p-4 rounded-xl border space-y-3" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                      {auction.bid_count > 0 ? 'Current Highest Bid' : 'Starting Base Price'}
                    </div>
                    <div className="text-2xl font-black text-amber-400">
                      {formatPrice(auction.current_bid_huf || auction.base_price_huf)}
                    </div>
                    {pricePerCard && (
                      <div className="text-xs font-bold mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {pricePerCard}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                      Time Remaining
                    </div>
                    <div className={`text-base font-mono font-black ${isLive ? 'text-emerald-400' : 'text-zinc-400'}`}>
                      {auction.status === 'active' ? countdown.text : auction.status.toUpperCase()}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <span className="block text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Base Price</span>
                    <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{formatPrice(auction.base_price_huf)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Bid Step</span>
                    <span className="font-bold" style={{ color: 'var(--text-primary)' }}>+{formatPrice(auction.bid_step_huf)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Minute Rule</span>
                    <span className="font-bold" style={{ color: 'var(--text-primary)' }}>+{auction.extension_minutes} min/bid</span>
                  </div>
                </div>
              </div>

              {/* Specs & Seller */}
              <div className="flex flex-wrap gap-2">
                {bulkInfo.isBulk && (
                  <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-indigo-600/20 text-indigo-300 border border-indigo-500/40">
                    {bulkInfo.countLabel}
                  </span>
                )}
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                  Condition: {auction.condition}
                </span>
                {auction.is_foil && (
                  <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    Foil
                  </span>
                )}
                {(auction.handover_methods || []).map((m) => (
                  <span key={m} className="px-2.5 py-1 rounded-lg text-xs font-medium border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    {handoverLabel(m)}
                  </span>
                ))}
              </div>

              {auction.description && (
                <p className="text-xs leading-relaxed p-3 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                  {auction.description}
                </p>
              )}

              {/* Seller Info */}
              <div className="flex items-center justify-between p-3 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>Seller: {auction.seller_name}</span>
                  {auction.seller_country && <CountryFlag countryCode={auction.seller_country} className="w-3.5 h-2.5 rounded-xs" />}
                </div>
                {typeof auction.seller_rating_avg === 'number' && (
                  <span className="text-xs font-bold text-amber-400">
                    &#9733; {auction.seller_rating_avg.toFixed(1)} ({auction.seller_rating_count || 0})
                  </span>
                )}
              </div>
            </div>

            {/* Bidding Controls (Buyer) */}
            {!isSeller && isLive && (
              <div className="space-y-2.5 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                {errorMsg && (
                  <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-bold">
                    {errorMsg}
                  </div>
                )}
                {toastMsg && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                    {toastMsg}
                  </div>
                )}

                {isWinner ? (
                  <div
                    className="p-3.5 rounded-xl border flex items-center gap-3"
                    style={{
                      background: 'var(--accent-muted)',
                      borderColor: 'var(--accent-border, var(--accent))',
                    }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
                      style={{
                        background: 'var(--accent)',
                        color: 'var(--accent-contrast, #000)',
                        borderColor: 'transparent',
                      }}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-xs font-black" style={{ color: 'var(--text-accent)' }}>
                        You are currently the highest bidder!
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        Your bid: <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{formatPrice(auction.current_bid_huf || auction.base_price_huf)}</span>. You cannot outbid yourself.
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={placingBid}
                      onClick={() => submitBid(minRequiredBid)}
                      className="w-full py-2.5 rounded-xl text-xs font-black cursor-pointer transition shadow-md disabled:opacity-50"
                      style={{
                        background: 'var(--accent)',
                        color: 'var(--accent-contrast, #000)',
                        boxShadow: '0 4px 14px var(--accent-muted, rgba(0,0,0,0.2))',
                      }}
                    >
                      {placingBid ? 'Placing Bid...' : `Quick Bid Next Step: ${formatPrice(minRequiredBid)}`}
                    </button>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={minRequiredBid}
                        step={auction.bid_step_huf}
                        value={bidInput}
                        onChange={(e) => setBidInput(e.target.value)}
                        placeholder={`Min ${minRequiredBid} Ft`}
                        className="flex-1 px-3 py-2 rounded-xl text-xs font-bold border outline-none focus:border-[var(--accent)]"
                        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      />
                      <button
                        type="button"
                        disabled={placingBid}
                        onClick={() => submitBid(parseInt(bidInput, 10))}
                        className="px-4 py-2 rounded-xl text-xs font-black border cursor-pointer hover:bg-white/5 transition"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        Place Custom Bid
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Winner / Ended Conversation Link */}
            {(isWinner || isSeller) && (auction.status === 'ended' || auction.conversation_id) && (
              <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 space-y-2">
                <div className="text-xs font-black text-emerald-300">
                  {isWinner ? 'Congratulations! You won this auction!' : `Won by ${auction.highest_bidder_name} for ${formatPrice(auction.current_bid_huf || auction.base_price_huf)}`}
                </div>
                <a
                  href={auction.conversation_id ? `/messages?conversation_id=${auction.conversation_id}` : '/messages'}
                  className="inline-flex items-center justify-center w-full py-2.5 rounded-xl text-xs font-black bg-emerald-500 text-zinc-950 hover:bg-emerald-400 transition"
                >
                  Open Handover Conversation in Messages
                </a>
              </div>
            )}

            {/* Seller Cancel & 1-Star Penalty Warning */}
            {isSeller && (auction.status === 'active' || auction.status === 'ended') && (
              <div className="pt-3 border-t space-y-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                {!showCancelConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    className="w-full py-2.5 rounded-xl text-xs font-black border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 cursor-pointer transition"
                  >
                    {hasWinner ? 'Cancel Auction & Refuse Winning Price (1-Star Penalty)' : 'Cancel Auction'}
                  </button>
                ) : (
                  <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 space-y-3">
                    <p className="text-xs font-bold text-rose-300 leading-relaxed">
                      {hasWinner
                        ? 'WARNING: Because this auction already has a winning bidder, cancelling it or refusing to honor the price will automatically record a 1-star review from the system on your seller profile stating that you cancelled the auction and did not honor the winning bid.'
                        : 'Are you sure you want to cancel this auction?'}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={cancelling}
                        onClick={handleSellerCancel}
                        className="flex-1 py-2 rounded-lg text-xs font-black bg-rose-500 text-white hover:bg-rose-400 cursor-pointer transition"
                      >
                        {cancelling ? 'Cancelling...' : hasWinner ? 'Confirm Cancel (Accept 1-Star Review)' : 'Confirm Cancel'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCancelConfirm(false)}
                        className="px-3 py-2 rounded-lg text-xs font-bold border cursor-pointer"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        Keep Auction
                      </button>
                    </div>
                  </div>
                )}
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
          images={photos}
          currentIndex={selectedPhotoIdx}
          onIndexChange={setSelectedPhotoIdx}
          src={activePhoto}
          alt={auction.title}
        />
      )}
    </>,
    document.body
  );
}
