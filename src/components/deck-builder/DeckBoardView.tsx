import React, { useMemo, useState, useCallback, useEffect } from 'react';
import type { CatalogCard } from '../../types';
import type { DeckState } from './useDeckBuilder';
import { buildDeckBoard, type DeckBoardSection } from '../../lib/deckBoard';
import { valueOfCard, useCardValueData } from '../../lib/cardValues';
import { useCurrency } from '../../lib/currency';
import { parseDomains } from '../../lib/domainColors';
import { RUNE_ICONS, TYPE_ICONS, RARITY_ICONS } from '../../lib/riftboundIcons';
import { readLocalCollection } from '../../lib/collectionClient';
import { useCollectionsStore } from '../../lib/collectionsStore';
import { getCurrentUser, loadCollectionRecordFromCloud } from '../../lib/auth';
import type { GameId } from '../../lib/deckRules';
import type { GridSize } from '../../lib/gridSize';
import { useLanguage } from '../../lib/i18n';
import { CardListItem } from '../CardListItem';

type BoardViewMode = 'grid' | 'list';

function deckBoardGridClasses(size: GridSize): string {
  if (size === 'small') return 'grid-cols-3 gap-2 sm:gap-3 sm:grid-cols-[repeat(auto-fill,minmax(116px,1fr))]';
  if (size === 'large') return 'grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fill,minmax(196px,1fr))]';
  return 'grid-cols-3 gap-2.5 sm:gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(144px,1fr))]';
}

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
  const [viewMode, setViewMode] = useState<BoardViewMode>(() => {
    if (typeof window === 'undefined') return 'grid';
    try {
      const saved = localStorage.getItem('deckBoardViewMode');
      if (saved === 'grid' || saved === 'list') return saved;
    } catch {}
    return 'grid';
  });

  const handleViewModeChange = useCallback((mode: BoardViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('deckBoardViewMode', mode);
    } catch {}
  }, []);

  const [ownedMode, setOwnedMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('deckBoardOwnedMode') === '1';
    } catch {
      return false;
    }
  });

  const handleOwnedModeToggle = useCallback(() => {
    setOwnedMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('deckBoardOwnedMode', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  const [personalMap, setPersonalMap] = useState<Record<string, number>>(() => readLocalCollection() || {});
  const collectionsStore = useCollectionsStore();

  useEffect(() => {
    if (!ownedMode) return;
    const local = readLocalCollection();
    if (local && Object.keys(local).length > 0) {
      setPersonalMap(local);
      return;
    }
    let cancelled = false;
    getCurrentUser()
      .then((user) => (user ? loadCollectionRecordFromCloud() : null))
      .then((rec) => {
        if (!cancelled && rec?.cards) {
          setPersonalMap(rec.cards);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ownedMode]);

  const ownedByCardId = useMemo(() => {
    const totals = new Map<string, number>();
    const addMap = (map: Record<string, number> | undefined | null) => {
      if (!map) return;
      for (const [k, rawQty] of Object.entries(map)) {
        const q = Number(rawQty) || 0;
        if (q <= 0) continue;
        const baseId = k.endsWith('_foil') ? k.slice(0, -5) : k;
        totals.set(baseId, (totals.get(baseId) || 0) + q);
      }
    };
    addMap(personalMap);
    for (const c of collectionsStore.collections) {
      addMap(c.cards);
    }
    return totals;
  }, [personalMap, collectionsStore.collections]);

  const getOwnedQty = useCallback((cardId: string) => ownedByCardId.get(cardId) || 0, [ownedByCardId]);

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
  const values = useCardValueData();
  const { formatPrice } = useCurrency();
  const priceOf = useCallback(
    (card: CatalogCard) => {
      const val = valueOfCard(card, false, values).valueHuf;
      return val == null ? '—' : formatPrice(val);
    },
    [values, formatPrice]
  );
  const hasSideboard = board.sideboard.length > 0;
  const allListSections = useMemo(
    () => [...board.command, ...board.main, ...board.sideboard].filter((s) => s.cards.length > 0),
    [board]
  );

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

        <div className="flex items-center gap-2 flex-wrap">
          {/* Grid Size Switcher */}
          {viewMode === 'grid' && (
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
          )}

          {/* Owned Mode Toggle */}
          <button
            type="button"
            onClick={handleOwnedModeToggle}
            aria-pressed={ownedMode}
            title={isHu ? 'Saját gyűjteményhez viszonyított állapot mutatása' : 'Highlight cards owned in your collection'}
            className={`inline-flex items-center gap-1.5 px-3 h-[34px] text-xs rounded-xl border transition cursor-pointer font-bold shrink-0 ${
              ownedMode
                ? 'border-[var(--positive-border)] shadow-sm'
                : 'border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]'
            }`}
            style={
              ownedMode
                ? { background: 'var(--positive-muted)', color: 'var(--positive)' }
                : { background: 'var(--bg-input)' }
            }
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{isHu ? 'Birtokolt' : 'Owned'}</span>
          </button>

          {/* Grid / List View Switcher */}
          <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border)] rounded-xl p-1 h-[34px] shrink-0 gap-1">
            <button
              type="button"
              onClick={() => handleViewModeChange('grid')}
              aria-pressed={viewMode === 'grid'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs rounded-lg transition cursor-pointer font-bold ${
                viewMode === 'grid'
                  ? 'text-[var(--text-primary)] bg-[var(--bg-raised)] border border-[var(--border-hover)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] border border-transparent'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>{isHu ? 'Rács' : 'Grid'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange('list')}
              aria-pressed={viewMode === 'list'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs rounded-lg transition cursor-pointer font-bold ${
                viewMode === 'list'
                  ? 'text-[var(--text-primary)] bg-[var(--bg-raised)] border border-[var(--border-hover)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] border border-transparent'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <circle cx="3.5" cy="6" r="1" fill="currentColor" />
                <circle cx="3.5" cy="12" r="1" fill="currentColor" />
                <circle cx="3.5" cy="18" r="1" fill="currentColor" />
              </svg>
              <span>{isHu ? 'Lista' : 'List'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {viewMode === 'list' ? (
          <div className="columns-1 md:columns-2 xl:columns-3 gap-6 space-y-5">
            {allListSections.map((sectionData) => (
              <ListSection
                key={sectionData.key}
                section={sectionData}
                priceOf={priceOf}
                ownedMode={ownedMode}
                getOwnedQty={getOwnedQty}
                onCardClick={onCardClick}
                onRemoveCard={onRemoveCard}
                onAddCard={onAddCard}
              />
            ))}
          </div>
        ) : (
          <>
            {board.command.length > 0 && (
              <div className="flex flex-wrap gap-x-6 gap-y-6 mb-7">
                {board.command.map(sectionData => (
                  <BoardSection
                    key={sectionData.key}
                    section={sectionData}
                    compact
                    ownedMode={ownedMode}
                    getOwnedQty={getOwnedQty}
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
                  ownedMode={ownedMode}
                  getOwnedQty={getOwnedQty}
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
                  ownedMode={ownedMode}
                  getOwnedQty={getOwnedQty}
                  onCardClick={onCardClick}
                  onRemoveCard={onRemoveCard}
                  onAddCard={onAddCard}
                  gridSize={currentGridSize}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BoardSection({
  section,
  compact = false,
  ownedMode = false,
  getOwnedQty,
  onCardClick,
  onRemoveCard,
  onAddCard,
  gridSize = 'normal',
}: {
  section: DeckBoardSection;
  compact?: boolean;
  ownedMode?: boolean;
  getOwnedQty?: (cardId: string) => number;
  onCardClick?: (card: CatalogCard) => void;
  onRemoveCard?: (card: CatalogCard, zone: keyof DeckState) => void;
  onAddCard?: (card: CatalogCard, zone: keyof DeckState) => void;
  gridSize?: GridSize;
}) {
  const { isHu } = useLanguage();
  const compactWidth = gridSize === 'small' ? 118 : gridSize === 'large' ? 200 : 148;
  const editable = Boolean(onAddCard || onRemoveCard);
  const itemGridSize: GridSize = gridSize === 'large' ? 'normal' : 'small';

  const renderCard = (card: CatalogCard, qty: number) => (
    <CardListItem
      key={card.id}
      card={card}
      count={qty}
      gridSize={itemGridSize}
      readOnly={!editable}
      singleCounter
      ownershipStatus={ownedMode && getOwnedQty ? { owned: getOwnedQty(card.id), required: qty } : undefined}
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
      <div className="flex items-center gap-2 mb-2.5">
        <h3 className="shrink-0 text-[13px] font-extrabold leading-none" style={{ color: 'var(--text-primary)' }}>
          {section.label}
        </h3>
        <span
          className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[11px] font-black tabular-nums border leading-none"
          style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          {section.count}
        </span>
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
        <div className={`grid ${deckBoardGridClasses(gridSize)}`}>
          {section.cards.map(({ card, qty }) => renderCard(card, qty))}
        </div>
      )}
    </section>
  );
}

function sectionTypeIcon(sectionKey: string): string | null {
  const k = sectionKey.toLowerCase();
  if (k.includes('legend')) return TYPE_ICONS.legend;
  if (k.includes('champion')) return TYPE_ICONS.champion;
  if (k.includes('unit')) return TYPE_ICONS.unit;
  if (k.includes('gear')) return TYPE_ICONS.gear;
  if (k.includes('spell')) return TYPE_ICONS.spell;
  if (k.includes('battlefield')) return TYPE_ICONS.battlefield;
  if (k.includes('rune')) return TYPE_ICONS.rune;
  return null;
}

function ListSection({
  section,
  priceOf,
  ownedMode = false,
  getOwnedQty,
  onCardClick,
  onRemoveCard,
  onAddCard,
}: {
  section: DeckBoardSection;
  priceOf: (card: CatalogCard) => string;
  ownedMode?: boolean;
  getOwnedQty?: (cardId: string) => number;
  onCardClick?: (card: CatalogCard) => void;
  onRemoveCard?: (card: CatalogCard, zone: keyof DeckState) => void;
  onAddCard?: (card: CatalogCard, zone: keyof DeckState) => void;
}) {
  const typeIcon = sectionTypeIcon(section.key);
  const editable = Boolean(onAddCard || onRemoveCard);

  return (
    <section className="break-inside-avoid mb-5">
      <div className="flex items-center gap-2 mb-1.5 pb-1 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {typeIcon ? (
          <img src={typeIcon} alt="" className="w-4 h-4 object-contain opacity-85 shrink-0" />
        ) : (
          <svg className="w-4 h-4 shrink-0 opacity-75" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
            <rect x="3" y="4" width="14" height="17" rx="2" />
            <path d="M7 2h12a2 2 0 0 1 2 2v14" />
          </svg>
        )}
        <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
          {section.label}
        </h3>
        <span
          className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-black tabular-nums border leading-none"
          style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          {section.count}
        </span>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {section.cards.map(({ card, qty }) => {
          const rarityIcon = RARITY_ICONS[(card.rarity || '').toLowerCase()];
          const domains = parseDomains(card.domain);
          const owned = ownedMode && getOwnedQty ? getOwnedQty(card.id) : null;
          const statusColor =
            owned === null
              ? null
              : owned >= qty
              ? 'var(--positive)'
              : owned > 0
              ? '#f59e0b'
              : 'var(--negative)';
          return (
            <div
              key={card.id}
              role="button"
              tabIndex={0}
              onClick={() => onCardClick?.(card)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onCardClick?.(card);
                }
              }}
              className="group flex items-center justify-between gap-2 py-1.5 px-1.5 -mx-1.5 rounded-lg cursor-pointer transition hover:bg-[var(--bg-raised)]"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {rarityIcon ? (
                  <img src={rarityIcon} alt={card.rarity || ''} className="w-3.5 h-3.5 object-contain shrink-0" />
                ) : (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--text-tertiary)' }} />
                )}
                <span
                  className={`text-center text-xs font-black tabular-nums shrink-0 ${owned !== null ? 'min-w-[26px]' : 'w-4'}`}
                  style={{ color: statusColor || 'var(--text-primary)' }}
                >
                  {owned !== null ? (owned >= qty ? qty : `${owned}/${qty}`) : qty}
                </span>
                <span
                  className="text-xs font-semibold truncate group-hover:underline"
                  style={{ color: statusColor || 'var(--text-accent)' }}
                >
                  {card.name}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {editable && (
                  <div className="hidden group-hover:flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {onRemoveCard && (
                      <button
                        type="button"
                        onClick={() => onRemoveCard(card, section.zone)}
                        className="w-5 h-5 rounded flex items-center justify-center text-xs font-black border cursor-pointer hover:bg-[var(--bg-surface-2)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                        aria-label={`Remove ${card.name}`}
                      >
                        -
                      </button>
                    )}
                    {onAddCard && (
                      <button
                        type="button"
                        onClick={() => onAddCard(card, section.zone)}
                        className="w-5 h-5 rounded flex items-center justify-center text-xs font-black border cursor-pointer hover:bg-[var(--bg-surface-2)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                        aria-label={`Add ${card.name}`}
                      >
                        +
                      </button>
                    )}
                  </div>
                )}
                <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {priceOf(card)}
                </span>
                <div className="flex items-center gap-0.5">
                  {domains.map((d) => {
                    const iconUrl = RUNE_ICONS[d.key];
                    if (!iconUrl) return null;
                    return (
                      <img
                        key={d.key}
                        src={iconUrl}
                        alt={d.name}
                        title={d.name}
                        className="w-4 h-4 rounded-full object-contain shrink-0"
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
