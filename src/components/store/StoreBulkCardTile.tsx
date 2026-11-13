import React from 'react';
import { hasFoilVariant, isAltArt, isOvernumbered, isSigned } from '../../lib/cardVariants';
import { RARITY_STYLES } from '../../lib/domainColors';
import { formatCleanCardNumber, splitCardTitle } from '../../lib/formatGameText';
import { printLanguage } from '../../lib/cardPreview';
import type { GridSize } from '../../lib/gridSize';
import { useLanguage } from '../../lib/i18n';
import type { ComputedSinglePrice } from '../../lib/storeBulkPricing';
import { cardThumbProps, gridThumbSize } from '../../lib/supabase';

export interface StoreBulkCatalogCard {
  id: string;
  set_id: string;
  card_number: string | null;
  name: string;
  rarity: string | null;
  card_type: string | null;
  subtype?: string | null;
  domain?: string | null;
  energy?: number | null;
  might?: number | null;
  tags?: string[] | null;
  artist?: string | null;
  image_path: string | null;
  game: string;
  market_price_eur: number | null;
  market_price_foil_eur: number | null;
  set_name?: string;
  set_code?: string;
  sets?:
    | { id: string; name: string; code: string; game: string; release_date?: string | null }
    | { id: string; name: string; code: string; game: string; release_date?: string | null }[]
    | null;
}

interface Props {
  card: StoreBulkCatalogCard;
  storeStock?: { normal: number; foil: number };
  queuedNormal: number;
  queuedFoil: number;
  normalPrice: ComputedSinglePrice;
  foilPrice: ComputedSinglePrice;
  clickStep: number;
  gridSize: GridSize;
  priority?: boolean;
  onUpdateQueue: (card: StoreBulkCatalogCard, isFoil: boolean, delta: number) => void;
  onPreview: (cardId: string) => void;
}

const CARD_GLOW: Record<string, { border: string; glow: string }> = {
  Common: { border: 'rgba(161, 161, 170, 0.55)', glow: 'rgba(161, 161, 170, 0.22)' },
  Uncommon: { border: '#38bdf8', glow: 'rgba(56, 189, 248, 0.42)' },
  Rare: { border: '#c084fc', glow: 'rgba(168, 85, 247, 0.45)' },
  Epic: { border: '#fb923c', glow: 'rgba(249, 115, 22, 0.45)' },
  Showcase: { border: '#facc15', glow: 'rgba(250, 204, 21, 0.52)' },
};

export const StoreBulkCardTile = React.memo(function StoreBulkCardTile({
  card,
  storeStock,
  queuedNormal,
  queuedFoil,
  normalPrice,
  foilPrice,
  clickStep,
  gridSize,
  priority = false,
  onUpdateQueue,
  onPreview,
}: Props) {
  const { t } = useLanguage();
  const isSmall = gridSize === 'small';
  const showFoilToggle = card.card_type !== 'Rune' && hasFoilVariant(card);
  const totalQueued = queuedNormal + queuedFoil;
  const inStoreTotal = (storeStock?.normal || 0) + (storeStock?.foil || 0);
  const isQueued = totalQueued > 0;

  const glowStyle = CARD_GLOW[card.rarity || ''] ?? {
    border: 'rgba(139, 92, 246, 0.6)',
    glow: 'rgba(139, 92, 246, 0.25)',
  };

  const baseBorder = isQueued
    ? '1.5px solid var(--accent)'
    : inStoreTotal > 0
      ? '1.5px solid rgba(52, 211, 153, 0.45)'
      : '1px solid var(--border-subtle)';

  const setObj = Array.isArray(card.sets) ? card.sets[0] : card.sets;
  const setName = card.set_name || setObj?.name || (card.card_type === 'Rune' ? 'Basic Rune' : '');
  const rarityStyle = RARITY_STYLES[card.rarity || ''];
  const { main, sub } = splitCardTitle(card.name);
  const langTag = printLanguage(card.name);

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col h-full group/card transition-all duration-150"
      style={{
        background: 'var(--bg-surface)',
        border: baseBorder,
        boxShadow: isQueued ? '0 6px 20px rgba(139, 92, 246, 0.16)' : 'var(--shadow-card)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = glowStyle.border;
        e.currentTarget.style.boxShadow = `0 14px 30px rgba(0,0,0,0.45), 0 0 18px ${glowStyle.glow}`;
        e.currentTarget.style.transform = 'translateY(-3px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.border = baseBorder;
        e.currentTarget.style.boxShadow = isQueued ? '0 6px 20px rgba(139, 92, 246, 0.16)' : 'var(--shadow-card)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Artwork / Click to open full Catalog Preview */}
      <button
        type="button"
        onClick={() => onPreview(card.id)}
        className="block relative cursor-pointer border-none bg-transparent p-0 w-full text-left group/img"
        title={t('Open card preview', 'Kártya előnézet megnyitása')}
      >
        <div
          className="w-full aspect-[63/88] flex items-center justify-center relative overflow-hidden border-b"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
        >
          {card.image_path ? (
            <>
              <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center pointer-events-none z-0">
                <span className="text-2xl sm:text-3xl font-black select-none" style={{ color: 'var(--text-tertiary)' }}>
                  {card.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <span className="block mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono" style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)' }}>
                  {formatCleanCardNumber(card.card_number)}
                </span>
              </div>
              <img
                {...cardThumbProps(card.image_path, gridThumbSize(gridSize), priority)}
                alt={card.name}
                className="w-full h-full object-cover relative z-[1]"
              />
            </>
          ) : (
            <div className="relative z-[1] text-center px-3">
              <span className="text-3xl font-black select-none" style={{ color: 'var(--text-primary)' }}>
                {card.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}

          {/* Hover Preview Zoom Pill */}
          <span
            className="absolute inset-x-0 bottom-0 py-1.5 px-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1 text-[10px] font-bold text-white pointer-events-none"
            style={{ zIndex: 4 }}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {t('Preview', 'Előnézet')}
          </span>
        </div>

        {/* Top-left: Existing Store stock pill */}
        {inStoreTotal > 0 && (
          <div className="absolute top-1.5 left-1.5 z-[3]">
            <span
              className="px-1.5 py-0.5 rounded-md text-[10px] font-black font-mono shadow-md"
              style={{
                background: 'rgba(6, 78, 59, 0.92)',
                color: '#6ee7b7',
                border: '1px solid rgba(52, 211, 153, 0.6)',
              }}
            >
              {t('Store:', 'Bolt:')} {storeStock?.normal ? `${storeStock.normal}N` : ''}
              {storeStock?.normal && storeStock?.foil ? '/' : ''}
              {storeStock?.foil ? `${storeStock.foil}F` : ''}
            </span>
          </div>
        )}

        {/* Top-right: Print lang / Signed / Queued count */}
        <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 z-[3]">
          {isQueued && (
            <span
              className="px-1.5 py-0.5 rounded-md text-[10px] font-black font-mono shadow-md"
              style={{
                background: 'rgba(109, 40, 217, 0.94)',
                color: '#f5f3ff',
                border: '1px solid rgba(196, 181, 253, 0.75)',
              }}
            >
              +{queuedNormal > 0 ? `${queuedNormal}N` : ''}
              {queuedNormal > 0 && queuedFoil > 0 ? ' ' : ''}
              {queuedFoil > 0 ? `${queuedFoil}F` : ''}
            </span>
          )}
          {langTag && (
            <span
              className="px-1.5 py-0.5 text-[9px] font-black rounded-md uppercase tracking-wider shadow-md"
              style={{ background: 'rgba(15,23,42,0.9)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
            >
              {langTag} print
            </span>
          )}
          {isSigned(card) && (
            <span
              className="px-1.5 py-0.5 text-[10px] font-black rounded-md uppercase tracking-wider"
              style={{ background: 'rgba(147, 51, 234, 0.95)', color: '#fff', border: '1px solid #c084fc' }}
            >
              SIGNED
            </span>
          )}
        </div>

        {/* Bottom-left: Alt Art / ON */}
        <div className="absolute bottom-1.5 left-1.5 flex flex-col items-start gap-1 z-[3]">
          {isAltArt(card) && (
            <span
              className="px-1.5 py-0.5 text-[9px] font-black rounded-md uppercase tracking-wider"
              style={{ background: 'rgba(219, 39, 119, 0.95)', color: '#fff', border: '1px solid #f472b6' }}
            >
              ALT ART
            </span>
          )}
          {isOvernumbered(card) && (
            <span
              className="px-1.5 py-0.5 text-[9px] font-black rounded-md uppercase tracking-wider"
              style={{ background: 'rgba(99, 102, 241, 0.95)', color: '#fff', border: '1px solid #818cf8' }}
            >
              ON
            </span>
          )}
        </div>
      </button>

      {/* Body */}
      <div className={`${isSmall ? 'p-2' : 'p-2.5 sm:p-3'} flex flex-col flex-grow`}>
        <div className={`text-center flex flex-col justify-center gap-0.5 ${isSmall ? 'min-h-[28px]' : 'min-h-[34px]'}`}>
          <h3 className={`${isSmall ? 'text-[11px]' : 'text-xs sm:text-[13px]'} font-black leading-tight uppercase tracking-tight truncate`} style={{ color: 'var(--text-primary)' }}>
            {main}
          </h3>
          {sub && (
            <p className="text-[10px] font-bold uppercase tracking-widest truncate" style={{ color: 'var(--text-tertiary)' }}>
              {sub}
            </p>
          )}
        </div>

        <p className="text-[10px] font-medium truncate mt-0.5 mb-1 text-center" style={{ color: 'var(--text-secondary)' }}>
          {setName}
        </p>

        {/* Bottom Spec Bar: Number · Type · Rarity */}
        <div className={`grid grid-cols-3 items-center w-full font-mono ${isSmall ? 'text-[9px] mb-1.5' : 'text-[10px] mb-2'}`} style={{ color: 'var(--text-secondary)' }}>
          <span className="truncate text-left">{formatCleanCardNumber(card.card_number)}</span>
          <span className="capitalize truncate text-center font-medium">
            {(card.subtype || '').toLowerCase() === 'champion' ? 'Champion' : card.card_type || ''}
          </span>
          <span className="capitalize truncate text-right font-bold" style={{ color: rarityStyle?.text || 'var(--text-tertiary)' }}>
            {card.rarity || ''}
          </span>
        </div>

        {/* Computed Store Price & Market/Floor indicator */}
        <div
          className={`flex items-center justify-between gap-1 ${isSmall ? 'text-[10px] mb-1.5' : 'text-[11px] mb-2'} px-2 py-1 rounded-lg border`}
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
        >
          <span className="font-semibold truncate" style={{ color: 'var(--text-muted)' }}>
            {normalPrice.hitFloor
              ? t('Floor', 'Min. ár')
              : normalPrice.rawMarketHuf
                ? t('Market', 'Piaci')
                : t('Set', 'Ár')}
            {normalPrice.rawMarketHuf && normalPrice.hitFloor ? ` (~${normalPrice.rawMarketHuf})` : ''}
          </span>
          <span className="font-black font-mono shrink-0" style={{ color: 'var(--positive)' }}>
            {normalPrice.priceHuf} Ft
            {showFoilToggle && (
              <span className="ml-1 font-bold" style={{ color: '#fbbf24' }}>
                / {foilPrice.priceHuf}
              </span>
            )}
          </span>
        </div>

        {/* Action Steppers */}
        <div
          className={`mt-auto ${isSmall ? 'pt-1.5' : 'pt-2'} flex ${isSmall && showFoilToggle ? 'flex-col gap-1' : 'gap-1.5'}`}
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          {/* Normal Control */}
          {queuedNormal === 0 ? (
            <button
              type="button"
              onClick={() => onUpdateQueue(card, false, clickStep)}
              className={`flex-1 ${isSmall ? 'py-1 px-1.5 text-[11px]' : 'py-1.5 px-2 text-xs'} font-bold rounded-lg transition active:scale-95 flex items-center justify-center gap-1 cursor-pointer border`}
              style={{ background: 'var(--bg-raised)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
              title={t(`Add +${clickStep} Normal (${normalPrice.priceHuf} Ft)`, `+${clickStep} Normál hozzáadása (${normalPrice.priceHuf} Ft)`)}
            >
              <span>+{clickStep}</span>
              <span className="opacity-80">{showFoilToggle ? t('Norm', 'Normál') : t('Add', 'Hozzáad')}</span>
            </button>
          ) : (
            <div
              className={`flex-1 flex items-center justify-between border rounded-lg p-0.5 ${isSmall ? 'h-7' : 'h-8'}`}
              style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}
            >
              <button
                type="button"
                onClick={() => onUpdateQueue(card, false, -1)}
                className="w-6 h-full flex items-center justify-center text-sm font-black cursor-pointer hover:brightness-110"
              >
                -
              </button>
              <span className="text-xs font-black font-mono px-1" style={{ color: 'var(--text-primary)' }}>
                {queuedNormal}
              </span>
              <button
                type="button"
                onClick={() => onUpdateQueue(card, false, clickStep)}
                className="w-6 h-full flex items-center justify-center text-xs font-black cursor-pointer hover:brightness-110"
              >
                +{clickStep}
              </button>
            </div>
          )}

          {/* Foil Control (only for cards with distinct Normal & Foil variants) */}
          {showFoilToggle &&
            (queuedFoil === 0 ? (
              <button
                type="button"
                onClick={() => onUpdateQueue(card, true, clickStep)}
                className={`flex-1 ${isSmall ? 'py-1 px-1.5 text-[11px]' : 'py-1.5 px-2 text-xs'} font-bold rounded-lg transition active:scale-95 flex items-center justify-center gap-1 cursor-pointer border`}
                style={{
                  background: 'rgba(245, 158, 11, 0.1)',
                  color: '#fbbf24',
                  borderColor: 'rgba(245, 158, 11, 0.35)',
                }}
                title={t(`Add +${clickStep} Foil (${foilPrice.priceHuf} Ft)`, `+${clickStep} Fólia hozzáadása (${foilPrice.priceHuf} Ft)`)}
              >
                <span>+{clickStep}</span>
                <span>{t('Foil', 'Fólia')}</span>
              </button>
            ) : (
              <div
                className={`flex-1 flex items-center justify-between border rounded-lg p-0.5 ${isSmall ? 'h-7' : 'h-8'}`}
                style={{
                  background: 'rgba(245, 158, 11, 0.16)',
                  borderColor: 'rgba(245, 158, 11, 0.6)',
                  color: '#fbbf24',
                }}
              >
                <button
                  type="button"
                  onClick={() => onUpdateQueue(card, true, -1)}
                  className="w-6 h-full flex items-center justify-center text-sm font-black cursor-pointer hover:brightness-110"
                >
                  -
                </button>
                <span className="text-xs font-black font-mono px-1" style={{ color: 'var(--text-primary)' }}>
                  {queuedFoil}F
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateQueue(card, true, clickStep)}
                  className="w-6 h-full flex items-center justify-center text-xs font-black cursor-pointer hover:brightness-110"
                >
                  +{clickStep}
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
});
