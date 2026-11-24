import React, { useState } from 'react';
import type { CatalogCard } from '../../types';
import { deckExtraLegendsRequired, type DeckState } from './useDeckBuilder';
import { extraLegendsRequired, legendNameKey } from '../../lib/riftboundRules';
import { getDeckRules, hasZone, zoneRule, type GameId } from '../../lib/deckRules';
import { cardThumbProps } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';

interface DeckListProps {
  deck: DeckState;
  cards: CatalogCard[];
  activeGame?: GameId;
  legendCard: CatalogCard | null;
  championCard: CatalogCard | null;
  onRemoveCard: (cardId: string, zone: keyof DeckState) => void;
  onCardClick?: (card: CatalogCard) => void;
  activeZone: keyof DeckState;
  onSetZone: (zone: keyof DeckState) => void;
  isWide?: boolean;
  viewMode?: 'list' | 'grid';
}

export function DeckList({
  deck,
  cards,
  activeGame = 'riftbound',
  legendCard,
  championCard,
  onRemoveCard,
  onCardClick,
  activeZone,
  onSetZone,
  isWide = true,
  viewMode = 'list',
}: DeckListProps) {
  const { isHu } = useLanguage();
  const [collapsedZones, setCollapsedZones] = useState<Set<string>>(new Set());

  const toggleZone = (zone: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(collapsedZones);
    if (next.has(zone)) next.delete(zone);
    else next.add(zone);
    setCollapsedZones(next);
  };

  const getCardCounts = (zoneMap: Record<string, number> | undefined) => {
    return Object.entries(zoneMap || {}).map(([id, qty]) => {
      const card = cards.find(c => c.id === id);
      return { card, qty };
    }).filter(c => c.card) as { card: CatalogCard, qty: number }[];
  };

  const mainCards = getCardCounts(deck.mainDeck);

  // Extra legends (Neeko, Blending In): how many the deck needs, which card asks, and what's chosen.
  const extraLegendsNeeded = deckExtraLegendsRequired(deck, cards);
  const extraLegendsSource = [championCard, ...mainCards.map(m => m.card)].find(c => c && extraLegendsRequired(c) > 0) || null;
  const extraLegendCards = (deck.extraLegends || []).map(id => cards.find(c => c.id === id)).filter(Boolean) as CatalogCard[];
  const extraLegendNameClash = Boolean(legendCard && extraLegendCards.some(c => legendNameKey(c.name) === legendNameKey(legendCard.name)));
  const runeCards = getCardCounts(deck.runeDeck);
  const bfCards = getCardCounts(deck.battlefields);
  const sbCards = getCardCounts(deck.sideboard);

  const rules = getDeckRules(activeGame);
  const legendRule = zoneRule(activeGame, 'legend');
  const championRule = zoneRule(activeGame, 'champion');
  const mainRule = zoneRule(activeGame, 'mainDeck');
  const runeRule = zoneRule(activeGame, 'runeDeck');
  const bfRule = zoneRule(activeGame, 'battlefields');
  const sbRule = zoneRule(activeGame, 'sideboard');

  const mainTotal = mainCards.reduce((acc, curr) => acc + curr.qty, 0) + (championCard && hasZone(activeGame, 'champion') ? 1 : 0);
  const runeTotal = runeCards.reduce((acc, curr) => acc + curr.qty, 0);
  const bfTotal = bfCards.reduce((acc, curr) => acc + curr.qty, 0);
  const sbTotal = sbCards.reduce((acc, curr) => acc + curr.qty, 0);

  const getZoneTitle = (zoneKey: keyof DeckState, defaultLabel: string) => {
    if (isHu) {
      switch (zoneKey) {
        case 'legend': return activeGame === 'onepiece' ? 'Leader' : 'Legenda Zóna';
        case 'extraLegends': return 'Extra Legendák';
        case 'champion': return 'Kiválasztott Bajnok';
        case 'mainDeck': return 'Főpakli';
        case 'runeDeck': return 'Rúna Pakli';
        case 'battlefields': return 'Csatamezők';
        case 'sideboard': return 'Sideboard';
      }
    }
    return defaultLabel;
  };

  const ZoneHeader = ({
    title,
    count,
    max,
    min,
    exact = false,
    zoneKey,
  }: {
    title: string;
    count: number;
    max: number;
    min?: number;
    exact?: boolean;
    zoneKey: keyof DeckState;
  }) => {
    let isValid = false;
    if (min !== undefined) {
      isValid = count >= min && count <= max;
    } else if (exact) {
      isValid = count === max || (zoneKey === 'sideboard' && count === 0);
    } else {
      isValid = count <= max;
    }

    const isActive = activeZone === zoneKey;
    const isCollapsed = collapsedZones.has(zoneKey);
    
    return (
      <div 
        onClick={() => {
          onSetZone(zoneKey);
          if (isCollapsed) {
            const next = new Set(collapsedZones);
            next.delete(zoneKey);
            setCollapsedZones(next);
          }
        }}
        style={{ 
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 10px',
          marginBottom: 8,
          marginTop: 16,
          cursor: 'pointer',
          background: isActive
            ? 'var(--accent-muted)'
            : 'transparent',
          borderRadius: 8,
          border: isActive
            ? '1px solid var(--accent)'
            : '1px solid transparent',
          boxShadow: isActive
            ? '0 0 12px var(--accent-glow)'
            : 'none',
          transition: 'all 0.15s'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button 
            onClick={(e) => toggleZone(zoneKey, e)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 4px', fontSize: 10, display: 'flex', alignItems: 'center', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }}
          >
            ▼
          </button>
          <h3 style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 800,
            color: isActive
              ? 'var(--text-accent)'
              : 'var(--text-primary)'
          }}>
            {title}
          </h3>
          {isActive && (
            <span style={{
              fontSize: 10,
              background: 'var(--accent-strong)',
              color: 'var(--text-on-accent)',
              padding: '2px 7px',
              borderRadius: 6,
              fontWeight: 900,
              letterSpacing: '0.05em'
            }}>
              {isHu ? 'AKTÍV' : 'ACTIVE'}
            </span>
          )}
        </div>
        <span style={{
          fontSize: 13,
          fontWeight: 700,
          color: isValid
            ? (isActive ? 'var(--text-accent)' : 'var(--text-muted)')
            : '#ef4444'
        }}>
          {max === Infinity ? `${count} / ${min}+` : min !== undefined ? `${count} / ${min}-${max}` : `${count} / ${max}`}
        </span>
      </div>
    );
  };

  const RiftboundCardRow = ({ card, qty, zone }: { card: CatalogCard, qty?: number, zone: keyof DeckState }) => {
    const [isHovered, setIsHovered] = useState(false);
    return (
      <div 
        onClick={() => onCardClick?.(card)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          padding: '5px 8px', 
          background: isHovered 
            ? 'var(--accent-muted)' 
            : 'var(--bg-surface-2)', 
          border: isHovered 
            ? '1px solid var(--accent)' 
            : '1px solid var(--border)',
          borderRadius: 6, 
          marginBottom: 4,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          {card.image_path && (
            <img
              {...cardThumbProps(card.image_path, 'avatar')}
              alt=""
              style={{
                width: 24,
                height: 34,
                borderRadius: 3,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid var(--border-subtle)',
              }}
            />
          )}
          {qty !== undefined && <span style={{ fontWeight: 800, color: 'var(--text-accent)', minWidth: 20, fontSize: 12, flexShrink: 0 }}>{qty}x</span>}
          <span className="truncate" style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 12 }}>{card.name}</span>
        </div>
        <button 
          type="button"
          aria-label={isHu ? `${card.name} eltávolítása innen: ${zone}` : `Remove ${card.name} from ${zone}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemoveCard(card.id, zone);
          }}
          style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', minWidth: 26, minHeight: 26, padding: '4px', fontWeight: 700, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <svg style={{ width: 13, height: 13 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    );
  };

  const RiftboundCardTile = ({ card, qty, zone }: { card: CatalogCard; qty?: number; zone: keyof DeckState }) => (
    <div
      onClick={() => onCardClick?.(card)}
      className="relative group cursor-pointer"
      title={card.name}
    >
      <div
        className="w-full aspect-[63/88] rounded-md overflow-hidden border"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
      >
        {card.image_path ? (
          <img
            {...cardThumbProps(card.image_path, 'tile')}
            alt={card.name}
            draggable={false}
            className="w-full h-full object-cover block"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-1 text-center text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }}>
            {card.name}
          </div>
        )}
      </div>
      {qty !== undefined && qty > 1 && (
        <span
          className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-black font-mono pointer-events-none"
          style={{ background: 'rgba(13, 14, 17, 0.88)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
        >
          {qty}x
        </span>
      )}
      <button
        type="button"
        aria-label={isHu ? `${card.name} eltávolítása innen: ${zone}` : `Remove ${card.name} from ${zone}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemoveCard(card.id, zone);
        }}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer shadow"
        style={{ background: '#ef4444', color: '#fff', border: '1.5px solid var(--bg-surface)' }}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );

  const renderZoneCards = (items: { card: CatalogCard; qty?: number }[], zone: keyof DeckState, paddingBottom = 0) => {
    if (items.length === 0) {
      return (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic', paddingBottom }}>
          {isHu ? 'Üres' : 'Empty'}
        </div>
      );
    }
    if (viewMode === 'grid') {
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(82px, 1fr))',
            gap: 8,
            paddingBottom,
          }}
        >
          {items.map((item) => (
            <RiftboundCardTile key={item.card.id} card={item.card} qty={item.qty} zone={zone} />
          ))}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom }}>
        {items.map((item) => (
          <RiftboundCardRow key={item.card.id} card={item.card} qty={item.qty} zone={zone} />
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: isWide ? '100%' : 'auto', overflowY: isWide ? 'auto' : 'visible', scrollbarGutter: 'stable', paddingRight: 4 }}>
      {/* Legend / Leader */}
      {hasZone(activeGame, 'legend') && (
        <>
          <ZoneHeader title={getZoneTitle('legend', legendRule?.label || "Legend Zone")} count={legendCard ? 1 : 0} max={1} exact zoneKey="legend" />
          {!collapsedZones.has('legend') && (
            <>
              {legendCard ? (
                viewMode === 'grid' ? renderZoneCards([{ card: legendCard }], 'legend', 8) : <RiftboundCardRow card={legendCard} zone="legend" />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic', marginBottom: 12 }}>{isHu ? `Nincs kiválasztva ${rules.legendLabel}` : `No ${rules.legendLabel} selected`}</div>
              )}
              
              {legendCard && (
                <div style={{ marginBottom: 12, fontSize: 11, color: '#fbbf24', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '4px 8px', borderRadius: 6, alignSelf: 'flex-start' }}>
                  {activeGame === 'onepiece' ? (isHu ? 'Engedélyezett színek:' : 'Allowed Colors:') : (isHu ? 'Engedélyezett domének:' : 'Allowed Domains:')} <strong>{legendCard.domain}</strong>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Extra legends - only while a card in the deck asks for them (Neeko, Blending In), or
          when some were chosen and that card has since left the deck. */}
      {activeGame === 'riftbound' && (extraLegendsNeeded > 0 || extraLegendCards.length > 0) && (
        <>
          <ZoneHeader title={getZoneTitle('extraLegends', "Extra Legends")} count={extraLegendCards.length} max={extraLegendsNeeded || extraLegendCards.length} exact={extraLegendsNeeded > 0} zoneKey="extraLegends" />
          {!collapsedZones.has('extraLegends') && (
            <>
              {extraLegendCards.map(c => <RiftboundCardRow key={c.id} card={c} zone="extraLegends" />)}
              <div
                style={{
                  marginBottom: 12, fontSize: 11, lineHeight: 1.45, padding: '6px 8px', borderRadius: 6,
                  ...(extraLegendsNeeded === 0 || extraLegendNameClash
                    ? { color: 'var(--negative)', background: 'var(--negative-muted)', border: '1px solid var(--negative-border)' }
                    : { color: 'var(--text-secondary)', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }),
                }}
              >
                {extraLegendsNeeded === 0
                  ? (isHu ? 'Már egy kártya sem kér extra legendákat a pakliban - ezek nem számítanak. Távolítsd el őket, vagy add vissza a kártyát.' : "No card in the deck asks for extra legends any more - these don't count. Remove them, or add the card back.")
                  : extraLegendNameClash
                    ? (isHu ? 'Egy extra legenda neve megegyezik a kezdő legendáddal. Minden legendának különböző nevűnek kell lennie.' : 'An extra legend has the same name as your starting legend. They must all have different names.')
                    : extraLegendCards.length < extraLegendsNeeded
                      ? (isHu ? `${extraLegendsSource?.name || 'Egy kártya a paklidban'}: válassz még ${extraLegendsNeeded - extraLegendCards.length} legendát a kezdő legendádon kívül, mind különböző névvel. Válaszd ki ezt a zónát, és válassz a katalógusból.` : `${extraLegendsSource?.name || 'A card in your deck'}: choose ${extraLegendsNeeded - extraLegendCards.length} more legend${extraLegendsNeeded - extraLegendCards.length === 1 ? '' : 's'} besides your starting legend, all with different names. Select this zone and pick from the catalog.`)
                      : (isHu ? `Kiválasztva ehhez: ${extraLegendsSource?.name || 'egy kártya a paklidban'}.` : `Chosen for ${extraLegendsSource?.name || 'a card in your deck'}.`)}
              </div>
            </>
          )}
        </>
      )}

      {/* Chosen Champion */}
      {hasZone(activeGame, 'champion') && (
        <>
          <ZoneHeader title={getZoneTitle('champion', championRule?.label || "Chosen Champion")} count={championCard ? 1 : 0} max={1} exact zoneKey="champion" />
          {!collapsedZones.has('champion') && (
            championCard ? (
              viewMode === 'grid' ? renderZoneCards([{ card: championCard }], 'champion', 8) : <RiftboundCardRow card={championCard} zone="champion" />
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic', marginBottom: 12 }}>{isHu ? 'Nincs kiválasztva Bajnok' : 'No Champion selected'}</div>
            )
          )}
        </>
      )}

      {/* Main Deck */}
      {hasZone(activeGame, 'mainDeck') && (
        <>
          <ZoneHeader title={getZoneTitle('mainDeck', mainRule?.label || "Main Deck")} count={mainTotal} min={mainRule?.min} max={mainRule?.max ?? 40} exact={mainRule?.exact} zoneKey="mainDeck" />
          {!collapsedZones.has('mainDeck') && renderZoneCards(mainCards, 'mainDeck')}
        </>
      )}

      {/* Rune Deck */}
      {hasZone(activeGame, 'runeDeck') && (
        <>
          <ZoneHeader title={getZoneTitle('runeDeck', runeRule?.label || "Rune Deck")} count={runeTotal} max={runeRule?.max ?? 12} exact={runeRule?.exact} zoneKey="runeDeck" />
          {!collapsedZones.has('runeDeck') && renderZoneCards(runeCards, 'runeDeck')}
        </>
      )}

      {/* Battlefields */}
      {hasZone(activeGame, 'battlefields') && (
        <>
          <ZoneHeader title={getZoneTitle('battlefields', bfRule?.label || "Battlefields")} count={bfTotal} max={bfRule?.max ?? 3} exact={bfRule?.exact} zoneKey="battlefields" />
          {!collapsedZones.has('battlefields') && renderZoneCards(bfCards, 'battlefields')}
        </>
      )}

      {/* Sideboard */}
      {hasZone(activeGame, 'sideboard') && (
        <>
          <ZoneHeader title={getZoneTitle('sideboard', sbRule?.label || "Sideboard")} count={sbTotal} min={sbRule?.min} max={sbRule?.max ?? 10} exact={sbRule?.exact} zoneKey="sideboard" />
          {!collapsedZones.has('sideboard') && renderZoneCards(sbCards, 'sideboard', 24)}
        </>
      )}
    </div>
  );
}
