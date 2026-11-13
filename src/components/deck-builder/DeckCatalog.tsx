import { cardMatchesSearch } from '../../lib/cardSearchParser';
import { SearchCommandIntelliSense } from '../common/SearchCommandIntelliSense';
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CatalogCard, FilterState } from '../../types';
import { FilterSidebar } from '../FilterSidebar';
import type { DeckState } from './useDeckBuilder';
import { getCardImageUrl, cardThumbProps, gridThumbSize } from '../../lib/supabase';
import { gridSizeClasses, type GridSize } from '../../lib/gridSize';
import { findSearchableKeyword, cardHasKeyword, cardMatchesKeywords, cardMatchesSearchTag, SEARCHABLE_KEYWORDS } from '../../lib/keywordSearch';
import { keywordSolidColor } from '../../lib/formatGameText';
import { isAltArt, isOvernumbered, isSigned, isSp, isBaseSetCard, compareCardsByRarity, isToken } from '../../lib/cardVariants';
import {
  TAGS, sortSetNames,
  ONEPIECE_COLORS, ONEPIECE_RARITIES,
  MTG_RARITIES,
  LORCANA_RARITIES, LORCANA_INKS,
  STARWARS_RARITIES, STARWARS_ASPECTS,
  FAB_RARITIES, FAB_CLASSES,
} from '../../lib/constants';
import { maxCopies, zoneRule, type GameId } from '../../lib/deckRules';
import { useLoadMore, LoadMoreFooter } from '../LoadMore';
import { useLanguage } from '../../lib/i18n';

interface DeckCatalogProps {
  cards: CatalogCard[];
  activeGame?: GameId;
  allowedDomains: string[] | null;
  legendCard: CatalogCard | null;
  championCard: CatalogCard | null;
  activeZone: keyof DeckState;
  deck: DeckState;
  onAddCard: (card: CatalogCard) => void;
  onPreviewCard: (card: CatalogCard) => void;
  isWide?: boolean;
  /** Where the filter panel (with the Owned Only switch) is rendered: the Deck Builder's left column. */
  filtersSlot?: HTMLElement | null;
  onActiveFiltersCountChange?: (count: number) => void;
  gridSize?: GridSize;
  onGridSizeChange?: (size: GridSize) => void;
}

const DOMAIN_COLORS: Record<string, string> = {
  fury:      '#ef4444',
  calm:      '#22c55e',
  mind:      '#3b82f6',
  body:      '#f97316',
  chaos:     '#a855f7',
  order:     '#eab308',
  colorless: '#94a3b8',
  Red:       '#ef4444',
  Green:     '#22c55e',
  Blue:      '#06b6d4',
  Yellow:    '#eab308',
  Purple:    '#a855f7',
  Black:     '#71717a',
  red:       '#ef4444',
  green:     '#22c55e',
  blue:      '#06b6d4',
  yellow:    '#eab308',
  purple:    '#a855f7',
  black:     '#71717a',
};

// Ordered rarity list for display
const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase'];

// Zone-aware type options per game
const GAME_ZONE_TYPE_OPTIONS: Record<GameId, Record<string, string[]>> = {
  riftbound: {
    legend:      ['Legend'],
    extraLegends: ['Legend'],
    champion:    ['Unit'],
    mainDeck:    ['Unit', 'Spell', 'Gear'],
    sideboard:   ['Unit', 'Spell', 'Gear'],
    runeDeck:    ['Rune'],
    battlefields:['Battlefield'],
  },
  onepiece: {
    legend:      ['Leader'],
    mainDeck:    ['Character', 'Event', 'Stage'],
  },
  mtg: {
    mainDeck:    ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land', 'Battle'],
    sideboard:   ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land', 'Battle'],
  },
  lorcana: {
    mainDeck:    ['Character', 'Action', 'Item', 'Location'],
  },
  starwars: {
    legend:      ['Leader'],
    battlefields:['Base'],
    mainDeck:    ['Unit', 'Event', 'Upgrade'],
    sideboard:   ['Unit', 'Event', 'Upgrade', 'Leader', 'Base'],
  },
  fab: {
    legend:      ['Hero'],
    battlefields:['Weapon', 'Equipment'],
    mainDeck:    ['Action', 'Attack Reaction', 'Defense Reaction', 'Instant', 'Resource', 'Aura', 'Item', 'Block'],
    sideboard:   ['Action', 'Attack Reaction', 'Defense Reaction', 'Instant', 'Resource', 'Aura', 'Item', 'Block', 'Weapon', 'Equipment'],
  },
};

type TriState = 'all' | 'only' | 'none';
const nextTriState = (t: TriState): TriState => (t === 'all' ? 'only' : t === 'only' ? 'none' : 'all');

/** Number input that lets you clear it while typing; an empty box only falls back to a
 * default when you leave it, instead of snapping to 0 the moment you delete the digits. */
function CostInput({ label, value, fallback, onCommit, style }: {
  label: string;
  value: number;
  fallback: number;
  onCommit: (n: number) => void;
  style: { box: React.CSSProperties; label: React.CSSProperties; input: React.CSSProperties };
}) {
  const [draft, setDraft] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);
  React.useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);

  return (
    <label style={{ ...style.box, cursor: 'text' }}>
      <span style={style.label}>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onFocus={e => { setFocused(true); e.currentTarget.select(); }}
        onChange={e => {
          const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
          setDraft(digits);
          if (digits !== '') onCommit(parseInt(digits, 10));
        }}
        onBlur={() => {
          setFocused(false);
          if (draft === '') { onCommit(fallback); setDraft(String(fallback)); }
        }}
        style={style.input}
      />
    </label>
  );
}

export function DeckCatalog({
  cards,
  activeGame = 'riftbound',
  allowedDomains,
  legendCard,
  championCard,
  activeZone,
  deck,
  onAddCard,
  onPreviewCard,
  isWide = true,
  filtersSlot = null,
  onActiveFiltersCountChange,
  gridSize: propGridSize,
  onGridSizeChange,
}: DeckCatalogProps) {
  const { isHu, lang } = useLanguage();
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
  const theme = {
    accent: 'var(--accent)',
    accentMuted: 'var(--accent-muted)',
    accentBorder: 'var(--accent-border, var(--border))',
    accentGlow: 'var(--accent-glow)',
    textOnAccent: 'var(--text-on-accent)',
    inputBg: 'var(--bg-input, var(--bg-surface-2))',
    inputBorder: 'var(--border)',
    panelBg: 'var(--bg-surface)',
    panelBorder: 'var(--border)',
  };

  const [search, setSearch]             = useState('');
  const searchInputRef                  = useRef<HTMLInputElement>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [typeFilter, setTypeFilter]     = useState<string>('All');
  const [rarityFilter, setRarityFilter] = useState<string[]>([]);
  const [domainFilter, setDomainFilter] = useState<string[]>([]);
  const [altArtFilter, setAltArtFilter] = useState<TriState>('all');
  const [overnumberedFilter, setOvernumberedFilter] = useState<TriState>('all');
  const [signedFilter, setSignedFilter] = useState<TriState>('all');
  const [spFilter, setSpFilter] = useState<TriState>('all');
  const [baseSetOnly, setBaseSetOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [keywordFilter, setKeywordFilter] = useState<string[]>([]);
  const [keywordMode, setKeywordMode] = useState<'and' | 'or'>('and');
  const [setsFilter, setSetsFilter]   = useState<string[]>([]);
  const [costMin, setCostMin]           = useState<number>(0);
  const [costMax, setCostMax]           = useState<number>(10);
  const [onlyOwned, setOnlyOwned]       = useState<boolean>(false);
  const [sortMode, setSortMode]         = useState<
    'Cost (Low to High)' | 'Cost (High to Low)' |
    'Card Number (Asc)' | 'Card Number (Desc)' |
    'Name (A to Z)' | 'Name (Z to A)' |
    'Rarity (High to Low)' | 'Rarity (Low to High)'
  >('Cost (Low to High)');
  const [collection, setCollection]     = useState<Set<string>>(new Set());
  const [collectionQty, setCollectionQty] = useState<Record<string, number>>({});

  // Load saved collection from localStorage and keep synchronized
  React.useEffect(() => {
    // Array-shaped data has no quantities — treat presence as owning 1 copy.
    const toQtyMap = (raw: Record<string, number> | string[]): Record<string, number> => {
      if (Array.isArray(raw)) {
        return Object.fromEntries(raw.map(id => [id, 1]));
      }
      const qty: Record<string, number> = {};
      Object.entries(raw).forEach(([id, count]) => {
        if (typeof count === 'number' && count > 0) qty[id] = count;
      });
      return qty;
    };

    const loadCollection = () => {
      try {
        const saved = localStorage.getItem('tcg_user_collection') || localStorage.getItem('tcg_collection');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
            const qty = toQtyMap(parsed);
            setCollectionQty(qty);
            setCollection(new Set(Object.keys(qty)));
          } else {
            setCollectionQty({});
            setCollection(new Set());
          }
        } else {
          setCollectionQty({});
          setCollection(new Set());
        }
      } catch (e) {
        setCollectionQty({});
        setCollection(new Set());
      }
    };

    loadCollection();

    const handleColChange = (e: Event) => {
      const custom = e as CustomEvent<{ collection: Record<string, number> | string[] }>;
      if (custom.detail?.collection) {
        const qty = toQtyMap(custom.detail.collection);
        setCollectionQty(qty);
        setCollection(new Set(Object.keys(qty)));
      } else {
        loadCollection();
      }
    };

    window.addEventListener('tcg-collection-change', handleColChange);
    window.addEventListener('storage', loadCollection);
    window.addEventListener('focus', loadCollection);
    return () => {
      window.removeEventListener('tcg-collection-change', handleColChange);
      window.removeEventListener('storage', loadCollection);
      window.removeEventListener('focus', loadCollection);
    };
  }, []);

  // How many physical copies of a card NAME the user owns, summed across every
  // print/variant of that name and both normal + foil copies of each.
  const getOwnedCopies = useCallback((name: string): number => {
    let total = 0;
    cards.forEach(c => {
      if (c.name !== name) return;
      total += (collectionQty[c.id] || 0) + (collectionQty[`${c.id}_foil`] || 0);
    });
    return total;
  }, [cards, collectionQty]);

  // How many copies of a card NAME are already placed anywhere in the deck
  // (legend/leader + champion slot + every zone), mirroring the count useDeckBuilder's addCard uses.
  const getDeckCopies = useCallback((name: string): number => {
    let total = 0;
    const champ = cards.find(c => c.id === deck.champion);
    if (champ && champ.name === name) total += 1;
    const legend = cards.find(c => c.id === deck.legend);
    if (legend && legend.name === name) total += 1;
    (deck.extraLegends || []).forEach(id => {
      const el = cards.find(c => c.id === id);
      if (el && el.name === name) total += 1;
    });

    const countZone = (zoneMap: Record<string, number> | undefined) => {
      if (!zoneMap) return;
      Object.entries(zoneMap).forEach(([id, qty]) => {
        const c = cards.find(x => x.id === id);
        if (c && c.name === name) total += qty;
      });
    };
    countZone(deck.mainDeck);
    countZone(deck.runeDeck);
    countZone(deck.battlefields);
    countZone(deck.sideboard);
    return total;
  }, [cards, deck]);

  // Max copies allowed by game rules
  const getMaxCopiesAllowed = useCallback((card: CatalogCard): number => {
    return maxCopies(activeGame, card);
  }, [activeGame]);

  // How many copies of this EXACT print (not every print sharing the name) the
  // user owns, so two different art variants of the same card don't show each
  // other's counts.
  const getOwnedCopiesForPrint = useCallback((card: CatalogCard): number => {
    return (collectionQty[card.id] || 0) + (collectionQty[`${card.id}_foil`] || 0);
  }, [collectionQty]);

  // How many copies of this EXACT print are already placed in the deck.
  const getDeckCopiesForPrint = useCallback((card: CatalogCard): number => {
    let total = 0;
    if (deck.champion === card.id) total += 1;

    const countZone = (zoneMap: Record<string, number> | undefined) => {
      if (!zoneMap) return;
      total += zoneMap[card.id] || 0;
    };
    countZone(deck.mainDeck);
    countZone(deck.runeDeck);
    countZone(deck.battlefields);
    countZone(deck.sideboard);
    return total;
  }, [deck]);

  const handleAddCard = useCallback((card: CatalogCard) => {
    if (onlyOwned && card.card_type !== 'Rune') {
      const maxAllowed = getMaxCopiesAllowed(card);
      const owned = Math.min(getOwnedCopies(card.name), maxAllowed);
      const inDeck = getDeckCopies(card.name);
      if (inDeck >= owned) {
        alert(isHu ? `Csak ${owned} darabod van a(z) "${card.name}" kártyából. Kapcsold ki a "Csak birtokolt kártyák" szűrőt a továbbiak hozzáadásához.` : `You only own ${owned} cop${owned === 1 ? 'y' : 'ies'} of "${card.name}". Turn off "Owned Only" to add more than you have.`);
        return;
      }
    }
    onAddCard(card);
  }, [onlyOwned, getOwnedCopies, getDeckCopies, getMaxCopiesAllowed, onAddCard, isHu]);

  // Derive available sets from cards
  const availableSets = useMemo(() => {
    const seen = new Map<string, string>();
    cards.forEach(c => {
      const s = (c as any).sets;
      if (s?.id) seen.set(s.id, s.name || s.code || s.id);
    });
    // Oldest set first, extras (promos, starter products) last - not whatever order cards loaded in.
    const order = sortSetNames(Array.from(new Set(seen.values())));
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  }, [cards]);

  // Domain / Color options
  const domainOptions = useMemo(() => {
    if (activeGame === 'onepiece') {
      return ['All', ...ONEPIECE_COLORS];
    }
    if (activeGame === 'lorcana') {
      return ['All', ...LORCANA_INKS];
    }
    if (activeGame === 'starwars') {
      return ['All', ...STARWARS_ASPECTS];
    }
    if (activeGame === 'fab') {
      return ['All', ...FAB_CLASSES];
    }
    const base = (legendCard && allowedDomains)
      ? allowedDomains
      : ['fury', 'calm', 'mind', 'body', 'chaos', 'order'];
    return ['All', ...base, 'colorless'];
  }, [allowedDomains, legendCard, activeGame]);

  // Available type options for current zone (only show relevant types)
  const typeOptions = useMemo(() => {
    const opts = GAME_ZONE_TYPE_OPTIONS[activeGame]?.[activeZone];
    if (opts) return opts;
    const rule = zoneRule(activeGame, activeZone as string);
    return rule?.types || [];
  }, [activeGame, activeZone]);

  const showTypeFilter = typeOptions.length > 1;

  // Available rarities sorted in defined order (tokens excluded)
  const rarityOptions = useMemo(() => {
    const present = new Set(cards.filter(c => !isToken(c)).map(c => c.rarity).filter(Boolean));
    const order =
      activeGame === 'mtg' ? MTG_RARITIES :
      activeGame === 'onepiece' ? ONEPIECE_RARITIES :
      activeGame === 'lorcana' ? LORCANA_RARITIES :
      activeGame === 'starwars' ? STARWARS_RARITIES :
      activeGame === 'fab' ? FAB_RARITIES :
      RARITY_ORDER;
    const ordered = order.filter(r => present.has(r));
    const extras = Array.from(present).filter(r => !order.includes(r));
    return [...ordered, ...extras];
  }, [cards, activeGame]);

  // Number of cards in current catalog/zone that are owned (tokens excluded)
  const ownedInCatalogCount = useMemo(() => {
    return cards.filter(c => !isToken(c) && (collection.has(c.id) || collection.has(`${c.id}_foil`))).length;
  }, [cards, collection]);

  const filteredCards = useMemo(() => {
    return cards.filter(card => {
      // 0. Tokens are created in play and do not belong in constructed decks
      if (isToken(card)) return false;

      // 1. Zone validity — hard filter based on active zone
      if (activeGame === 'onepiece') {
        if (activeZone === 'legend' && card.card_type !== 'Leader') return false;
        if (activeZone === 'mainDeck' && !['Character', 'Event', 'Stage'].includes(card.card_type)) return false;
      } else if (activeGame === 'starwars') {
        if (activeZone === 'legend' && card.card_type !== 'Leader') return false;
        if (activeZone === 'battlefields' && card.card_type !== 'Base') return false;
        if (activeZone === 'mainDeck' && !['Unit', 'Event', 'Upgrade'].includes(card.card_type)) return false;
        if (activeZone === 'sideboard' && !['Unit', 'Event', 'Upgrade', 'Leader', 'Base'].includes(card.card_type)) return false;
      } else if (activeGame === 'fab') {
        if (activeZone === 'legend' && card.card_type !== 'Hero') return false;
        if (activeZone === 'battlefields' && !['Weapon', 'Equipment'].includes(card.card_type)) return false;
        if (activeZone === 'mainDeck' && !['Action', 'Attack Reaction', 'Defense Reaction', 'Instant', 'Resource', 'Aura', 'Item', 'Block'].includes(card.card_type)) return false;
      } else if (activeGame === 'mtg') {
        // MTG cards in mainDeck or sideboard: all types allowed
      } else if (activeGame === 'lorcana') {
        if (activeZone === 'mainDeck' && !['Character', 'Action', 'Item', 'Location'].includes(card.card_type)) return false;
      } else {
        // Riftbound
        switch (activeZone) {
          case 'legend':       if (card.card_type !== 'Legend') return false; break;
          // Neeko's extra legends: any legend, whatever its domain (see the domain check below).
          case 'extraLegends': if (card.card_type !== 'Legend') return false; break;
          case 'champion':
            if (card.card_type !== 'Unit' || card.subtype !== 'Champion') return false;
            if (legendCard) {
              const NON_CHAMPION_TAGS = new Set([
                'promo', 'release event', 'event',
                'bandle city', 'bilgewater', 'demacia', 'freljord', 'icathia', 'ionia',
                'ixtal', 'kathkan', 'mount targon', 'noxus', 'piltover', 'shadow isles',
                'shurima', 'the void', 'zaun',
                'bird', 'bomb', 'cat', 'demon', 'dog', 'dragon', 'elite', 'equipment',
                'fae', 'mech', 'pirate', 'poro', 'recruit', 'sentinel', 'spider',
                'spirit', 'trifarian', 'yordle',
              ]);
              const legendBaseName = legendCard.name.split(/,| - |\(/)[0].trim().toLowerCase();
              const rawLegendTags = Array.isArray(legendCard.tags)
                ? legendCard.tags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean)
                : [];
              const championTags = (legendBaseName && rawLegendTags.includes(legendBaseName))
                ? [legendBaseName]
                : rawLegendTags.filter((t) => !NON_CHAMPION_TAGS.has(t));
              const matchTags = championTags.length > 0 ? championTags : (legendBaseName ? [legendBaseName] : []);

              const cardTags = Array.isArray(card.tags) && card.tags.length > 0
                ? card.tags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean)
                : [card.name.split(/,| - |\(/)[0].trim().toLowerCase()].filter(Boolean);
              const hasCommonTag = matchTags.length === 0 || cardTags.some((t: string) => matchTags.includes(t));
              if (!hasCommonTag) return false;
            }
            break;
          case 'runeDeck':     if (card.card_type !== 'Rune') return false; break;
          case 'battlefields': if (card.card_type !== 'Battlefield') return false; break;
          case 'mainDeck':
          case 'sideboard':    if (!['Unit', 'Spell', 'Gear'].includes(card.card_type)) return false; break;
        }
      }

      // 2. Domain / Color restriction from selected Legend / Leader
      if (allowedDomains && activeZone !== 'legend' && activeZone !== 'extraLegends') {
        const cardDomains = (card.domain || '').toLowerCase().split(/[,/]/).map(d => d.trim()).filter(Boolean);
        const isColorless = cardDomains.length === 0 || cardDomains.includes('colorless');
        const matches = cardDomains.some(d => allowedDomains.some(ad => ad.toLowerCase() === d));
        if (activeGame === 'onepiece') {
          if (!matches) return false;
        } else if (activeGame === 'riftbound') {
          if (!isColorless && !matches) return false;
        }
      }

      // 2b. Signature cards (Spells, Gear, Units) only belong to their own Champion - sharing the
      // Legend's domain isn't enough (e.g. picking a Fury Legend doesn't unlock every Fury
      // champion's signature card, only the one whose Champion is actually in the deck).
      if (activeGame === 'riftbound' && (activeZone === 'mainDeck' || activeZone === 'sideboard')) {
        const isSignatureItem = (card.subtype || '').toLowerCase().includes('signature');
        if (isSignatureItem) {
          if (!championCard) return false;
          const champBaseName = championCard.name.split(/,| - /)[0].trim().toLowerCase();
          const itemTags = Array.isArray(card.tags) ? card.tags.map((t: any) => String(t).toLowerCase()) : [];
          if (!itemTags.includes(champBaseName)) return false;
        }
      }

      // 3. Owned-only filter
      if (onlyOwned) {
        const isOwned = collection.has(card.id) || collection.has(`${card.id}_foil`);
        if (!isOwned) return false;
      }

      // 4. Search
      if (search) {
        if (!cardMatchesSearch(card, search)) return false;
      }

      // 5. Type sub-filter
      if (typeFilter !== 'All' && card.card_type !== typeFilter) return false;

      // 6. Rarity (any of the selected)
      if (rarityFilter.length > 0 && !rarityFilter.includes(card.rarity)) return false;

      // 7. Domain / Color filter chips (any of the selected)
      if (domainFilter.length > 0) {
        const matchesDomain = domainFilter.some(sel => {
          const cardDomains = (card.domain || '').toLowerCase().split(/[,/]/).map(d => d.trim()).filter(Boolean);
          if (sel === 'colorless') return cardDomains.length === 0 || cardDomains.includes('colorless');
          return cardDomains.includes(sel.toLowerCase());
        });
        if (!matchesDomain) return false;
      }

      // 7c. Card variants (same rules as the catalog's Card Variant filters)
      if (baseSetOnly) {
        if (!isBaseSetCard(card)) return false;
      } else {
        const variantChecks: Array<[TriState, boolean]> = [
          [signedFilter, isSigned(card)],
          [altArtFilter, isAltArt(card)],
          [overnumberedFilter, isOvernumbered(card)],
          [spFilter, isSp(card)],
        ];
        for (const [mode, has] of variantChecks) {
          if (mode === 'only' && !has) return false;
          if (mode === 'none' && has) return false;
        }
      }

      // 7d. Tags (any of the selected, as in the catalog)
      if (tagFilter.length > 0) {
        const cardTags = Array.isArray(card.tags) ? card.tags.map((t: any) => String(t).toLowerCase()) : [];
        if (!tagFilter.some(t => cardTags.includes(t.toLowerCase()))) return false;
      }

      // 7e. Keywords (AND / OR)
      if (!cardMatchesKeywords(card, keywordFilter, keywordMode)) return false;

      // 8. Set filter
      if (setsFilter.length > 0) {
        const s = (card as any).sets;
        if (!s || (!setsFilter.includes(s.name) && !setsFilter.includes(s.id))) return false;
      }

      // 9. Cost range
      const cost = card.cost ?? 0;
      if (cost < costMin || cost > costMax) return false;

      return true;
    });
  }, [cards, search, typeFilter, rarityFilter, domainFilter, altArtFilter, overnumberedFilter, signedFilter, spFilter, baseSetOnly, tagFilter, keywordFilter, keywordMode, setsFilter, costMin, costMax, onlyOwned, collection, allowedDomains, legendCard, championCard, activeZone, activeGame]);

  const sortedCards = useMemo(() => {
    const list = [...filteredCards];
    return list.sort((a, b) => {
      switch (sortMode) {
        case 'Cost (Low to High)': {
          const costA = a.cost ?? 999;
          const costB = b.cost ?? 999;
          if (costA !== costB) return costA - costB;
          return a.name.localeCompare(b.name);
        }
        case 'Cost (High to Low)': {
          const costA = a.cost ?? -1;
          const costB = b.cost ?? -1;
          if (costA !== costB) return costB - costA;
          return a.name.localeCompare(b.name);
        }
        case 'Card Number (Asc)': {
          const numA = parseInt((a.card_number || '').match(/\d+/)?.[0] || '0', 10);
          const numB = parseInt((b.card_number || '').match(/\d+/)?.[0] || '0', 10);
          if (numA !== numB) return numA - numB;
          return (a.card_number || '').localeCompare(b.card_number || '');
        }
        case 'Card Number (Desc)': {
          const numA = parseInt((a.card_number || '').match(/\d+/)?.[0] || '0', 10);
          const numB = parseInt((b.card_number || '').match(/\d+/)?.[0] || '0', 10);
          if (numA !== numB) return numB - numA;
          return (b.card_number || '').localeCompare(a.card_number || '');
        }
        case 'Name (A to Z)':
          return a.name.localeCompare(b.name);
        case 'Name (Z to A)':
          return b.name.localeCompare(a.name);
        case 'Rarity (High to Low)':
          return compareCardsByRarity(a, b, 'desc');
        case 'Rarity (Low to High)':
          return compareCardsByRarity(a, b, 'asc');
        default:
          return 0;
      }
    });
  }, [filteredCards, sortMode]);

  const catalogResetKey = useMemo(() => JSON.stringify([
    search,
    typeFilter,
    rarityFilter,
    domainFilter,
    altArtFilter,
    overnumberedFilter,
    signedFilter,
    spFilter,
    baseSetOnly,
    tagFilter,
    keywordFilter,
    keywordMode,
    setsFilter,
    costMin,
    costMax,
    onlyOwned,
    activeZone,
    activeGame,
    sortMode,
    cards.length,
  ]), [
    search,
    typeFilter,
    rarityFilter,
    domainFilter,
    altArtFilter,
    overnumberedFilter,
    signedFilter,
    spFilter,
    baseSetOnly,
    tagFilter,
    keywordFilter,
    keywordMode,
    setsFilter,
    costMin,
    costMax,
    onlyOwned,
    activeZone,
    activeGame,
    sortMode,
    cards.length,
  ]);

  const loadMoreState = useLoadMore(sortedCards.length, 48, catalogResetKey, Infinity);
  const paginatedCards = useMemo(() => {
    return sortedCards.slice(0, loadMoreState.shown);
  }, [sortedCards, loadMoreState.shown]);

  const activeFiltersCount =
    (onlyOwned ? 1 : 0) +
    (typeFilter !== 'All' ? 1 : 0) +
    rarityFilter.length +
    domainFilter.length +
    (altArtFilter !== 'all' ? 1 : 0) +
    (overnumberedFilter !== 'all' ? 1 : 0) +
    (signedFilter !== 'all' ? 1 : 0) +
    (spFilter !== 'all' ? 1 : 0) +
    (baseSetOnly ? 1 : 0) +
    tagFilter.length +
    keywordFilter.length +
    setsFilter.length +
    (costMin !== 0 || costMax !== 10 ? 1 : 0);

  const resetFilters = useCallback(() => {
    setOnlyOwned(false);
    setTypeFilter('All');
    setRarityFilter([]);
    setDomainFilter([]);
    setAltArtFilter('all');
    setOvernumberedFilter('all');
    setSignedFilter('all');
    setSpFilter('all');
    setBaseSetOnly(false);
    setTagFilter([]);
    setKeywordFilter([]);
    setKeywordMode('and');
    setSetsFilter([]);
    setCostMin(0);
    setCostMax(10);
  }, []);

  const sidebarFilters: FilterState = useMemo(() => ({
    game: activeGame,
    sets: setsFilter,
    rarities: rarityFilter,
    type: typeFilter === 'All' ? '' : typeFilter,
    domains: domainFilter,
    tags: tagFilter,
    keywords: keywordFilter,
    keywordMode,
    costMin,
    costMax,
    foilFilter: false,
    signedFilter,
    altArtFilter,
    overnumberedFilter,
    spFilter,
    baseSetFilter: baseSetOnly ? 'only' : 'all',
  }), [activeGame, setsFilter, rarityFilter, typeFilter, domainFilter, tagFilter, keywordFilter, keywordMode, costMin, costMax, signedFilter, altArtFilter, overnumberedFilter, spFilter, baseSetOnly]);

  const handleSidebarFiltersChange = useCallback((next: FilterState) => {
    setSetsFilter(next.sets || []);
    setRarityFilter(next.rarities || []);
    setTypeFilter(next.type ? next.type : 'All');
    setDomainFilter(next.domains || []);
    setTagFilter(next.tags || []);
    setKeywordFilter(next.keywords || []);
    setKeywordMode(next.keywordMode || 'and');
    setCostMin(typeof next.costMin === 'number' ? next.costMin : 0);
    setCostMax(typeof next.costMax === 'number' ? next.costMax : 10);
    setSignedFilter(next.signedFilter || 'all');
    setAltArtFilter(next.altArtFilter || 'all');
    setOvernumberedFilter(next.overnumberedFilter || 'all');
    setSpFilter(next.spFilter || 'all');
    setBaseSetOnly(next.baseSetFilter === 'only');
  }, []);

  const sidebarOptions = useMemo(() => ({
    sets: availableSets.map((s) => s.name),
    rarities: rarityOptions,
    types: showTypeFilter ? typeOptions : [],
    domains: domainOptions.filter((d) => d !== 'All'),
    tags: activeGame === 'riftbound' ? TAGS : [],
  }), [availableSets, rarityOptions, showTypeFilter, typeOptions, domainOptions, activeGame]);

  const currentLabelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-accent)',
    marginBottom: 6,
    display: 'block',
  };

  const currentSelectStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    borderRadius: 6,
    background: theme.inputBg,
    border: `1px solid ${theme.inputBorder}`,
    color: '#f4f4f5',
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
  };

  // Every filter pill shares one size so the panel reads as a tidy grid instead of a jumble of
  // differently sized chips; text that doesn't fit is truncated (full name in the tooltip).
  const pillGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(82px, 1fr))',
    gap: 6,
    marginTop: 6,
  };
  const pillStyle = (active: boolean, opts: { color?: string; negative?: boolean } = {}): React.CSSProperties => {
    const color = opts.color || theme.accent;
    return {
      height: 28, minWidth: 0, padding: '0 6px', borderRadius: 8,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      background: opts.negative ? 'rgba(244,63,94,0.15)' : active ? (opts.color ? color + '30' : theme.accentMuted) : 'rgba(255,255,255,0.03)',
      border: `1px solid ${opts.negative ? 'rgba(244,63,94,0.7)' : active ? color : theme.inputBorder}`,
      color: opts.negative ? '#fda4af' : active ? color : 'var(--text-muted)',
      textDecoration: opts.negative ? 'line-through' : 'none',
      transition: 'all 0.15s',
    };
  };

  const costInputStyle = {
    box: { display: 'flex', alignItems: 'center', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: 8, padding: '0 10px', flex: 1, minWidth: 0, minHeight: 42 } as React.CSSProperties,
    label: { fontSize: 11, color: 'var(--text-muted)', marginRight: 6, fontWeight: 700 } as React.CSSProperties,
    input: { background: 'transparent', border: 'none', color: '#f4f4f5', outline: 'none', fontSize: 15, flex: 1, minWidth: 0, width: '100%', height: 40, textAlign: 'center', fontWeight: 600 } as React.CSSProperties,
  };

  React.useEffect(() => { onActiveFiltersCountChange?.(activeFiltersCount); }, [activeFiltersCount, onActiveFiltersCountChange]);

  const filtersPanel = (
          <div style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}>

            {/* Owned Only Filter Switch — whole row toggles it, not just the pill */}
            <div
              onClick={() => setOnlyOwned(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px',
                background: theme.inputBg,
                borderRadius: 10,
                border: `1px solid ${theme.inputBorder}`,
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isHu ? 'Csak birtokolt kártyák' : 'Only Show Owned Cards'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {collection.size > 0 ? `${ownedInCatalogCount} ${isHu ? 'egyező kártya a gyűjteményedben' : 'matching cards owned in your collection'}` : (isHu ? 'Jelenleg nincsenek kártyák a gyűjteményedben' : 'No cards currently saved in your collection')}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setOnlyOwned(o => !o); }}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  background: onlyOwned ? theme.accent : 'transparent',
                  border: `1px solid ${onlyOwned ? theme.accent : theme.inputBorder}`,
                  color: onlyOwned ? theme.textOnAccent : 'var(--text-muted)',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                {onlyOwned ? (isHu ? 'BE' : 'ON') : (isHu ? 'KI' : 'OFF')}
              </button>
            </div>

            {/* Unified FilterSidebar */}
            <FilterSidebar
              filters={sidebarFilters}
              setFilters={handleSidebarFiltersChange}
              options={sidebarOptions}
            />

            {activeFiltersCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={resetFilters}
                  className="tv-btn-danger cursor-pointer transition"
                  style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}
                >
                  {isHu ? 'Szűrők alaphelyzetbe' : 'Reset Filters'}
                </button>
              </div>
            )}
          </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Legend prompt */}
      {!legendCard && (
        <div style={{ background: 'var(--accent-muted)', border: '1px solid var(--accent-border, var(--border))', color: 'var(--text-accent)', padding: '11px 16px', borderRadius: 10, marginBottom: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          {isHu ? 'Először válaszd ki a Legendádat — ez határozza meg, milyen doméneket játszhatsz.' : 'Select your Legend first — it determines which domains you can play.'}
        </div>
      )}

      {/* Search + Filters toggle + Sort By + Owned Only */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 160px' }}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder={(!legendCard || activeZone === 'extraLegends') ? (isHu ? "Legendák keresése…" : "Search Legends…") : (isHu ? "Kártyák keresése…" : "Search cards…")}
              value={search}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '9px 14px', borderRadius: 8,
                background: theme.inputBg,
                border: `1px solid ${theme.inputBorder}`,
                color: '#f4f4f5', outline: 'none', fontSize: 14,
              }}
            />
            <SearchCommandIntelliSense
              inputRef={searchInputRef}
              value={search}
              onChange={setSearch}
              isOpen={isSearchFocused}
              onClose={() => setIsSearchFocused(false)}
              lang={lang}
            />
          </div>

          {/* Sort By Dropdown */}
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as any)}
            style={{
              padding: '9px 12px', borderRadius: 8,
              background: theme.inputBg,
              border: `1px solid ${theme.inputBorder}`,
              color: '#f4f4f5',
              fontWeight: 700, fontSize: 13, outline: 'none', cursor: 'pointer'
            }}
            title={isHu ? 'Rendezés' : 'Sort by'}
          >
            <option value="Cost (Low to High)">{isHu ? 'Energia költség (Növekvő)' : 'Cost: Low to High'}</option>
            <option value="Cost (High to Low)">{isHu ? 'Energia költség (Csökkenő)' : 'Cost: High to Low'}</option>
            <option value="Card Number (Asc)">{isHu ? 'Kártyaszám (Növekvő)' : 'Card Number (Asc)'}</option>
            <option value="Card Number (Desc)">{isHu ? 'Kártyaszám (Csökkenő)' : 'Card Number (Desc)'}</option>
            <option value="Name (A to Z)">{isHu ? 'Név (A - Z)' : 'Name (A to Z)'}</option>
            <option value="Name (Z to A)">{isHu ? 'Név (Z - A)' : 'Name (Z to A)'}</option>
            <option value="Rarity (High to Low)">{isHu ? 'Ritkaság (Csökkenő)' : 'Rarity (High to Low)'}</option>
            <option value="Rarity (Low to High)">{isHu ? 'Ritkaság (Növekvő)' : 'Rarity (Low to High)'}</option>
          </select>

          {/* Grid Size Switcher */}
          <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border)] rounded-xl p-1 h-[38px] shrink-0 gap-1">
            {(['small', 'normal', 'large'] as const).map(size => {
              const active = currentGridSize === size;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => handleGridSizeChange(size)}
                  title={isHu ? `Kártya méret: ${size === 'small' ? 'Kicsi' : size === 'normal' ? 'Normál' : 'Nagy'}` : `Card display size: ${size}`}
                  className={`flex items-center justify-center px-3 py-1 text-xs rounded-lg transition cursor-pointer capitalize font-bold ${
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

        {filtersSlot && createPortal(filtersPanel, filtersSlot)}
      </div>

      {/* Card Grid */}
      <div style={{ paddingRight: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 8px' }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
            {sortedCards.length} {isHu ? 'kártya' : 'cards'} {onlyOwned && <span style={{ color: '#10b981' }}>({isHu ? 'Csak birtokolt' : 'Owned Only'})</span>}
          </p>
        </div>

        <div className={`grid ${gridSizeClasses(currentGridSize)}`}>
          {paginatedCards.map(card => {
            const fallback = `https://placehold.co/400x560/1e293b/94a3b8?text=${encodeURIComponent(card.name)}`;
            const imgSrc = card.image_path ? getCardImageUrl(card.image_path) : fallback;
            const primaryDomain = (card.domain || '').toLowerCase().split(',')[0].trim();
            const domainColor = DOMAIN_COLORS[primaryDomain] || '#334155';
            const isOwned = collection.has(card.id) || collection.has(`${card.id}_foil`);


            return (
              <div key={card.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }} className="deck-catalog-card">
                <div
                  style={{
                    position: 'relative', borderRadius: 8, overflow: 'hidden',
                    aspectRatio: '2.5/3.5',
                    border: `1px solid ${isOwned ? 'rgba(52,211,153,0.6)' : domainColor + '55'}`,
                    boxShadow: isOwned ? '0 4px 14px rgba(52,211,153,0.15)' : '0 4px 12px rgba(0,0,0,0.3)',
                    cursor: 'pointer',
                    transform: 'translateZ(0)',
                    willChange: 'transform',
                  }}
                  onClick={() => handleAddCard(card)}
                  onContextMenu={e => { e.preventDefault(); onPreviewCard(card); }}
                >
                  <img {...(card.image_path ? cardThumbProps(card.image_path, gridThumbSize(currentGridSize)) : { src: imgSrc })} alt={card.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

                  {/* Owned check badge — shows owned/in-deck counts while Owned Only is active */}
                  {isOwned && (() => {
                    if (!onlyOwned || card.card_type === 'Rune') {
                      return (
                        <div
                          style={{
                            position: 'absolute', top: 4, right: 4, zIndex: 3,
                            background: 'rgba(16,185,129,0.95)', color: '#fff',
                            borderRadius: '50%', width: 18, height: 18,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 900, boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                            border: '1px solid rgba(255,255,255,0.4)',
                          }}
                          title={isHu ? "A gyűjteményedben" : "In your collection"}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                        </div>
                      );
                    }
                    const ownedQty = Math.min(getOwnedCopiesForPrint(card), getMaxCopiesAllowed(card));
                    const deckQty = getDeckCopiesForPrint(card);
                    // Green: room to add more of this print. Amber: exactly at your owned
                    // count. Red: more copies in the deck than you actually own of this print.
                    const badgeColor = deckQty > ownedQty
                      ? 'rgba(239,68,68,0.95)'
                      : deckQty === ownedQty
                        ? 'rgba(245,158,11,0.95)'
                        : 'rgba(16,185,129,0.95)';
                    return (
                      <div
                        style={{
                          position: 'absolute', top: 4, right: 4, zIndex: 3,
                          background: badgeColor, color: '#fff',
                          borderRadius: 9, minWidth: 18, height: 18, padding: '0 5px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 900, fontFamily: 'monospace', boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                          border: '1px solid rgba(255,255,255,0.4)',
                        }}
                        title={isHu ? `${ownedQty} db a birtokodban — ${deckQty} már a pakliban` : `You own ${ownedQty} cop${ownedQty === 1 ? 'y' : 'ies'} — ${deckQty} already in this deck`}
                      >
                        {deckQty}/{ownedQty}
                      </div>
                    );
                  })()}

                  <div className="deck-overlay" style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(0,0,0,0.65)',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    alignItems: 'center', padding: '6px', gap: 4,
                    opacity: 0, transition: 'opacity 0.15s',
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: 'rgba(99,102,241,0.85)', padding: '3px 10px', borderRadius: 20 }}>
                      {isHu ? '+ Hozzáadás' : '+ Add'}
                    </span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>{isHu ? 'Jobb klikk az előnézethez' : 'Right-click to preview'}</span>
                  </div>
                </div>
                <div style={{
                  fontSize: currentGridSize === 'small' ? 10 : currentGridSize === 'large' ? 13 : 11,
                  fontWeight: 700,
                  textAlign: 'center',
                  color: isOwned ? 'var(--text-primary)' : 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {card.name}
                </div>
              </div>
            );
          })}

          {filteredCards.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              {onlyOwned ? (
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>{isHu ? 'Egyetlen birtokolt kártya sem felel meg a jelenlegi szűrőknek.' : 'No owned cards match your current filters.'}</p>
                  <button
                    onClick={() => setOnlyOwned(false)}
                    style={{ background: 'var(--accent-muted)', border: '1px solid var(--accent-border)', color: 'var(--accent-light)', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                  >
                    {isHu ? 'Összes katalóguskártya megjelenítése' : 'Show all catalog cards'}
                  </button>
                </div>
              ) : (
                isHu ? 'Egyetlen kártya sem felel meg a szűrőknek.' : 'No cards match your filters.'
              )}
            </div>
          )}
        </div>

        {filteredCards.length > 0 && (
          <LoadMoreFooter state={loadMoreState} total={sortedCards.length} noun={isHu ? 'kártya' : 'cards'} />
        )}
      </div>

      <style>{`
        .deck-catalog-card:hover .deck-overlay { opacity: 1 !important; }
      `}</style>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', marginTop: 6, borderRadius: 7,
  background: 'var(--bg-input, #1e293b)',
  border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none', fontSize: 13,
};


