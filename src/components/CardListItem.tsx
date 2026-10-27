import React, { useState, useEffect } from "react";
import { printLanguage } from '../lib/cardPreview';
import type { CatalogCard } from "../types";
import { cardThumbProps, gridThumbSize } from "../lib/supabase";
import { getCardPowerRequirement } from "../lib/cardPowerData";
import { splitCardTitle, formatCleanCardNumber } from "../lib/formatGameText";
import { useCardValueData, valueOfCard } from "../lib/cardValues";
import { useCurrency } from "../lib/currency";
import { isOvernumbered, isSigned, isAltArt, hasFoilVariant } from "../lib/cardVariants";

interface CardListItemProps {
  card: CatalogCard;
  count?: number;
  foilCount?: number;
  isOwned?: boolean;
  isFoilOwned?: boolean;
  isCollected?: boolean;
  isFoilCollected?: boolean;
  onUpdateCount?: (id: string, isFoil: boolean, delta: number) => void;
  onToggle?: (id: string, isFoil?: boolean) => void;
  onToggleCollected?: (e: React.MouseEvent) => void;
  onToggleFoilCollected?: (e: React.MouseEvent) => void;
  /** Opens the "move copies" dialog for this card; the button only shows on owned cards. */
  onMove?: (card: CatalogCard, isFoil: boolean) => void;
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

export const CardListItem = React.memo(function CardListItem(props: CardListItemProps) {
  const { card, onClick, gridSize = 'normal', priority = false } = props;
  const isSmall = gridSize === 'small';

  // Estimated value: the market reference combined with what sellers here are asking. Only a card
  // that has a normal print but no normal price, and a foil price (a few Commons), is marked as
  // foil. Rare and above in Riftbound are printed foil only, so for them the finish is not worth
  // saying - it is the card's one price.
  const values = useCardValueData();
  const { formatPrice } = useCurrency();
  const normalValue = valueOfCard(card, false, values).valueHuf;
  const foilValue = valueOfCard(card, true, values).valueHuf;
  const shownValue = normalValue ?? foilValue;
  const valueIsFoil = hasFoilVariant(card) && normalValue === null && foilValue !== null;


  const normalQty = typeof props.count === 'number' ? props.count : (props.isOwned ?? props.isCollected ? 1 : 0);
  const foilQty = typeof props.foilCount === 'number' ? props.foilCount : (props.isFoilOwned ?? props.isFoilCollected ? 1 : 0);
  const totalQty = normalQty + foilQty;
  const isAnyOwned = totalQty > 0;

  const rarityStyle = RARITY_COLORS[card.rarity] ?? { bg: "#27272a", text: "#e4e4e7", glow: "rgba(209,213,219,0.3)", border: "rgba(209,213,219,0.6)" };
  const hoverBorder = rarityStyle.border;
  const hoverGlow = rarityStyle.glow;
  const showFoilToggle = card.card_type !== 'Rune' && hasFoilVariant(card);

  const handleUpdateNormal = (e: React.MouseEvent, delta: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.onUpdateCount) {
      props.onUpdateCount(card.id, false, delta);
    } else if (props.onToggle) {
      props.onToggle(card.id, false);
    }
  };

  const handleUpdateFoil = (e: React.MouseEvent, delta: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.onUpdateCount) {
      props.onUpdateCount(card.id, true, delta);
    } else if (props.onToggle) {
      props.onToggle(card.id, true);
    }
  };

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col h-full group/card"
      style={{
        background: "var(--bg-surface)",
        border: isAnyOwned ? "1.5px solid rgba(52,211,153,0.5)" : "1px solid var(--border-subtle)",
        boxShadow: isAnyOwned ? `0 4px 20px rgba(52,211,153,0.1)` : `var(--shadow-card)`,
        transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = isAnyOwned
          ? `0 16px 40px rgba(0,0,0,0.6), 0 0 20px ${hoverGlow}, 0 0 16px rgba(52,211,153,0.3)`
          : `0 16px 40px rgba(0,0,0,0.6), 0 0 20px ${hoverGlow}`;
        (e.currentTarget as HTMLElement).style.borderColor = hoverBorder;
        (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = isAnyOwned
          ? `0 4px 20px rgba(52,211,153,0.1)`
          : `var(--shadow-card)`;
        (e.currentTarget as HTMLElement).style.borderColor = isAnyOwned ? "rgba(52,211,153,0.5)" : "var(--border-subtle)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      }}
    >
      <button onClick={() => onClick(card.id)} className="block relative cursor-pointer border-none bg-transparent p-0 w-full text-left group [container-type:inline-size]">
        <div
          className="w-full aspect-[63/88] flex items-center justify-center relative overflow-hidden border-b" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
        >
          {card.image_path ? (
            <img
              {...cardThumbProps(card.image_path, gridThumbSize(gridSize), priority)}
              alt={card.name}
              className="w-full h-full object-cover relative z-[1]"
              style={{
                filter: isAnyOwned ? 'none' : 'grayscale(40%) brightness(0.75)',
                transition: 'filter 0.2s',
              }}
            />
          ) : (
            <div className="relative z-[1] text-center px-4">
              <span className="text-5xl font-black select-none" style={{ color: 'var(--text-primary)' }}>
                {card.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="block mt-2 px-2 py-0.5 rounded-full text-xs font-bold font-mono tracking-widest" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}>
                {card.card_number?.includes('-') ? card.card_number : `${card.set_code?.toLowerCase()}-${card.card_number}`}
              </span>
            </div>
          )}
        </div>

        {/* Top right badges: foreign print / Signed */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1" style={{ zIndex: 3 }}>
          {printLanguage(card.name) && (
            <span
              className="px-1.5 py-0.5 text-[9px] font-black rounded-md uppercase tracking-wider shadow-md"
              style={{ background: 'rgba(15,23,42,0.9)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
              title="Non-English print - the official English text is in the card details"
            >
              {printLanguage(card.name)} print
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

        {/* Bottom Left Badges: ALT ART / ON */}
        <div className="absolute bottom-1.5 left-1.5 flex flex-col items-start gap-1" style={{ zIndex: 3 }}>
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
      </button>

      <div className={`${isSmall ? 'p-2.5' : 'p-3'} flex flex-col flex-grow`}>
        {/* Card Title — fixed height + consistent centering so a long name on one
            card can't stretch the whole grid row and leave others with dead space */}
        {(() => {
          const { main, sub } = splitCardTitle(card.name);
          return (
            <div className={`text-center flex flex-col justify-center gap-0.5 ${isSmall ? 'min-h-[30px]' : 'min-h-[36px]'}`}>
              {sub ? (
                <>
                  <h3 className={`${isSmall ? 'text-xs' : 'text-sm'} font-black leading-tight uppercase tracking-tight truncate`} style={{ color: 'var(--text-primary)' }}>
                    {main}
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {sub}
                  </p>
                </>
              ) : (
                <h3 className={`${isSmall ? 'text-xs' : 'text-sm'} font-black leading-tight uppercase tracking-tight truncate`} style={{ color: 'var(--text-primary)' }}>
                  {main}
                </h3>
              )}
            </div>
          );
        })()}

        {/* Set / Promo Line */}
        <p className="text-[11px] font-medium truncate mt-1 mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          {card.set_name || (card.card_type === 'Rune' ? 'Basic Rune' : '')}
        </p>

        {/* Bottom Spec Bar (Number · Type · Rarity) evenly distributed across row */}
        <div className={`grid grid-cols-3 items-center w-full font-mono ${isSmall ? 'text-[10px] mb-1.5' : 'text-[11px] mb-2.5'}`} style={{ color: 'var(--text-secondary)' }}>
          <span className="truncate text-left">
            {formatCleanCardNumber(card.card_number)}
          </span>
          <span className="capitalize truncate text-center font-medium">
            {(card.subtype || '').toLowerCase() === 'champion' ? 'Champion' : card.card_type}
          </span>
          <span className="capitalize truncate text-right font-medium" style={{ color: 'var(--text-tertiary)' }}>
            {card.rarity || ''}
          </span>
        </div>

        {shownValue !== null && (
          <div
            className={`flex items-center justify-between ${isSmall ? 'text-[10px] mb-1.5' : 'text-[11px] mb-2'}`}
            title="Estimated value: the market reference combined with what sellers here are asking"
          >
            <span className="font-medium" style={{ color: 'var(--text-tertiary)' }}>Est. value{valueIsFoil ? ' (foil)' : ''}</span>
            <span className="font-black font-mono text-[var(--positive)]">~{formatPrice(shownValue)}</span>
          </div>
        )}

        {/* Action Steppers */}
        <div 
          className={`mt-auto ${isSmall ? 'pt-2' : 'pt-2.5'} flex ${isSmall && showFoilToggle ? 'flex-col gap-1.5' : 'gap-2'}`} 
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* Normal Copy Control */}
          {normalQty === 0 ? (
            <button
              onClick={(e) => handleUpdateNormal(e, 1)}
              className={`flex-1 ${isSmall ? 'py-1.5 px-2' : 'py-1.5 px-2.5'} text-xs font-medium rounded-lg transition-all duration-150 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm border`}
              style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
              title={"Add normal copy to collection"}
            >
              <span className="text-sm font-black opacity-70">+</span>
              <span>{showFoilToggle ? ('Normal') : (isSmall ? ('Add') : ('Add to Collection'))}</span>
            </button>
          ) : (
            <div 
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className={`flex-1 flex items-center justify-between border rounded-lg p-0.5 text-[var(--positive)] shadow-[0_0_12px_rgba(16,185,129,0.12)] ${isSmall ? 'h-7' : 'h-8'}`}
              style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)' }}
            >
              <button
                onClick={(e) => handleUpdateNormal(e, -1)}
                title={"Decrease quantity (-1)"}
                className="w-7 h-full flex items-center justify-center text-sm font-black hover:brightness-110 text-[var(--positive)] rounded transition cursor-pointer active:scale-90"
              >
                −
              </button>
              <span className="text-xs font-black px-1 font-mono select-none" style={{ color: 'var(--text-primary)' }}>
                {normalQty}
              </span>
              <button
                onClick={(e) => handleUpdateNormal(e, 1)}
                title={"Increase quantity (+1)"}
                className="w-7 h-full flex items-center justify-center text-sm font-black hover:brightness-110 text-[var(--positive)] rounded transition cursor-pointer active:scale-90"
              >
                +
              </button>
            </div>
          )}

          {/* Foil Copy Control */}
          {showFoilToggle && (
            foilQty === 0 ? (
              <button
                onClick={(e) => handleUpdateFoil(e, 1)}
                className={`flex-1 ${isSmall ? 'py-1.5 px-2' : 'py-1.5 px-2.5'} text-xs font-medium rounded-lg transition-all duration-150 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm border`}
              style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                title={"Add foil copy to collection"}
              >
                <span className="text-sm font-black opacity-70">+</span>
                <span>Foil</span>
              </button>
            ) : (
              <div 
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                className={`flex-1 flex items-center justify-between border rounded-lg p-0.5 shadow-[0_0_12px_rgba(245,158,11,0.12)] ${isSmall ? 'h-7' : 'h-8'}`}
                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
              >
                <button
                  onClick={(e) => handleUpdateFoil(e, -1)}
                  title={"Decrease foil quantity (-1)"}
                  className="w-7 h-full flex items-center justify-center text-sm font-black hover:brightness-110 rounded transition cursor-pointer active:scale-90" style={{ color: 'var(--text-accent)' }}
                >
                  −
                </button>
                <span className="text-xs font-black px-1 font-mono select-none" style={{ color: 'var(--text-primary)' }}>
                  {foilQty}
                </span>
                <button
                  onClick={(e) => handleUpdateFoil(e, 1)}
                  title={"Increase foil quantity (+1)"}
                  className="w-7 h-full flex items-center justify-center text-sm font-black hover:brightness-110 rounded transition cursor-pointer active:scale-90" style={{ color: 'var(--text-accent)' }}
                >
                  +
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
});
