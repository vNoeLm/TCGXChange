import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { getProfileUrl } from '../../lib/profileUrl';
import { resolveAvatarImageStyle } from '../profile/AvatarBannerModal';
import type { P2PPost, P2PPostTaggedCard } from '../../lib/p2pClient';
import { LikeButton } from './LikeButton';

interface PhotoPostCardProps {
  post: P2PPost;
  currentUserId: string | null;
  likeBusy?: boolean;
  onToggleLike: (postId: string) => void;
  onEditPost?: (post: P2PPost) => void;
}

/** Formats `@[Card Name · Number]` mentions cleanly as `@Card Name` for compact feed cards. */
export function cleanPostDescription(body: string, _taggedCards?: P2PPostTaggedCard[]): string {
  if (!body) return '';
  return body
    .replace(/@\[([^\]]+)\]/g, (_match, inner: string) => {
      const sepIdx = inner.lastIndexOf('·');
      const displayName = sepIdx !== -1 ? inner.slice(0, sepIdx).trim() : inner.trim();
      return displayName ? `@${displayName}` : '';
    })
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
    .replace(/(\*\*|~~|`|\*)/g, '')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^-{3,}$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function PhotoPostCard({
  post,
  currentUserId,
  likeBusy = false,
  onToggleLike,
  onEditPost,
}: PhotoPostCardProps) {
  const { t } = useLanguage();
  const { formatPrice } = useCurrency();
  const isOwner = Boolean(currentUserId && currentUserId === post.seller_id);
  const hasLotPrice = post.lot_price_huf != null && post.lot_price_huf > 0;
  const badgeLabel = hasLotPrice ? t('Lot / Post', 'Csomag') : t('Photo Post', 'Poszt');
  const profileUrl = getProfileUrl(post.seller);
  const itemUrl = `/marketplace/item?post=${encodeURIComponent(post.id)}`;
  const cleanBody = cleanPostDescription(post.body, post.tagged_cards);
  const soldOutPost = post.status === 'sold_out' || post.status === 'closed';

  const pricedTags = post.tagged_cards.filter(
    (tc) => !tc.is_highlight_only && tc.price_huf != null && tc.price_huf > 0 && tc.status !== 'sold' && tc.available_quantity > 0
  );
  const minCardPrice = pricedTags.length > 0 ? Math.min(...pricedTags.map((tc) => tc.price_huf!)) : null;

  const relativeDate = (() => {
    const ms = Date.now() - Date.parse(post.created_at);
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  })();

  const handleCardClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) {
      window.open(itemUrl, '_blank', 'noopener');
      return;
    }
    window.location.href = itemUrl;
  };

  return (
    <article
      onClick={handleCardClick}
      className="group rounded-2xl border overflow-hidden flex flex-col cursor-pointer transition hover:border-[var(--accent)]"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Hero Image */}
      {post.images.length > 0 && (
        <div
          className="relative aspect-[16/10] w-full overflow-hidden border-b"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          <img
            src={post.images[0]}
            alt={post.title || badgeLabel}
            loading="lazy"
            className="w-full h-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />

          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
            <span
              className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide backdrop-blur-md border"
              style={{
                background: 'rgba(9, 9, 11, 0.78)',
                borderColor: 'rgba(255, 255, 255, 0.14)',
                color: hasLotPrice ? '#60a5fa' : '#34d399',
              }}
            >
              {badgeLabel}
            </span>
            {hasLotPrice && post.bundle_pricing?.bundle_only && !soldOutPost && (
              <span
                className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide backdrop-blur-md border"
                style={{
                  background: 'rgba(9, 9, 11, 0.78)',
                  borderColor: 'rgba(255, 255, 255, 0.14)',
                  color: '#fbbf24',
                }}
              >
                {t('Bundle only', 'Csak egyben')}
              </span>
            )}
            {soldOutPost && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-rose-600 text-white shadow">
                {t('Sold', 'Eladva')}
              </span>
            )}
          </div>

          {post.images.length > 1 && (
            <span className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md text-[10px] font-black bg-black/75 text-white border border-white/15 backdrop-blur-sm">
              1 / {post.images.length}
            </span>
          )}

          <div
            className="absolute top-2.5 right-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <LikeButton
              liked={post.liked_by_me}
              count={post.likes_count}
              busy={likeBusy}
              onToggle={() => onToggleLike(post.id)}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col gap-2.5">
        {/* Seller row */}
        <div className="flex items-center justify-between gap-2">
          <a
            href={profileUrl}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 min-w-0 hover:underline"
          >
            {post.seller.avatar_url ? (
              <img
                src={post.seller.avatar_url}
                alt={post.seller.display_name}
                className="w-7 h-7 rounded-full object-cover border shrink-0"
                style={{ borderColor: 'var(--border)', ...resolveAvatarImageStyle(post.seller.avatar_url) }}
              />
            ) : (
              <div
                className="w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-black shrink-0"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--accent)' }}
              >
                {post.seller.display_name[0]?.toUpperCase() || 'U'}
              </div>
            )}
            <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
              {post.seller.display_name}
            </span>
            <span className="text-[10px] font-bold shrink-0" style={{ color: 'var(--text-tertiary)' }}>
              {post.seller.country} · {relativeDate}
            </span>
            {post.seller.rating_count > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-400 shrink-0">
                <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span>{post.seller.rating_avg.toFixed(1)}</span>
              </span>
            )}
          </a>

          {post.images.length === 0 && (
            <div onClick={(e) => e.stopPropagation()}>
              <LikeButton
                liked={post.liked_by_me}
                count={post.likes_count}
                busy={likeBusy}
                onToggle={() => onToggleLike(post.id)}
              />
            </div>
          )}
        </div>

        {/* Title & Body */}
        <div>
          <h3 className="text-sm sm:text-base font-black leading-snug group-hover:underline" style={{ color: 'var(--text-primary)' }}>
            {post.title || (hasLotPrice ? t('Card Lot', 'Kártyacsomag') : t('Photo Post', 'Képes poszt'))}
          </h3>
          {cleanBody && (
            <p className="text-xs leading-relaxed mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
              {cleanBody}
            </p>
          )}
        </div>

        {/* Tagged cards shown ONCE cleanly as compact summary pills */}
        {post.tagged_cards.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {post.tagged_cards.slice(0, 3).map((tc) => {
              const sold = tc.status === 'sold' || tc.quantity <= 0;
              return (
                <span
                  key={tc.id}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
                    sold ? 'line-through opacity-55' : ''
                  }`}
                  style={{
                    background: 'var(--bg-surface-2)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span className="truncate max-w-[140px]">{tc.card?.name}</span>
                  {tc.price_huf != null && tc.price_huf > 0 && (
                    <span className="font-mono font-bold text-emerald-400">{formatPrice(tc.price_huf)}</span>
                  )}
                  {sold && (
                    <span className="text-[9px] font-black uppercase text-rose-400 no-underline">
                      {t('Sold', 'Eladva')}
                    </span>
                  )}
                </span>
              );
            })}
            {post.tagged_cards.length > 3 && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold"
                style={{ color: 'var(--text-accent)' }}
              >
                +{post.tagged_cards.length - 3} {t('more', 'további')}
              </span>
            )}
          </div>
        )}

        {/* Footer: Price + Edit / View */}
        <div
          className="mt-auto pt-3 border-t flex items-center justify-between gap-2"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="min-w-0">
            {hasLotPrice ? (
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Lot:', 'Egyben:')}
                </span>
                <span className="text-lg font-black font-mono text-emerald-400">
                  {formatPrice(post.lot_price_huf!)}
                </span>
              </div>
            ) : minCardPrice != null ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                  {t('From', 'Ettől:')}
                </span>
                <span className="text-base font-black font-mono text-emerald-400">
                  {formatPrice(minCardPrice)}
                </span>
              </div>
            ) : (
              <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                {post.tagged_cards.length > 0
                  ? `${post.tagged_cards.length} ${t('tagged cards', 'megjelölt lap')}`
                  : t('Open details', 'Részletek megnyitása')}
              </span>
            )}
          </div>

          <div
            className="flex items-center gap-1.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {isOwner && onEditPost && (
              <button
                type="button"
                onClick={() => onEditPost(post)}
                className="px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer hover:border-[var(--accent)]"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {t('Edit', 'Módosítás')}
              </button>
            )}
            <a
              href={itemUrl}
              className="px-3 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1 transition hover:brightness-110"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
            >
              <span>{t('Open', 'Megnyitás')}</span>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
