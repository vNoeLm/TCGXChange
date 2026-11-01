import React from 'react';
import type { SellerProfileSummary } from '../../types';
import { ReputationBreakdown, ReviewCard, useReputation } from '../reviews/ReviewParts';
import { getSellerTier, BadgeIconSvg, SiteOwnerTag } from '../../lib/badges';
import { useSiteTheme } from '../../lib/theme';
import { useExitTransition } from '../../lib/useExitTransition';
import { useLanguage } from '../../lib/i18n';

interface SellerReviewsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerId: string;
  sellerSummary: SellerProfileSummary | null;
}

export function SellerReviewsModal({ isOpen, onClose, sellerId, sellerSummary }: SellerReviewsModalProps) {
  const isLightTheme = useSiteTheme().theme === 'light';
  const { t, lang } = useLanguage();
  const rep = useReputation(isOpen ? sellerId : null);
  const loading = isOpen && !rep;
  const reviews = (rep?.reviews || []).filter(r => r.direction === 'buyer_to_seller');

  const { rendered, state } = useExitTransition(isOpen, 250);
  if (!rendered) return null;

  return (
    <div
      data-state={state}
      className="tv-overlay fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-state={state}
        className="tv-modal-panel relative w-full max-w-lg rounded-2xl p-5 sm:p-7 shadow-2xl border my-8 max-h-[90vh] flex flex-col"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
        }}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full flex items-center justify-center transition border cursor-pointer hover:bg-white/10 active:scale-95"
          style={{
            background: 'var(--bg-surface-2)',
            borderColor: 'var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header (Seller Info) */}
        <div className="flex items-center gap-3 mb-6">
          {sellerSummary?.avatar_url ? (
            <img
              src={sellerSummary.avatar_url}
              alt={sellerSummary.display_name || 'Seller'}
              className="w-12 h-12 rounded-full object-cover border border-amber-400/40 shrink-0"
            />
          ) : (
            <div 
              className="w-12 h-12 rounded-full flex items-center justify-center font-black text-lg shrink-0 border"
              style={{
                background: 'var(--accent-muted)',
                borderColor: 'var(--accent)',
                color: 'var(--text-accent)',
              }}
            >
              {sellerSummary?.display_name ? sellerSummary.display_name[0].toUpperCase() : 'S'}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {sellerSummary?.id ? (
                <a
                  href={`/user?id=${sellerSummary.id}`}
                  className="text-lg font-black truncate hover:underline"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {sellerSummary.display_name || 'Seller Reviews'}
                </a>
              ) : (
                <h2 className="text-lg font-black truncate" style={{ color: 'var(--text-primary)' }}>
                  {sellerSummary?.display_name || 'Seller Reviews'}
                </h2>
              )}
              {sellerSummary && (() => {
                const isOwner = Boolean(sellerSummary.is_owner || sellerSummary.role === 'owner');
                const tier = getSellerTier(sellerSummary.sales_count, sellerSummary.rating_avg, isOwner, isLightTheme);
                return (
                  <>
                    {isOwner && <SiteOwnerTag />}
                    <span
                      className="text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 border"
                      style={tier.badgeStyle}
                      title={tier.nameEn}
                    >
                      <BadgeIconSvg iconType={tier.iconType} className="w-3 h-3" />
                      <span>{lang === 'hu' ? (tier.nameEn === 'New Seller' ? 'Új eladó' : tier.nameEn.replace('Tier ', '').replace(' Seller', '. szintű eladó')) : tier.nameEn}</span>
                    </span>
                  </>
                );
              })()}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs sm:text-sm" style={{ color: 'var(--text-tertiary)' }}>
              {sellerSummary && sellerSummary.rating_count > 0 && sellerSummary.rating_avg !== null ? (
                <>
                  <div className="flex items-center gap-1 text-amber-400 font-bold">
                    <svg className="w-3.5 h-3.5 fill-current text-amber-400 shrink-0" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg><span>{sellerSummary.rating_avg.toFixed(1)}</span>
                  </div>
                  <span>•</span>
                  <span>
                    {lang === 'hu' ? `${sellerSummary.rating_count} értékelés` : `${sellerSummary.rating_count} ${sellerSummary.rating_count === 1 ? 'rating' : 'ratings'}`}
                  </span>
                </>
              ) : (
                <span className="text-zinc-400 text-xs">
                  {t('New Seller (No ratings yet)', 'Új eladó (még nincs értékelés)')}
                </span>
              )}
            </div>
          </div>
        </div>

        {rep && rep.as_seller.count > 0 && (
          <div className="rounded-xl p-3 sm:p-4 border mb-4" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
            <ReputationBreakdown direction="buyer_to_seller" rep={rep.as_seller} emptyText="" />
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
              {lang === 'hu' ? `${rep.stats.itemsSold} eladott kártya ${rep.stats.salesCount} tranzakcióban` : `Sold ${rep.stats.itemsSold} card${rep.stats.itemsSold === 1 ? '' : 's'} in ${rep.stats.salesCount} sale${rep.stats.salesCount === 1 ? '' : 's'}`}
            </p>
          </div>
        )}

        {/* Reviews List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2">
          {loading ? (
            <div className="text-center py-10 text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              {t('Loading reviews...', 'Értékelések betöltése...')}
            </div>
          ) : reviews.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              {t('This seller has no reviews yet.', 'Ennek az eladónak még nincsenek értékelései.')}
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
