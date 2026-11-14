import React, { useMemo, useState, useCallback } from 'react';
import type { CatalogCard } from '../../types';
import type { DeckState } from './useDeckBuilder';
import { buildDeckBoard, type DeckBoardSection } from '../../lib/deckBoard';
import type { GameId } from '../../lib/deckRules';
import { gridSizeClasses, type GridSize } from '../../lib/gridSize';
import { useLanguage } from '../../lib/i18n';
import { CardListItem } from '../CardListItem';

interface DeckBoardViewProps {
  deck: DeckState;
  cards: CatalogCard[];
  activeGame?: GameId;
  onCardClick?: (card: CatalogCard) => void;
  onRemoveCard?: (card: CatalogCard, zone: keyof DeckState) => void;
  onAddCard?: (card: CatalogCard, zone: keyof DeckState) => void;
  gridSize?: GridSize;
  onGridSizeChange?: (size: GridSize) => void;
}

/**
 * The deck laid out as a board: legend, champion, runes and battlefields together at the top, then
 * the main deck split by card type, then the sideboard. Every tile shows its copy count and what
 * the card is worth, so a published deck can be read like a deck page (or a physical board) rather
 * than as a list of card names.
 */
export function DeckBoardView({
  deck,
  cards,
  activeGame,
  onCardClick,
  onRemoveCard,
  onAddCard,
  gridSize: propGridSize,
  onGridSizeChange,
}: DeckBoardViewProps) {
  const { isHu } = useLanguage();
  const [internalGridSize, setInternalGridSize] = useState<GridSize>(() => {
    if (typeof window === 'undefined') return 'normal';
    try {
      const saved = localStorage.getItem('deckBuilderGridSize') || sessionStorage.getItem('catalogGridSize');
      if (saved === 'small' || saved === 'normal' || saved === 'large') return saved as GridSize;
    } catch {}
    return 'normal';
  });

  const currentGridSize = propGridSize ?? internalGridSize;
  const handleGridSizeChange = useCallback((size: GridSize) => {
    if (onGridSizeChange) {
      onGridSizeChange(size);
    } else {
      setInternalGridSize(size);
    }
    try {
      localStorage.setItem('deckBuilderGridSize', size);
    } catch {}
  }, [onGridSizeChange]);

  const board = useMemo(() => buildDeckBoard(deck, cards, activeGame), [deck, cards, activeGame]);
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
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-black uppercase tracking-[0.14em]" style={{ color: 'var(--text-primary)' }}>
            {isHu ? 'Főpakli' : 'Main Board'}
          </h2>
          <span className="text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>
            {board.mainBoardCards} {isHu ? 'kártya' : 'cards'}{hasSideboard ? ` · +${board.totalCards - board.mainBoardCards} sideboard` : ''}
          </span>
        </div>

        {/* Grid Size Switcher */}
        <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border)] rounded-xl p-1 h-[34px] shrink-0 gap-1">
          {(['small', 'normal', 'large'] as const).map(size => {
            const active = currentGridSize === size;
            return (
              <button
                key={size}
                type="button"
                onClick={() => handleGridSizeChange(size)}
                title={isHu ? `Kártya méret: ${size === 'small' ? 'Kicsi' : size === 'normal' ? 'Normál' : 'Nagy'}` : `Card display size: ${size}`}
                className={`flex items-center justify-center px-2.5 py-0.5 text-xs rounded-lg transition cursor-pointer capitalize font-bold ${
                  active
                    ? 'text-[var(--text-primary)] bg-[var(--bg-raised)] border border-[var(--border-hover)] shadow-sm'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] border border-transparent'
                }`}
              >
                {isHu ? (size === 'small' ? 'Kicsi' : size === 'normal' ? 'Normál' : 'Nagy') : size}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {board.command.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-6 mb-7">
            {board.command.map(sectionData => (
              <BoardSection
                key={sectionData.key}
                section={sectionData}
                compact
                onCardClick={onCardClick}
                onRemoveCard={onRemoveCard}
                onAddCard={onAddCard}
                gridSize={currentGridSize}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-7">
          {board.main.map(sectionData => (
            <BoardSection
              key={sectionData.key}
              section={sectionData}
              onCardClick={onCardClick}
              onRemoveCard={onRemoveCard}
              onAddCard={onAddCard}
              gridSize={currentGridSize}
            />
          ))}

          {board.sideboard.map(sectionData => (
            <BoardSection
              key={sectionData.key}
              section={sectionData}
              onCardClick={onCardClick}
              onRemoveCard={onRemoveCard}
              onAddCard={onAddCard}
              gridSize={currentGridSize}
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
  onCardClick,
  onRemoveCard,
  onAddCard,
  gridSize = 'normal',
}: {
  section: DeckBoardSection;
  compact?: boolean;
  onCardClick?: (card: CatalogCard) => void;
  onRemoveCard?: (card: CatalogCard, zone: keyof DeckState) => void;
  onAddCard?: (card: CatalogCard, zone: keyof DeckState) => void;
  gridSize?: GridSize;
}) {
  const { isHu } = useLanguage();
  const compactWidth = gridSize === 'small' ? 148 : gridSize === 'large' ? 250 : 196;
  const editable = Boolean(onAddCard || onRemoveCard);

  const renderCard = (card: CatalogCard, qty: number) => (
    <CardListItem
      key={card.id}
      card={card}
      count={qty}
      gridSize={gridSize}
      readOnly={!editable}
      singleCounter
      onClick={() => onCardClick?.(card)}
      onUpdateCount={
        editable
          ? (_id, _isFoil, delta) => {
              if (delta > 0) onAddCard?.(card, section.zone);
              else onRemoveCard?.(card, section.zone);
            }
          : undefined
      }
    />
  );

  return (
    <section
      className="min-w-0"
      style={compact ? { flex: '0 1 auto', maxWidth: '100%' } : undefined}
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        <h3 className="shrink-0 text-[13px] font-extrabold leading-none" style={{ color: 'var(--text-primary)' }}>
          {section.label}{' '}
          <span className="font-bold" style={{ color: 'var(--text-tertiary)' }}>[{section.count}]</span>
        </h3>
        <span className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
      </div>

      {section.cards.length === 0 ? (
        <div
          className="rounded-xl border border-dashed flex items-center justify-center text-[11px] font-semibold"
          style={{
            width: compact ? compactWidth : '100%',
            minHeight: 64,
            borderColor: 'var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          {isHu ? 'Üres' : 'Empty'}
        </div>
      ) : compact ? (
        <div className="flex flex-wrap gap-3 sm:gap-4">
          {section.cards.map(({ card, qty }) => (
            <div key={card.id} style={{ width: compactWidth, flex: `0 0 ${compactWidth}px` }}>
              {renderCard(card, qty)}
            </div>
          ))}
        </div>
      ) : (
        <div className={`grid ${gridSizeClasses(gridSize)}`}>
          {section.cards.map(({ card, qty }) => renderCard(card, qty))}
        </div>
      )}
    </section>
  );
}
