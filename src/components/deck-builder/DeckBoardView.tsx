import React, { useMemo } from 'react';
import type { CatalogCard } from '../../types';
import type { DeckState } from './useDeckBuilder';
import { buildDeckBoard, type DeckBoardSection } from '../../lib/deckBoard';
import { valueOfCard, useCardValueData } from '../../lib/cardValues';
import { useCurrency } from '../../lib/currency';
import { cardThumbProps } from '../../lib/supabase';
import { SINGLE_DOMAIN_MAP } from '../../lib/domainColors';
import type { GameId } from '../../lib/deckRules';

interface DeckBoardViewProps {
  deck: DeckState;
  cards: CatalogCard[];
  activeGame?: GameId;
  onCardClick?: (card: CatalogCard) => void;
  onRemoveCard?: (card: CatalogCard, zone: keyof DeckState) => void;
  onAddCard?: (card: CatalogCard, zone: keyof DeckState) => void;
}

/**
 * The deck laid out as a board: legend, champion, runes and battlefields together at the top, then
 * the main deck split by card type, then the sideboard. Every tile shows its copy count and what
 * the card is worth, so a published deck can be read like a deck page (or a physical board) rather
 * than as a list of card names.
 */
export function DeckBoardView({ deck, cards, activeGame, onCardClick, onRemoveCard, onAddCard }: DeckBoardViewProps) {
  const board = useMemo(() => buildDeckBoard(deck, cards, activeGame), [deck, cards, activeGame]);
  const values = useCardValueData();
  const { formatPrice } = useCurrency();

  const priceOf = (card: CatalogCard) => {
    const value = valueOfCard(card, false, values).valueHuf;
    return value == null ? '—' : formatPrice(value);
  };

  const hasSideboard = board.sideboard.length > 0;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <h2 className="text-[13px] font-black uppercase tracking-[0.14em]" style={{ color: 'var(--text-primary)' }}>
          Main Board
        </h2>
        <span className="text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>
          {board.mainBoardCards} cards{hasSideboard ? ` · +${board.totalCards - board.mainBoardCards} sideboard` : ''}
        </span>
      </div>

      <div className="p-4 sm:p-5">
        {board.command.length > 0 && (
          <div className="flex flex-wrap gap-x-7 gap-y-6 mb-7">
            {board.command.map(sectionData => (
              <BoardSection
                key={sectionData.key}
                section={sectionData}
                compact
                priceOf={priceOf}
                onCardClick={onCardClick}
                onRemoveCard={onRemoveCard}
                onAddCard={onAddCard}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-7">
          {board.main.map(sectionData => (
            <BoardSection
              key={sectionData.key}
              section={sectionData}
              priceOf={priceOf}
              onCardClick={onCardClick}
              onRemoveCard={onRemoveCard}
              onAddCard={onAddCard}
            />
          ))}

          {board.sideboard.map(sectionData => (
            <BoardSection
              key={sectionData.key}
              section={sectionData}
              priceOf={priceOf}
              onCardClick={onCardClick}
              onRemoveCard={onRemoveCard}
              onAddCard={onAddCard}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BoardSection({
  section,
  compact = false,
  priceOf,
  onCardClick,
  onRemoveCard,
  onAddCard,
}: {
  section: DeckBoardSection;
  compact?: boolean;
  priceOf: (card: CatalogCard) => string;
  onCardClick?: (card: CatalogCard) => void;
  onRemoveCard?: (card: CatalogCard, zone: keyof DeckState) => void;
  onAddCard?: (card: CatalogCard, zone: keyof DeckState) => void;
}) {
  return (
    <section
      className="min-w-0"
      style={compact ? { flex: '0 1 auto', maxWidth: '100%' } : undefined}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <h3 className="shrink-0 text-[13px] font-extrabold leading-none" style={{ color: 'var(--text-primary)' }}>
          {section.label}{' '}
          <span className="font-bold" style={{ color: 'var(--text-tertiary)' }}>[{section.count}]</span>
        </h3>
        <span className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
      </div>

      {section.cards.length === 0 ? (
        <div
          className="rounded-lg border border-dashed flex items-center justify-center text-[11px] font-semibold"
          style={{
            width: compact ? 132 : '100%',
            minHeight: 64,
            borderColor: 'var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          Empty
        </div>
      ) : compact ? (
        <div className="flex flex-wrap gap-x-3 gap-y-4">
          {section.cards.map(({ card, qty }) => (
            <BoardCardTile
              key={card.id}
              card={card}
              qty={qty}
              price={priceOf(card)}
              onCardClick={onCardClick}
              onRemoveCard={onRemoveCard ? () => onRemoveCard(card, section.zone) : undefined}
              onAddCard={onAddCard ? () => onAddCard(card, section.zone) : undefined}
              compact
            />
          ))}
        </div>
      ) : (
        <div
          className="grid gap-x-3 gap-y-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}
        >
          {section.cards.map(({ card, qty }) => (
            <BoardCardTile
              key={card.id}
              card={card}
              qty={qty}
              price={priceOf(card)}
              onCardClick={onCardClick}
              onRemoveCard={onRemoveCard ? () => onRemoveCard(card, section.zone) : undefined}
              onAddCard={onAddCard ? () => onAddCard(card, section.zone) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BoardCardTile({
  card,
  qty,
  price,
  onCardClick,
  onRemoveCard,
  onAddCard,
  compact = false,
}: {
  card: CatalogCard;
  qty: number;
  price: string;
  onCardClick?: (card: CatalogCard) => void;
  onRemoveCard?: () => void;
  onAddCard?: () => void;
  compact?: boolean;
}) {
  const imageProps = card.image_path
    ? cardThumbProps(card.image_path, 'tile')
    : {
        src: `https://placehold.co/400x560/1e293b/94a3b8?text=${encodeURIComponent(card.name)}`,
        loading: 'lazy' as const,
        decoding: 'async' as const,
      };

  const domainKey = (card.domain || '').split(/[,/]/)[0].trim().toLowerCase();
  const domainStyle = SINGLE_DOMAIN_MAP[domainKey];
  const cardNumber = (card.card_number || '').split('/')[0];

  return (
    <button
      type="button"
      onClick={() => onCardClick?.(card)}
      className="group min-w-0 text-left cursor-pointer"
      style={compact ? { width: 132, flex: '0 0 132px' } : undefined}
      title={`${card.name}${card.card_type ? ` · ${card.card_type}` : ''}${card.card_number ? ` · ${card.card_number}` : ''}`}
      aria-label={`${card.name}, ${qty} ${qty === 1 ? 'copy' : 'copies'}`}
    >
      <div
        className="relative rounded-lg overflow-hidden border transition-colors"
        style={{ borderColor: 'var(--border)', background: '#09090b' }}
      >
        <img
          {...imageProps}
          alt={card.name}
          draggable={false}
          className="block w-full h-auto transition-transform duration-200 group-hover:scale-[1.04]"
          style={{ aspectRatio: '2.5 / 3.5', objectFit: 'cover' }}
        />
        {qty > 1 && (
          <span
            className="absolute top-1 left-1 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-black text-white pointer-events-none"
            style={{
              background: 'rgba(9,9,11,0.88)',
              border: '1px solid rgba(255,255,255,0.28)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.6)',
            }}
            title={`${qty} copies`}
          >
            {qty}
          </span>
        )}
        {(onRemoveCard || onAddCard) && (
          <div
            className="absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20"
            onClick={(e) => e.stopPropagation()}
          >
            {onRemoveCard && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveCard();
                }}
                className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95"
                style={{
                  background: 'rgba(239, 68, 68, 0.95)',
                  color: '#ffffff',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.6)',
                }}
                title={`Remove one copy of ${card.name}`}
                aria-label={`Remove one copy of ${card.name}`}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            {onAddCard && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddCard();
                }}
                className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95"
                style={{
                  background: 'rgba(16, 185, 129, 0.95)',
                  color: '#ffffff',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.6)',
                }}
                title={`Add another copy of ${card.name}`}
                aria-label={`Add another copy of ${card.name}`}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-1.5 flex items-start gap-1">
        <span className="flex-1 min-w-0 truncate text-[11.5px] font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {card.name}
        </span>
        <span
          className="shrink-0 text-[9.5px] font-black leading-[14px] px-1 rounded"
          style={domainStyle
            ? { background: domainStyle.bg, color: '#ffffff' }
            : { background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          title={`${qty} ${qty === 1 ? 'copy' : 'copies'}`}
        >
          x{qty}
        </span>
      </div>

      <div className="mt-0.5 flex items-center justify-between gap-1.5">
        <span className="truncate text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
          {cardNumber}
        </span>
        <span className="shrink-0 text-[10px] font-bold" style={{ color: 'var(--text-secondary)' }} title="Card value">
          {price}
        </span>
      </div>
    </button>
  );
}
