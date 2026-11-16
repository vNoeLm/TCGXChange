import React from 'react';
import { formatCondition } from '../../lib/collectionDefaults';
import { splitCardTitle, formatCleanCardNumber } from '../../lib/formatGameText';
import { isAltArt, isOvernumbered, isSigned } from '../../lib/cardVariants';
import { printLanguage } from '../../lib/cardPreview';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import type { GridSize } from '../../lib/gridSize';
import { cardThumbProps, gridThumbSize } from '../../lib/supabase';
import { getProfileUrl } from '../../lib/profileUrl';
import type { P2PCardGroup, P2PListing } from '../../lib/p2pClient';
import { resolveAvatarImageStyle } from '../profile/AvatarBannerModal';
import { LikeButton } from './LikeButton';

const RARITY_COLORS: Record<string, { border: string; glow: string }> = {
  Common:   { border: 'rgba(161, 161, 170, 0.6)', glow: 'rgba(161, 161, 170, 0.25)' },
  Uncommon: { border: '#38bdf8', glow: 'rgba(56, 189, 248, 0.5)' },
  Rare:     { border: '#c084fc', glow: 'rgba(168, 85, 247, 0.5)' },
  Epic:     { border: '#fb923c', glow: 'rgba(249, 115, 22, 0.5)' },
  Showcase: { border: '#facc15', glow: 'rgba(250, 204, 21, 0.6)' },
};

interface CardGroupTileProps {
  group: P2PCardGroup;
  gridSize: GridSize;
  onOpen: () => void;
}

export function MarketplaceCardGroupTile({ group, gridSize, onOpen }: CardGroupTileProps) {
  const { t } = useLanguage();
  const { formatPrice } = useCurrency();
  const isSmall = gridSize === 'small';
  const card = group.card;
  const rarityStyle = RARITY_COLORS[card.rarity] ?? { border: 'rgba(209,213,219,0.6)', glow: 'rgba(209,213,219,0.3)' };
  const { main, sub } = splitCardTitle(card.name);
  const offerWord = group.offer_count === 1 ? t('offer', 'ajánlat') : t('offers', 'ajánlat');

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="rounded-2xl overflow-hidden flex flex-col h-full cursor-pointer group/card"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = `0 16px 40px rgba(0,0,0,0.6), 0 0 20px ${rarityStyle.glow}`;
        (e.currentTarget as HTMLElement).style.borderColor = rarityStyle.border;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-card)';
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      <div
        className="w-full aspect-[63/88] flex items-center justify-center relative overflow-hidden border-b"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
      >
        {card.image_path ? (
          <img
            {...cardThumbProps(card.image_path, gridThumbSize(gridSize))}
            alt={card.name}
            className="w-full h-full object-cover relative z-[1]"
          />
        ) : (
          <div className="text-3xl font-black" style={{ color: 'var(--text-tertiary)' }}>
            {card.name.slice(0, 2).toUpperCase()}
          </div>
        )}

        {group.is_foil && (
          <span className="absolute top-2 left-2 z-[3] px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-500 text-zinc-950 shadow-md">
            Foil
          </span>
        )}

        <div className="absolute top-2 right-2 z-[3] flex flex-col items-end gap-1">
          {printLanguage(card.name) && (
            <span className="px-1.5 py-0.5 text-[9px] font-black rounded-md uppercase bg-slate-900/95 text-white border border-white/25">
              {printLanguage(card.name)}
            </span>
          )}
          {isSigned(card) && (
            <span className="px-2 py-0.5 text-[10px] font-black rounded-lg uppercase bg-purple-600 text-white border border-purple-300 shadow">
              SIGNED
            </span>
          )}
        </div>

        <div className="absolute bottom-1.5 left-1.5 z-[3] flex flex-col items-start gap-1">
          {isAltArt(card) && (
            <span className="px-2 py-0.5 text-[10px] font-black rounded-lg uppercase bg-pink-600 text-white border border-pink-300 shadow">
              ALT ART
            </span>
          )}
          {isOvernumbered(card) && (
            <span className="px-2 py-0.5 text-[10px] font-black rounded-lg uppercase bg-indigo-600 text-white border border-indigo-300 shadow">
              ON
            </span>
          )}
        </div>

        <span className="absolute bottom-2 right-2 z-[3] px-2 py-0.5 rounded-lg text-[11px] font-black bg-zinc-950/90 text-white border border-white/20 shadow">
          {group.offer_count} {offerWord}
        </span>
      </div>

      <div className={`${isSmall ? 'p-2.5' : 'p-3'} flex flex-col flex-grow justify-between`}>
        <div>
          <div className={`text-center flex flex-col justify-center gap-0.5 ${isSmall ? 'min-h-[30px]' : 'min-h-[36px]'}`}>
            <h3 className={`${isSmall ? 'text-xs' : 'text-sm'} font-black leading-tight uppercase tracking-tight truncate`} style={{ color: 'var(--text-primary)' }}>
              {main}
            </h3>
            {sub && (
              <p className="text-[10px] font-bold uppercase tracking-widest truncate" style={{ color: 'var(--text-tertiary)' }}>
                {sub}
              </p>
            )}
          </div>

          <p className="text-[11px] font-medium truncate mt-1 mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            {card.sets?.name || ''}
          </p>

          <div className={`grid grid-cols-3 items-center w-full font-mono ${isSmall ? 'text-[10px] mb-2' : 'text-[11px] mb-2.5'}`} style={{ color: 'var(--text-secondary)' }}>
            <span className="truncate text-left">{formatCleanCardNumber(card.card_number)}</span>
            <span className="capitalize truncate text-center font-medium">
              {(card.subtype || '').toLowerCase() === 'champion' ? 'Champion' : card.card_type || ''}
            </span>
            <span className="capitalize truncate text-right font-medium" style={{ color: 'var(--text-tertiary)' }}>
              {card.rarity || ''}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className={`${isSmall ? 'text-sm' : 'text-base sm:text-lg'} font-black font-mono text-emerald-400`}>
            {formatPrice(group.lowest_price_huf)}
          </span>
          <span className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>
            {group.total_quantity} {t('In Stock', 'elérhető')}
          </span>
        </div>
      </div>
    </div>
  );
}

interface ListingTileProps {
  listing: P2PListing;
  gridSize: GridSize;
  isOwn: boolean;
  likeBusy: boolean;
  onOpenDetail: () => void;
  onToggleLike: () => void;
  onHold: () => void;
  onAddToCart: () => void;
  onMessage: () => void;
  onEdit: () => void;
}

export function MarketplaceListingTile({
  listing,
  gridSize,
  isOwn,
  likeBusy,
  onOpenDetail,
  onToggleLike,
  onHold,
  onAddToCart,
  onMessage,
  onEdit,
}: ListingTileProps) {
  const { lang, t } = useLanguage();
  const { formatPrice } = useCurrency();
  const isSmall = gridSize === 'small';
  const card = listing.card;
  const rarityStyle = RARITY_COLORS[card.rarity] ?? { border: 'rgba(209,213,219,0.6)', glow: 'rgba(209,213,219,0.3)' };
  const { main, sub } = splitCardTitle(card.name);
  const customPhoto = listing.images?.[0] || null;

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col h-full group/card"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = `0 16px 40px rgba(0,0,0,0.6), 0 0 20px ${rarityStyle.glow}`;
        (e.currentTarget as HTMLElement).style.borderColor = rarityStyle.border;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-card)';
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Clickable Artwork -> Product Detail View */}
      <div
        onClick={onOpenDetail}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenDetail();
          }
        }}
        className="w-full aspect-[63/88] flex items-center justify-center relative overflow-hidden border-b cursor-pointer"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
      >
        {customPhoto ? (
          <img src={customPhoto} alt={card.name} loading="lazy" className="w-full h-full object-cover relative z-[1]" />
        ) : card.image_path ? (
          <img
            {...cardThumbProps(card.image_path, gridThumbSize(gridSize))}
            alt={card.name}
            className="w-full h-full object-cover relative z-[1]"
          />
        ) : (
          <div className="text-3xl font-black" style={{ color: 'var(--text-tertiary)' }}>
            {card.name.slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="absolute top-2 left-2 z-[3]">
          <LikeButton
            compact
            liked={listing.liked_by_me}
            count={listing.likes_count}
            busy={likeBusy}
            onToggle={onToggleLike}
          />
        </div>

        <div className="absolute top-2 right-2 z-[3] flex flex-col items-end gap-1">
          {listing.is_foil && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-500 text-zinc-950 shadow">
              Foil
            </span>
          )}
          {isSigned(card) && (
            <span className="px-2 py-0.5 text-[10px] font-black rounded-lg uppercase bg-purple-600 text-white border border-purple-300 shadow">
              SIGNED
            </span>
          )}
        </div>

        <div className="absolute bottom-2 left-2 z-[3] flex flex-col items-start gap-1">
          {isAltArt(card) && (
            <span className="px-1.5 py-0.5 text-[9px] font-black rounded-md uppercase bg-pink-600 text-white border border-pink-300 shadow">
              ALT ART
            </span>
          )}
          {isOvernumbered(card) && (
            <span className="px-1.5 py-0.5 text-[9px] font-black rounded-md uppercase bg-indigo-600 text-white border border-indigo-300 shadow">
              ON
            </span>
          )}
        </div>

        <span className="absolute bottom-2 right-2 z-[3] px-2 py-0.5 rounded-md text-[10px] font-bold bg-zinc-950/90 text-zinc-100 border border-white/20 shadow">
          {formatCondition(listing.condition, lang)}
        </span>
      </div>

      {/* Card & Seller Body */}
      <div className={`${isSmall ? 'p-2.5' : 'p-3'} flex flex-col flex-grow justify-between gap-2`}>
        <div onClick={onOpenDetail} className="cursor-pointer min-w-0">
          <div className={`text-center flex flex-col justify-center gap-0.5 ${isSmall ? 'min-h-[30px]' : 'min-h-[36px]'}`}>
            <h3 className={`${isSmall ? 'text-xs' : 'text-sm'} font-black leading-tight uppercase tracking-tight truncate`} style={{ color: 'var(--text-primary)' }}>
              {main}
            </h3>
            {sub && (
              <p className="text-[10px] font-bold uppercase tracking-widest truncate" style={{ color: 'var(--text-tertiary)' }}>
                {sub}
              </p>
            )}
          </div>

          <p className="text-[11px] font-medium truncate mt-1 mb-1" style={{ color: 'var(--text-secondary)' }}>
            {card.sets?.name || ''}
          </p>

          <div className={`grid grid-cols-3 items-center w-full font-mono ${isSmall ? 'text-[10px]' : 'text-[11px]'}`} style={{ color: 'var(--text-secondary)' }}>
            <span className="truncate text-left">{formatCleanCardNumber(card.card_number)}</span>
            <span className="capitalize truncate text-center font-medium">
              {(card.subtype || '').toLowerCase() === 'champion' ? 'Champion' : card.card_type || ''}
            </span>
            <span className="capitalize truncate text-right font-medium" style={{ color: 'var(--text-tertiary)' }}>
              {card.rarity || ''}
            </span>
          </div>
        </div>

        {/* Seller Bar */}
        <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <a
            href={getProfileUrl(listing.seller)}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 min-w-0 hover:underline"
          >
            <span
              className="text-[9px] font-black px-1 py-0.5 rounded border shrink-0"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
            >
              {listing.seller.country}
            </span>
            {listing.seller.avatar_url && (
              <img
                src={listing.seller.avatar_url}
                alt={listing.seller.display_name}
                className="w-4 h-4 rounded-full object-cover shrink-0"
                style={resolveAvatarImageStyle(listing.seller.avatar_url)}
              />
            )}
            <span className="text-[11px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
              {listing.seller.display_name}
            </span>
          </a>
          {listing.seller.rating_count > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-400 shrink-0">
              <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span>{listing.seller.rating_avg.toFixed(1)}</span>
            </span>
          )}
        </div>

        {/* Larger Price + Action Buttons */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-1">
            <span className={`${isSmall ? 'text-sm' : 'text-base sm:text-lg'} font-black font-mono text-emerald-400`}>
              {formatPrice(listing.price_huf)}
            </span>
            <span className="text-[11px] font-bold text-emerald-400/90">
              {listing.quantity} {t('In Stock', 'elérhető')}
            </span>
          </div>

          {isOwn ? (
            <button
              type="button"
              onClick={onEdit}
              className="w-full py-1.5 rounded-xl border text-[11px] font-bold transition cursor-pointer hover:border-[var(--accent)] hover:text-[var(--text-accent)]"
              style={{
                background: 'var(--bg-surface-2)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              {t('Edit', 'Módosítás')}
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onHold}
                className="flex-1 py-1.5 rounded-xl text-[11px] font-black cursor-pointer hover:brightness-110"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
              >
                {t('Hold', 'Félretétel')}
              </button>
              <button
                type="button"
                onClick={onAddToCart}
                title={t('Add to Cart', 'Kosárba')}
                aria-label={t('Add to Cart', 'Kosárba')}
                className="w-8 h-7 rounded-xl border flex items-center justify-center cursor-pointer hover:border-[var(--accent)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onMessage}
                title={t('Message Seller', 'Üzenet')}
                className="w-8 h-7 rounded-xl border flex items-center justify-center cursor-pointer hover:border-[var(--accent)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
