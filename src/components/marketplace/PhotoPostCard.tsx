import { Fragment, useState } from 'react';
import { formatCondition } from '../../lib/collectionDefaults';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { cardThumbProps } from '../../lib/supabase';
import { getProfileUrl } from '../../lib/profileUrl';
import { resolveAvatarImageStyle } from '../profile/AvatarBannerModal';
import type { P2PPost, P2PPostTaggedCard } from '../../lib/p2pClient';
import type { HoldTarget } from './HoldConfirmModal';
import { LikeButton } from './LikeButton';

interface PhotoPostCardProps {
  post: P2PPost;
  currentUserId: string | null;
  likeBusy?: boolean;
  onToggleLike: (postId: string) => void;
  onHoldRequest: (target: HoldTarget) => void;
  onMessageSeller: (sellerId: string, prefill?: string) => void;
  onDeletePost?: (postId: string) => void;
  onMarkSoldOut?: (postId: string) => void;
}

function renderFormattedPostBody(body: string) {
  if (!body) return null;
  const parts = body.split(/(@\[[^\]]+\])/g);
  return (
    <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>
      {parts.map((part, idx) => {
        if (part.startsWith('@[') && part.endsWith(']')) {
          const inner = part.slice(2, -1);
          return (
            <span
              key={idx}
              className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md font-bold text-[11px] border"
              style={{
                background: 'var(--accent-muted)',
                borderColor: 'var(--accent-border)',
                color: 'var(--text-accent)',
              }}
            >
              {inner}
            </span>
          );
        }
        return <Fragment key={idx}>{part}</Fragment>;
      })}
    </p>
  );
}

export function PhotoPostCard({
  post,
  currentUserId,
  likeBusy = false,
  onToggleLike,
  onHoldRequest,
  onMessageSeller,
  onDeletePost,
  onMarkSoldOut,
}: PhotoPostCardProps) {
  const { lang, t } = useLanguage();
  const { formatPrice } = useCurrency();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const isOwner = Boolean(currentUserId && currentUserId === post.seller_id);
  const isBulk = post.post_type === 'bulk';
  const profileUrl = getProfileUrl(post.seller);

  const relativeDate = (() => {
    const ms = Date.now() - Date.parse(post.created_at);
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  })();

  const openPostCardHold = (tc: P2PPostTaggedCard) => {
    if (!tc.price_huf || tc.is_highlight_only) return;
    onHoldRequest({
      mode: 'post_card',
      title: tc.card.name,
      subtitle: `${tc.card.card_number}${tc.is_foil ? ' · Foil' : ''} · ${formatCondition(tc.condition, lang)}`,
      sellerName: post.seller.display_name,
      priceHuf: tc.price_huf,
      maxQuantity: tc.available_quantity,
      postId: post.id,
      postCardId: tc.id,
      imageUrl: tc.card.image_path ? cardThumbProps(tc.card.image_path, 'avatar').src : post.images?.[0] || null,
    });
  };

  return (
    <article
      className="rounded-2xl border overflow-hidden flex flex-col"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between gap-3">
        <a href={profileUrl} className="flex items-center gap-2.5 min-w-0 group">
          {post.seller.avatar_url ? (
            <img
              src={post.seller.avatar_url}
              alt={post.seller.display_name}
              className="w-9 h-9 rounded-full object-cover border shrink-0"
              style={{ borderColor: 'var(--border)', ...resolveAvatarImageStyle(post.seller.avatar_url) }}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-full border flex items-center justify-center text-xs font-black shrink-0"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--accent)' }}
            >
              {post.seller.display_name[0]?.toUpperCase() || 'U'}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs sm:text-sm font-black truncate group-hover:underline" style={{ color: 'var(--text-primary)' }}>
                {post.seller.display_name}
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
              >
                {post.seller.country}
              </span>
              {post.seller.rating_count > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-400">
                  <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <span>{post.seller.rating_avg.toFixed(1)}</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>({post.seller.rating_count})</span>
                </span>
              )}
            </div>
            <div className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-tertiary)' }}>
              <span>{relativeDate}</span>
              <span>·</span>
              <span className="font-semibold" style={{ color: 'var(--text-accent)' }}>
                {isBulk ? t('Bulk Lot', 'Bulk csomag') : t('Photo Post', 'Fotós poszt')}
              </span>
              {post.status !== 'open' && (
                <>
                  <span>·</span>
                  <span className="uppercase font-black text-amber-400">{post.status}</span>
                </>
              )}
            </div>
          </div>
        </a>

        <div className="flex items-center gap-1.5 shrink-0">
          <LikeButton
            liked={post.liked_by_me}
            count={post.likes_count}
            busy={likeBusy}
            onToggle={() => onToggleLike(post.id)}
          />
          {isOwner && onMarkSoldOut && post.status === 'open' && (
            <button
              type="button"
              onClick={() => onMarkSoldOut(post.id)}
              className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              {t('Mark Sold', 'Eladva')}
            </button>
          )}
          {isOwner && onDeletePost && (
            <button
              type="button"
              onClick={() => onDeletePost(post.id)}
              title={t('Delete post', 'Poszt törlése')}
              className="w-8 h-8 rounded-xl border flex items-center justify-center text-rose-400 hover:bg-rose-500/10 cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Title & Body */}
      <div className="px-4 pb-3 flex flex-col gap-1.5">
        <a
          href={`/marketplace/item?post=${encodeURIComponent(post.id)}`}
          className="text-sm sm:text-base font-black hover:underline self-start"
          style={{ color: 'var(--text-primary)' }}
        >
          {post.title || (isBulk ? t('Bulk Card Lot', 'Bulk csomag') : t('Photo Post', 'Fotós poszt'))}
        </a>
        {renderFormattedPostBody(post.body)}
      </div>

      {/* Photo Grid */}
      {post.images.length > 0 && (
        <div
          className={`grid gap-1 px-4 pb-3 ${
            post.images.length === 1
              ? 'grid-cols-1'
              : post.images.length === 2
              ? 'grid-cols-2'
              : 'grid-cols-2 sm:grid-cols-3'
          }`}
        >
          {post.images.map((url, idx) => (
            <button
              key={`${url}-${idx}`}
              type="button"
              onClick={() => setLightboxUrl(url)}
              className={`relative rounded-xl overflow-hidden border cursor-pointer group ${
                post.images.length === 1 ? 'max-h-[420px] aspect-[16/10]' : 'aspect-[4/3]'
              }`}
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}
            >
              <img
                src={url}
                alt={post.title || `Post image ${idx + 1}`}
                loading="lazy"
                className="w-full h-full object-cover transition duration-300 group-hover:scale-[1.02]"
              />
            </button>
          ))}
        </div>
      )}

      {/* Bulk Lot CTA Bar */}
      {isBulk && (
        <div
          className="mx-4 mb-3 p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3"
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
        >
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              {t('Fixed Lot Price', 'Teljes csomag ára')}
            </div>
            <div className="text-lg font-black" style={{ color: 'var(--text-accent)' }}>
              {post.lot_price_huf != null ? formatPrice(post.lot_price_huf) : t('See description', 'Lásd a leírásban')}
            </div>
          </div>

          {!isOwner && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onMessageSeller(
                    post.seller_id,
                    t(`Hi! Question about your bulk lot: ${post.title || ''}`, `Szia! Kérdésem lenne a bulk csomagoddal kapcsolatban: ${post.title || ''}`)
                  )
                }
                className="px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer hover:border-[var(--accent)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {t('Message Seller', 'Üzenet')}
              </button>
              {post.status === 'open' && post.lot_price_huf != null && (
                <button
                  type="button"
                  onClick={() =>
                    onHoldRequest({
                      mode: 'bulk_lot',
                      title: post.title || t('Bulk Card Lot', 'Bulk csomag'),
                      subtitle: t('Entire lot', 'Teljes csomag'),
                      sellerName: post.seller.display_name,
                      priceHuf: post.lot_price_huf!,
                      maxQuantity: 1,
                      postId: post.id,
                      imageUrl: post.images[0] || null,
                    })
                  }
                  className="px-4 py-2 rounded-xl text-xs font-black cursor-pointer"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                >
                  {t('Hold Bulk Lot', 'Csomag félretétele')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tagged Cards Panel */}
      {post.tagged_cards.length > 0 && (
        <div
          className="px-4 py-3 border-t flex flex-col gap-2"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              {isBulk
                ? t('Highlighted Cards Inside', 'Kiemelt lapok a csomagban')
                : t('Cards Tagged in This Post', 'Megjelölt lapok ebben a posztban')} ({post.tagged_cards.length})
            </span>
            {!isOwner && !isBulk && (
              <button
                type="button"
                onClick={() =>
                  onMessageSeller(
                    post.seller_id,
                    t(`Hi! Interested in cards from your photo post.`, `Szia! Érdekelnének a fotós posztodban lévő lapok.`)
                  )
                }
                className="text-[11px] font-bold hover:underline cursor-pointer"
                style={{ color: 'var(--text-accent)' }}
              >
                {t('Ask Seller About Bundle', 'Kérdés az eladótól')}
              </button>
            )}
          </div>

          {isBulk ? (
            <div className="flex flex-wrap gap-1.5">
              {post.tagged_cards.map((tc) => (
                <a
                  key={tc.id}
                  href={`/?q=${encodeURIComponent(tc.card?.card_number || tc.card?.name || '')}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition hover:border-[var(--accent)]"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <span>{tc.card?.name}</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>{tc.card?.card_number}</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {post.tagged_cards.map((tc) => {
                const thumb = tc.card?.image_path ? cardThumbProps(tc.card.image_path, 'avatar') : null;
                const soldOut = tc.status === 'sold' || tc.quantity <= 0;
                const allHeld = !soldOut && tc.available_quantity <= 0;
                const hasFixedPrice = !tc.is_highlight_only && tc.price_huf != null && tc.price_huf > 0;

                return (
                  <div
                    key={tc.id}
                    className="p-2 rounded-xl border flex items-center justify-between gap-2.5"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {thumb && (
                        <img
                          src={thumb.src}
                          alt={tc.card?.name}
                          className="w-8 h-11 rounded object-cover shrink-0 border"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                          {tc.card?.name}
                        </div>
                        <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                          {tc.card?.card_number} · {formatCondition(tc.condition, lang)}
                          {tc.is_foil ? ' · Foil' : ''}
                        </div>
                        <div className="text-[11px] font-black mt-0.5" style={{ color: hasFixedPrice ? 'var(--text-accent)' : 'var(--text-secondary)' }}>
                          {hasFixedPrice
                            ? `${formatPrice(tc.price_huf)} · ${tc.available_quantity}/${tc.quantity}`
                            : t('Ask in chat', 'Ár üzenetben')}
                        </div>
                      </div>
                    </div>

                    {!isOwner && (
                      <div className="shrink-0">
                        {soldOut ? (
                          <span className="text-[10px] font-black uppercase px-2 py-1 rounded bg-zinc-800 text-zinc-400">
                            {t('Sold', 'Eladva')}
                          </span>
                        ) : allHeld ? (
                          <span className="text-[10px] font-black uppercase px-2 py-1 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            {t('Held', 'Félretéve')}
                          </span>
                        ) : hasFixedPrice ? (
                          <button
                            type="button"
                            onClick={() => openPostCardHold(tc)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-black cursor-pointer"
                            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                          >
                            {t('Hold', 'Félreteszem')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onMessageSeller(
                                post.seller_id,
                                t(
                                  `Hi! How much would you ask for ${tc.card?.name} (${tc.card?.card_number})?`,
                                  `Szia! Mennyiért adnád a ${tc.card?.name} (${tc.card?.card_number}) lapot?`
                                )
                              )
                            }
                            className="px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer hover:border-[var(--accent)]"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                          >
                            {t('Message', 'Üzenet')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[2500] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Full size preview"
            className="max-w-full max-h-[90vh] rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </article>
  );
}
