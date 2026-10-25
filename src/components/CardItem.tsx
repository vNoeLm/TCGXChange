import { useCurrency } from '../lib/currency';
import React, { useState, useEffect } from "react";
import type { InventoryCard } from "../types";
import { supabase, cardThumbProps, gridThumbSize } from "../lib/supabase";
import { getCardPowerRequirement } from "../lib/cardPowerData";
import { splitCardTitle, formatCleanCardNumber } from "../lib/formatGameText";
import { isOvernumbered, isSigned, isAltArt } from "../lib/cardVariants";
import { CountryFlag } from "./CountryFlag";
import { OWNER_ID } from "../lib/constants";
import { resolveSellerTier } from "../lib/badges";
import { addToCart, cartQuantityFor } from '../lib/marketplaceCart';
import { useCart } from '../lib/useCart';
import { useCurrentUserId } from '../lib/useCurrentUserId';

interface CardItemProps {
  card: InventoryCard;
  onClick: (id: string) => void;
  gridSize?: "small" | "normal" | "large";
  /** One of the first cards on the page: load its image right away. */
  priority?: boolean;
}

const RARITY_COLORS: Record<string, { bg: string; text: string; glow: string; border: string }> = {
  Common:          { bg: "rgba(39, 39, 42, 0.95)",  text: "#e4e4e7", glow: "rgba(161, 161, 170, 0.25)", border: "rgba(161, 161, 170, 0.6)" },
  Uncommon:        { bg: "rgba(12, 74, 110, 0.95)", text: "#38bdf8", glow: "rgba(56, 189, 248, 0.5)",  border: "#38bdf8" },
  Rare:            { bg: "rgba(88, 28, 135, 0.95)", text: "#d8b4fe", glow: "rgba(168, 85, 247, 0.5)",  border: "#c084fc" },
  Epic:            { bg: "rgba(154, 52, 18, 0.95)", text: "#fb923c", glow: "rgba(249, 115, 22, 0.5)",  border: "#fb923c" },
  Showcase:        { bg: "rgba(113, 63, 18, 0.95)", text: "#fde047", glow: "rgba(250, 204, 21, 0.6)",  border: "#fde047" },
};

export const CardItem = React.memo(function CardItem({ card, onClick, gridSize = 'normal', priority = false }: CardItemProps) {
  const isSmall = gridSize === 'small';
  const { formatPrice } = useCurrency();
  const cart = useCart();
  const currentUserId = useCurrentUserId();
  const isOwnListing = Boolean(currentUserId && card.seller_id === currentUserId);
  const inCart = card.inventory_id ? cartQuantityFor(cart, card.inventory_id) : 0;
  const left = Math.max(0, (Number(card.quantity) || 1) - inCart);
  const [justAdded, setJustAdded] = useState(false);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOwnListing || left <= 0 || !card.inventory_id) return;
    addToCart({
      inventoryId: card.inventory_id,
      sellerId: card.seller_id || '',
      sellerName: card.seller_name || 'Community Seller',
      cardName: card.name,
      cardNumber: card.card_number,
      imagePath: card.image_path || undefined,
      priceHuf: card.price_huf || 0,
      quantity: 1,
      maxQuantity: Math.max(1, Number(card.quantity) || 1),
      isFoil: Boolean(card.is_foil),
      condition: card.condition || 'Near Mint',
      handoverMethods: (card as any).handover_methods,
      sellerCountry: card.seller_country || 'HU',
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
  };


  const isSealed = false;
  const rarityStyle = RARITY_COLORS[card.rarity] ?? { bg: "#27272a", text: "#e4e4e7", glow: "rgba(209,213,219,0.3)", border: "rgba(209,213,219,0.6)" };
  const hoverBorder = rarityStyle.border;
  const hoverGlow = rarityStyle.glow;

  const handleCardClick = () => {
    if (card.inventory_id && (card.is_marketplace_listing || card.seller_id)) {
      const storageKey = `tcg_clicked_${card.inventory_id}`;
      let alreadyClicked = false;
      try {
        alreadyClicked = Boolean(localStorage.getItem(storageKey));
      } catch (e) {}

      if (!alreadyClicked) {
        try {
          localStorage.setItem(storageKey, '1');
        } catch (e) {}

        supabase.auth.getSession().then(({ data }) => {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (data.session?.access_token) {
            headers['Authorization'] = `Bearer ${data.session.access_token}`;
          }
          fetch('/api/marketplace/track-click', {
            method: 'POST',
            headers,
            body: JSON.stringify({ inventory_id: card.inventory_id, type: 'click' }),
          }).catch(() => {});
        }).catch(() => {});
      }
    }
    onClick(card.inventory_id);
  };

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col h-full group/card"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        boxShadow: `0 2px 12px rgba(0,0,0,0.4)`,
        transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = `0 16px 40px rgba(0,0,0,0.6), 0 0 20px ${hoverGlow}`;
        (e.currentTarget as HTMLElement).style.borderColor = hoverBorder;
        (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 12px rgba(0,0,0,0.4)`;
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-subtle)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      }}
    >
      {/* Image Area — clickable link to modal */}
      <button onClick={handleCardClick} className="block relative cursor-pointer border-none bg-transparent p-0 w-full text-left [container-type:inline-size]">
        <div className="w-full aspect-[63/88] flex items-center justify-center relative overflow-hidden border-b" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
          {card.image_path ? (
            <img
              {...cardThumbProps(card.image_path, gridThumbSize(gridSize), priority)}
              alt={card.name}
              className="w-full h-full object-cover relative z-[1]"
            />
          ) : (
            <div className="relative z-[1] text-center px-4">
              <span className="text-5xl font-black select-none" style={{ color: 'var(--text-primary)' }}>
                {isSealed ? 'SEALED' : card.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="block mt-2 px-2 py-0.5 rounded-full text-xs font-bold font-mono tracking-widest" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}>
                {card.card_number?.includes('-') ? card.card_number : `${card.set_code?.toLowerCase()}-${card.card_number}`}
              </span>
            </div>
          )}
        </div>

        {/* Top right badges: Photos / Signed */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1" style={{ zIndex: 3 }}>
          {card.inventory_images && card.inventory_images.length > 0 && (
            <span
              className="px-2 py-0.5 text-[10px] font-black rounded-lg uppercase tracking-wider bg-amber-400 text-zinc-950 border border-amber-200 shadow-md flex items-center gap-1.5"
              title="Real physical condition photos attached"
            >
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <span>{card.inventory_images.length} {card.inventory_images.length === 1 ? 'Photo' : 'Photos'}</span>
            </span>
          )}
          {isSigned(card) && (
            <span
              className="px-2 py-0.5 text-[11px] font-black rounded-lg uppercase tracking-wider"
              style={{
                background: "rgba(147, 51, 234, 0.95)",
                color: "#ffffff",
                border: "1.5px solid #c084fc",
                boxShadow: "0 0 12px rgba(168, 85, 247, 0.6)",
                textShadow: "0 0 6px rgba(0, 0, 0, 0.8)",
              }}
            >
              SIGNED
            </span>
          )}
        </div>

        {isSealed && (
          <div className="absolute top-2 left-2" style={{ zIndex: 3 }}>
            <span className="px-2.5 py-1 text-xs font-black rounded-lg uppercase tracking-wide"
              style={{ background: 'rgba(99,102,241,0.9)', color: '#ffffff', border: '1px solid rgba(165,180,252,0.4)', boxShadow: '0 0 12px rgba(99,102,241,0.5)' }}>
              SEALED
            </span>
          </div>
        )}

        {/* Bottom Left Badges: Sealed Condition / ALT ART / ON */}
        <div className="absolute bottom-1.5 left-1.5 flex flex-col items-start gap-1" style={{ zIndex: 3 }}>
          {isSealed && (
            <span className="bg-emerald-950/80 text-[var(--positive)] border border-emerald-500/50 font-bold text-[10px] tracking-wide uppercase px-2 py-0.5 rounded shadow-sm">
              {card.condition}
            </span>
          )}

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

        {/* HardverApro Status Overlay Banners */}
        {card.status === 'On Hold' && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 py-1 px-2 bg-black/90 border-y border-amber-500/70 shadow-[0_0_20px_rgba(245,158,11,0.5)] flex items-center justify-center gap-1.5 z-20">
            <svg className="w-3 h-3 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="text-[11px] font-black tracking-widest uppercase" style={{ color: 'var(--text-accent)' }}>
              ON HOLD
            </span>
          </div>
        )}
        {card.status === 'Sold' && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 py-1 px-2 bg-black/90 border-y border-rose-500/70 shadow-[0_0_20px_rgba(244,63,94,0.5)] flex items-center justify-center gap-1.5 z-20">
            <svg className="w-3 h-3 text-rose-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-[11px] font-black tracking-widest text-rose-300 uppercase">
              SOLD
            </span>
          </div>
        )}
      </button>

      {/* Info section */}
      <div className={`${isSmall ? 'p-2 sm:p-2.5' : 'p-2.5 sm:p-3.5'} flex flex-col flex-grow`}>
        {/* Card Title */}
        {(() => {
          const { main, sub } = splitCardTitle(card.name);
          return (
            <div className="text-center my-0.5">
              <h3 className={`${isSmall ? 'text-xs' : 'text-xs sm:text-sm'} font-black leading-tight uppercase tracking-tight truncate`} style={{ color: 'var(--text-primary)' }}>
                {main}
              </h3>
              {/* Reserve the subtitle line so every tile's set/number rows line up. */}
              <p className="text-[10px] font-bold uppercase tracking-widest truncate min-h-[12px] leading-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                {sub || ''}
              </p>
            </div>
          );
        })()}

        {/* Set name */}
        <p className={`${isSmall ? 'text-[10px] my-1' : 'text-[11px] mt-1 mb-1.5'} font-medium truncate`} style={{ color: 'var(--text-secondary)' }}>
          {card.set_name || (card.card_type === 'Rune' ? 'Basic Rune' : '')}
        </p>

        {/* Bottom Spec Bar (Number · Type · Rarity) evenly distributed across row */}
        <div className={`grid grid-cols-3 items-center w-full font-mono ${isSmall ? 'text-[10px] mb-1' : 'text-[11px] mb-2'}`} style={{ color: 'var(--text-secondary)' }}>
          <span className="truncate text-left">
            {isSealed ? card.condition : formatCleanCardNumber(card.card_number)}
          </span>
          <span className="capitalize truncate text-center font-medium">
            {(card.subtype || '').toLowerCase() === 'champion' ? 'Champion' : card.card_type}
          </span>
          <span className="capitalize truncate text-right font-medium" style={{ color: 'var(--text-tertiary)' }}>
            {card.rarity || ''}
          </span>
        </div>

        {/* Seller Info (centered, 2-line layout for perfect balance) */}
        {(() => {
          const sellerTier = resolveSellerTier(card);
          const isOwner = sellerTier.isOwner;

          return (
            <div className={`mt-auto ${isSmall ? 'pt-1.5 pb-1' : 'pt-2 pb-1.5'} border-t text-[10px] flex flex-col items-center justify-center text-center gap-1`} style={{ borderColor: 'var(--border-subtle)' }}>
              {/* Top row: Flag, PFP, Name & Rating */}
              <a
                href={`/user?id=${card.seller_id || OWNER_ID}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center gap-1.5 min-w-0 max-w-full hover:underline cursor-pointer group/seller"
                title={`View ${card.seller_name || 'Noel :3'}'s profile`}
              >
                <CountryFlag countryCode={card.seller_country || 'HU'} className="w-3.5 h-2.5 rounded-[2px] shrink-0" />
                {card.seller_avatar ? (
                  <img
                    src={card.seller_avatar}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover shrink-0 border"
                    style={{ borderColor: 'var(--border)' }}
                  />
                ) : (
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center font-black text-[9px] shrink-0 border"
                    style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}
                  >
                    {card.seller_name ? card.seller_name[0].toUpperCase() : 'N'}
                  </span>
                )}
                <span className="font-semibold truncate max-w-[120px] group-hover/seller:text-[var(--text-primary)]" style={{ color: 'var(--text-secondary)' }}>
                  {card.seller_name || 'Noel :3'}
                </span>
                {card.seller_rating_avg !== null && card.seller_rating_avg !== undefined && (card.seller_rating_count || 0) > 0 && (
                  <span className="inline-flex items-center gap-0.5 font-bold text-[9px] shrink-0" style={{ color: 'var(--text-accent)' }}>
                    <svg className="w-2.5 h-2.5 fill-current shrink-0" viewBox="0 0 24 24">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span>{card.seller_rating_avg.toFixed(1)}</span>
                  </span>
                )}
              </a>

              {/* Bottom row: Badges (Owner, Tier X / New Seller, etc.) */}
              <div className="flex items-center justify-center gap-1 flex-wrap w-full">
                {isOwner && (
                  <span
                    className="text-[8px] font-black px-1.5 py-0.5 rounded border shrink-0 uppercase tracking-wider inline-flex items-center gap-1"
                    style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}
                    title="Platform Owner"
                  >
                    <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
                    </svg>
                    <span>Owner</span>
                  </span>
                )}
                {sellerTier.nameEn && (
                  <span
                    className="text-[8px] font-bold px-1.5 py-0.5 rounded border shrink-0 inline-flex items-center gap-0.5"
                    style={sellerTier.badgeStyle}
                    title={sellerTier.nameEn}
                  >
                    <span>{sellerTier.nameEn}</span>
                  </span>
                )}
                {typeof card.views === 'number' && card.views > 0 && (
                  <span className="text-[9px] flex items-center gap-0.5 ml-0.5" style={{ color: 'var(--text-tertiary)' }} title={`${card.views} views`}>
                    <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span>{card.views}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Price + Buy (consolidated under and full-width like the Store) */}
        <div className={`mt-auto ${isSmall ? 'pt-1.5' : 'pt-2'} flex flex-col gap-2 border-t`} style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-baseline justify-between gap-1 flex-wrap min-h-[20px]">
            <span className={`${isSmall ? 'text-xs sm:text-sm font-black' : 'text-sm sm:text-base font-black'} text-[var(--positive)] whitespace-nowrap leading-none`}>
              {card.price_huf ? formatPrice(card.price_huf) : 'N/A'}
            </span>
            <span
              className="leading-none"
              style={{
                fontSize: isSmall ? 9 : 10,
                fontWeight: 700,
                color: card.status === 'In Stock' ? 'var(--positive)' : (card.status === 'On Hold' || card.status === 'Reserved') ? 'var(--text-accent)' : 'var(--negative)',
              }}
            >
              {card.status === 'In Stock' 
                ? `${card.quantity || 1} In Stock` 
                : (card.status === 'On Hold' || card.status === 'Reserved')
                ? 'On Hold'
                : (card.status === 'Sold')
                ? 'Sold'
                : card.status}
            </span>
          </div>

          {isOwnListing ? (
            <div
              className={`w-full ${isSmall ? 'py-1 text-[10px]' : 'py-1.5 text-xs'} font-bold rounded-xl border text-center select-none`}
              style={{
                background: 'var(--bg-surface-2)',
                color: 'var(--text-tertiary)',
                borderColor: 'var(--border-subtle)',
              }}
              title="This is your own listing"
            >
              {isSmall ? 'Yours' : 'Your listing'}
            </div>
          ) : card.status === 'In Stock' && left > 0 ? (
            <button
              type="button"
              onClick={handleAddToCart}
              className={`w-full ${isSmall ? 'py-1 text-[10px]' : 'py-1.5 text-xs'} font-bold rounded-xl cursor-pointer transition shadow-xs hover:brightness-110 active:scale-95 flex items-center justify-center gap-1.5`}
              style={{
                background: justAdded ? 'var(--positive)' : 'var(--accent-strong)',
                color: 'var(--text-on-accent, #000)',
              }}
              title="Add to cart"
            >
              {justAdded ? (
                <>
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Added</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="21" r="1" />
                    <circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                  </svg>
                  <span>Add to cart</span>
                </>
              )}
            </button>
          ) : card.status === 'In Stock' && inCart > 0 ? (
            <div
              className={`w-full ${isSmall ? 'py-1 text-[10px]' : 'py-1.5 text-xs'} font-bold rounded-xl border flex items-center justify-center gap-1.5 select-none`}
              style={{
                background: 'var(--positive-muted)',
                color: 'var(--positive)',
                borderColor: 'var(--positive-border)',
              }}
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>In Cart ({inCart})</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onClick(card.inventory_id)}
              className={`w-full ${isSmall ? 'py-1 text-[10px]' : 'py-1.5 text-xs'} font-semibold rounded-xl border cursor-pointer transition hover:bg-[var(--bg-surface-2)] active:scale-95 text-center`}
              style={{
                background: 'var(--bg-surface-2)',
                color: 'var(--text-secondary)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              Details
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
