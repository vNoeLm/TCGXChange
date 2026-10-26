import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { MarketplaceBulkListing } from '../../types';
import { supabase } from '../../lib/supabase';
import { useExitTransition } from '../../lib/useExitTransition';
import { useCurrentUserId } from '../../lib/useCurrentUserId';
import { useCurrency } from '../../lib/currency';
import { CountryFlag } from '../CountryFlag';
import { ListingLikeButton } from './ListingLikeButton';
import { handoverLabel } from '../../lib/handover';
import { formatPricePerCard } from '../../lib/bulkHelpers';
import { ImageViewer } from '../CardImageViewer';

interface BulkDetailModalProps {
  bulk: MarketplaceBulkListing | null;
  onClose: () => void;
  onChanged?: () => void;
}

export function BulkDetailModal({ bulk, onClose, onChanged }: BulkDetailModalProps) {
  const { rendered, state } = useExitTransition(Boolean(bulk), 220);
  const currentUserId = useCurrentUserId();
  const { formatPrice } = useCurrency();

  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState(0);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [selectedHandover, setSelectedHandover] = useState(bulk?.handover_methods?.[0] || 'personal');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);

  if (!rendered || !bulk) return null;

  const isOwnListing = Boolean(currentUserId && bulk.seller_id === currentUserId);
  const photos = Array.isArray(bulk.images) && bulk.images.length > 0 ? bulk.images : [];
  const activePhoto = photos[selectedPhotoIdx] || photos[0] || '';

  const handleRequestHold = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        setErrorMsg('Please sign in to buy or request a hold on this bulk lot.');
        setSubmitting(false);
        return;
      }

      const res = await fetch('/api/marketplace/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'request_hold',
          bulk_id: bulk.id,
          preferred_handover: selectedHandover,
          message,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to submit hold request.');
      }

      setSuccessMsg(true);
      if (onChanged) onChanged();
      setTimeout(() => {
        if (json.conversation_id) {
          window.location.href = `/messages?conversation_id=${json.conversation_id}`;
        }
      }, 900);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error requesting hold.');
    } finally {
      setSubmitting(false);
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
          <div className="flex items-center gap-3 min-w-0">
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
              Bulk Lot
            </span>
            <h2 className="text-base sm:text-lg font-black truncate" style={{ color: 'var(--text-primary)' }}>
              {bulk.title}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ListingLikeButton id={bulk.id} type="listing" initialCount={bulk.likes_count || 0} alwaysShowCount showLabel variant="surface" />
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
          {/* Left: Gallery */}
          <div className="space-y-3">
            <div
              className={`aspect-[4/3] w-full rounded-xl overflow-hidden border bg-zinc-900 relative ${
                activePhoto ? 'cursor-zoom-in group' : ''
              }`}
              style={{ borderColor: 'var(--border)' }}
              onClick={() => activePhoto && setImageViewerOpen(true)}
            >
              {activePhoto ? (
                <>
                  <img
                    src={activePhoto}
                    alt={bulk.title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
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
                <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500 font-bold">
                  No Image
                </div>
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
                      idx === selectedPhotoIdx ? 'border-emerald-400' : 'border-transparent opacity-60'
                    }`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Specs & Action */}
          <div className="flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  Lot Price
                </span>
                <div className="text-right">
                  <div className="text-2xl font-black text-emerald-400">
                    {formatPrice(bulk.price_huf)}
                  </div>
                  {formatPricePerCard(bulk.price_huf, bulk.exact_card_count, bulk.approx_card_count, formatPrice) && (
                    <div className="text-xs font-bold mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {formatPricePerCard(bulk.price_huf, bulk.exact_card_count, bulk.approx_card_count, formatPrice)}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                {bulk.exact_card_count && (
                  <div>
                    <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>Exact Count</div>
                    <div className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>{bulk.exact_card_count} Cards</div>
                  </div>
                )}
                {bulk.approx_card_count && (
                  <div>
                    <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>Approx. Count</div>
                    <div className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>~{bulk.approx_card_count} Cards</div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>Condition</div>
                  <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{bulk.condition}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>Foils Included</div>
                  <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{bulk.includes_foil ? 'Yes' : 'No'}</div>
                </div>
              </div>

              {bulk.description && (
                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>Seller Notes</div>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap p-3 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
                    {bulk.description}
                  </p>
                </div>
              )}

              {/* Seller Info */}
              <div className="flex items-center justify-between p-3 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2.5">
                  {bulk.seller_avatar ? (
                    <img src={bulk.seller_avatar} alt={bulk.seller_name} className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white" style={{ background: 'var(--accent-strong)' }}>
                      {(bulk.seller_name || 'S')[0].toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>{bulk.seller_name}</span>
                      {bulk.seller_country && <CountryFlag countryCode={bulk.seller_country} className="w-3.5 h-2.5 rounded-xs" />}
                    </div>
                    {typeof bulk.seller_rating_avg === 'number' && (
                      <div className="text-[11px] font-bold text-amber-400">
                        &#9733; {bulk.seller_rating_avg.toFixed(1)} ({bulk.seller_rating_count || 0})
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Buy / Request Hold Form */}
            {!isOwnListing && bulk.status === 'in_stock' && (
              <form onSubmit={handleRequestHold} className="space-y-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                {errorMsg && (
                  <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-bold">
                    {errorMsg}
                  </div>
                )}
                {successMsg && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                    Hold requested! Opening conversation in Messages...
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Preferred Handover / Shipping
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(bulk.handover_methods || ['personal']).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSelectedHandover(m)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                          selectedHandover === m
                            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                            : 'border-[var(--border)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {handoverLabel(m)}
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  type="text"
                  placeholder="Optional message to seller..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-medium border outline-none"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />

                <button
                  type="submit"
                  disabled={submitting || successMsg}
                  className="w-full py-3 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-400 text-zinc-950 cursor-pointer transition shadow-lg disabled:opacity-50"
                >
                  {submitting ? 'Sending Hold Request...' : 'Request Hold / Buy Bulk Lot'}
                </button>
              </form>
            )}

            {bulk.status !== 'in_stock' && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold text-center">
                This bulk lot is currently {bulk.status === 'on_hold' ? 'on hold' : 'sold'}.
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
          alt={bulk.title}
        />
      )}
    </>,
    document.body
  );
}
