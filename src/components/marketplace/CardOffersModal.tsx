import { useEffect } from 'react';
import { formatCondition } from '../../lib/collectionDefaults';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { cardThumbProps } from '../../lib/supabase';
import { getProfileUrl } from '../../lib/profileUrl';
import type { P2PCardGroup, P2PListing } from '../../lib/p2pClient';
import type { HoldTarget } from './HoldConfirmModal';
import { LikeButton } from './LikeButton';

interface CardOffersModalProps {
  group: P2PCardGroup;
  currentUserId: string | null;
  likeBusyId: string | null;
  onClose: () => void;
  onToggleLike: (listingId: string) => void;
  onAddToCart: (listing: P2PListing) => void;
  onHoldNow: (target: HoldTarget) => void;
  onMessageSeller: (sellerId: string, prefill?: string) => void;
}

export function CardOffersModal({
  group,
  currentUserId,
  likeBusyId,
  onClose,
  onToggleLike,
  onAddToCart,
  onHoldNow,
  onMessageSeller,
}: CardOffersModalProps) {
  const { lang, t } = useLanguage();
  const { formatPrice } = useCurrency();
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const thumb = group.card.image_path ? cardThumbProps(group.card.image_path, 'grid') : null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-4 border-b flex items-center justify-between gap-4 shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            {thumb && (
              <img
                src={thumb.src}
                alt={group.card.name}
                className="w-11 h-15 rounded-lg object-cover border shrink-0"
                style={{ borderColor: 'var(--border)' }}
              />
            )}
            <div className="min-w-0">
              <h2 className="text-base font-black truncate" style={{ color: 'var(--text-primary)' }}>
                {group.card.name} {group.is_foil ? '(Foil)' : ''}
              </h2>
              <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                {group.card.card_number} {group.card.sets?.name ? `· ${group.card.sets.name}` : ''} · {group.offer_count}{' '}
                {t('offers', 'ajánlat')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl border flex items-center justify-center hover:bg-[var(--bg-raised)] cursor-pointer shrink-0"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-2.5">
          {group.offers.map((offer) => {
            const isOwn = Boolean(currentUserId && currentUserId === offer.seller_id);
            return (
              <div
                key={offer.id}
                className="p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start gap-3 min-w-0">
                  {offer.images?.[0] && (
                    <img
                      src={offer.images[0]}
                      alt={offer.card.name}
                      className="w-12 h-16 rounded-lg object-cover border shrink-0"
                      style={{ borderColor: 'var(--border)' }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={getProfileUrl(offer.seller)}
                        className="text-xs font-black hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {offer.seller.display_name}
                      </a>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
                      >
                        {offer.seller.country}
                      </span>
                      {offer.seller.rating_count > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-400">
                          <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                          <span>{offer.seller.rating_avg.toFixed(1)}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>({offer.seller.rating_count})</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      <span className="font-bold">{formatCondition(offer.condition, lang)}</span>
                      <span>·</span>
                      <span>
                        {offer.quantity} {t('available', 'elérhető')}
                      </span>
                    </div>
                    {offer.description && (
                      <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>
                        {offer.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                  <div className="text-right mr-1">
                    <div className="text-sm font-black" style={{ color: 'var(--text-accent)' }}>
                      {formatPrice(offer.price_huf)}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {t('per card', '/ db')}
                    </div>
                  </div>

                  <LikeButton
                    compact
                    liked={offer.liked_by_me}
                    count={offer.likes_count}
                    busy={likeBusyId === offer.id}
                    onToggle={() => onToggleLike(offer.id)}
                  />

                  {!isOwn && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          onMessageSeller(
                            offer.seller_id,
                            t(
                              `Hi! Interested in your ${offer.card.name} (${offer.card.card_number}).`,
                              `Szia! Érdekelne a ${offer.card.name} (${offer.card.card_number}) lapod.`
                            )
                          )
                        }
                        className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer hover:border-[var(--accent)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        {t('Chat', 'Üzenet')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddToCart(offer)}
                        className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer hover:border-[var(--accent)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        {t('+ Cart', '+ Kosár')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onHoldNow({
                            mode: 'listing',
                            title: offer.card.name,
                            subtitle: `${offer.card.card_number}${offer.is_foil ? ' · Foil' : ''} · ${formatCondition(offer.condition, lang)}`,
                            sellerName: offer.seller.display_name,
                            priceHuf: offer.price_huf,
                            maxQuantity: offer.quantity,
                            listingId: offer.id,
                            imageUrl: offer.images?.[0] || cardThumbProps(offer.card.image_path, 'avatar').src,
                          })
                        }
                        className="px-3 py-1.5 rounded-xl text-[11px] font-black cursor-pointer"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                      >
                        {t('Hold', 'Félretétel')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
