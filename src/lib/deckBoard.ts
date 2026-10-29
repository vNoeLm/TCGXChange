import type { CatalogCard } from '../types';
import type { DeckState } from '../components/deck-builder/useDeckBuilder';
import { getDeckRules, hasZone, toGameId, zoneRule, type GameId } from './deckRules';
import { valueOfCard, type CardValueData } from './cardValues';

/** One card in a board section, with how many copies the deck plays. */
export interface DeckBoardCard {
  card: CatalogCard;
  qty: number;
}

export interface DeckBoardSection {
  key: string;
  label: string;
  zone: keyof DeckState;
  cards: DeckBoardCard[];
  /** Total copies in this section, not distinct cards. */
  count: number;
}

export interface DeckBoard {
  /** Legend, extra legends, champion, runes and battlefields: the cards around the main deck. */
  command: DeckBoardSection[];
  /** The main deck split by card type, largest group first, in display order. */
  main: DeckBoardSection[];
  sideboard: DeckBoardSection[];
  /** Every copy in the deck, sideboard included. */
  totalCards: number;
  /** Every copy on the main board (everything except the sideboard). */
  mainBoardCards: number;
}

export interface DeckCardEntry {
  card: CatalogCard;
  qty: number;
}

type CountZone = 'mainDeck' | 'runeDeck' | 'battlefields' | 'sideboard';

const COUNT_ZONES: CountZone[] = ['mainDeck', 'runeDeck', 'battlefields', 'sideboard'];

/** Riftbound's main deck reads Spell, Unit, Gear - the same order its deck pages show. */
const RIFTBOUND_MAIN_ORDER = ['Spell', 'Unit', 'Gear'];

function sortForBoard(cards: DeckBoardCard[]): DeckBoardCard[] {
  return [...cards].sort((a, b) => {
    const costA = Number.isFinite(a.card.cost) ? a.card.cost : Number.MAX_SAFE_INTEGER;
    const costB = Number.isFinite(b.card.cost) ? b.card.cost : Number.MAX_SAFE_INTEGER;
    if (costA !== costB) return costA - costB;
    return (a.card.name || '').localeCompare(b.card.name || '');
  });
}

/**
 * Every card in a deck with its copy count: single-card slots count once, count maps keep their
 * quantity. Cards that are no longer in the catalog are left out.
 */
export function deckCardEntries(deck: DeckState, cards: CatalogCard[]): DeckCardEntry[] {
  const byId = new Map(cards.map(c => [c.id, c]));
  const entries: DeckCardEntry[] = [];

  const add = (id: string | null | undefined, qty: number) => {
    const card = id ? byId.get(id) : null;
    if (card && Number.isFinite(qty) && qty > 0) entries.push({ card, qty });
  };

  add(deck.legend, 1);
  add(deck.champion, 1);
  (deck.extraLegends || []).forEach(id => add(id, 1));
  COUNT_ZONES.forEach(zone => {
    Object.entries(deck[zone] || {}).forEach(([id, qty]) => add(id, qty));
  });

  return entries;
}

/**
 * The visual board layout of a deck: command-zone groups first, the main deck split by card type,
 * then the sideboard. Sections carry the copy counts their headers show.
 */
export function buildDeckBoard(deck: DeckState, cards: CatalogCard[], game?: GameId | string): DeckBoard {
  const activeGame = toGameId(game ?? deck.game);
  const byId = new Map(cards.map(c => [c.id, c]));

  const zoneCards = (zone: CountZone): DeckBoardCard[] => Object.entries(deck[zone] || {})
    .map(([id, qty]) => {
      const card = byId.get(id);
      return card ? { card, qty } : null;
    })
    .filter((entry): entry is DeckBoardCard => entry !== null);

  const singleCard = (id: string | null | undefined): DeckBoardCard[] => {
    const card = id ? byId.get(id) : null;
    return card ? [{ card, qty: 1 }] : [];
  };

  const section = (key: string, label: string, zone: keyof DeckState, entries: DeckBoardCard[]): DeckBoardSection => {
    const sorted = sortForBoard(entries);
    return {
      key,
      label,
      zone,
      cards: sorted,
      count: sorted.reduce((total, entry) => total + entry.qty, 0),
    };
  };

  const command: DeckBoardSection[] = [];
  const rules = getDeckRules(activeGame);

  if (hasZone(activeGame, 'legend')) {
    command.push(section('legend', rules.legendLabel, 'legend', singleCard(deck.legend)));
  }

  const extraLegends = (deck.extraLegends || [])
    .map(id => byId.get(id))
    .filter((card): card is CatalogCard => Boolean(card))
    .map(card => ({ card, qty: 1 }));
  if (extraLegends.length > 0) {
    command.push(section('extraLegends', 'Extra Legends', 'extraLegends', extraLegends));
  }

  if (hasZone(activeGame, 'champion')) {
    command.push(section('champion', 'Champion', 'champion', singleCard(deck.champion)));
  }
  if (hasZone(activeGame, 'runeDeck')) {
    command.push(section('runeDeck', 'Rune', 'runeDeck', zoneCards('runeDeck')));
  }
  if (hasZone(activeGame, 'battlefields')) {
    command.push(section(
      'battlefields',
      zoneRule(activeGame, 'battlefields')?.label || 'Battlefields',
      'battlefields',
      zoneCards('battlefields'),
    ));
  }

  const mainCards = zoneCards('mainDeck');
  const byType = new Map<string, DeckBoardCard[]>();
  mainCards.forEach(entry => {
    const type = entry.card.card_type || 'Other';
    const list = byType.get(type) || [];
    list.push(entry);
    byType.set(type, list);
  });

  const preferredTypes: string[] = activeGame === 'riftbound'
    ? [...RIFTBOUND_MAIN_ORDER]
    : (rules.zones.find(zone => zone.key === 'mainDeck')?.types || []);
  const otherTypes = [...byType.keys()]
    .filter(type => !preferredTypes.includes(type))
    .sort((a, b) => a.localeCompare(b));

  const main: DeckBoardSection[] = [
    ...preferredTypes.filter(type => byType.has(type)),
    ...otherTypes,
  ].map(type => section(`main:${type}`, type, 'mainDeck', byType.get(type) || []));

  // The biggest group leads - the most copies first, so the board opens with what the deck is
  // mostly made of. Equal-sized groups keep the game's canonical type order (Spell/Unit/Gear for
  // Riftbound), then fall back to the type name, so the layout never depends on insertion order.
  main.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const rankOf = (label: string) => {
      const index = preferredTypes.indexOf(label);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    const rankDiff = rankOf(a.label) - rankOf(b.label);
    return rankDiff !== 0 ? rankDiff : a.label.localeCompare(b.label);
  });

  if (main.length === 0) {
    const mainRule = rules.zones.find(zone => zone.key === 'mainDeck');
    main.push(section('main', mainRule?.label || 'Main Deck', 'mainDeck', []));
  }

  const sideboardCards = zoneCards('sideboard');
  const sideboard = sideboardCards.length > 0
    ? [section('sideboard', zoneRule(activeGame, 'sideboard')?.label || 'Sideboard', 'sideboard', sideboardCards)]
    : [];

  const countOf = (sections: DeckBoardSection[]) => sections.reduce((total, entry) => total + entry.count, 0);
  const mainBoardCards = countOf(command) + countOf(main);

  return {
    command,
    main,
    sideboard,
    mainBoardCards,
    totalCards: mainBoardCards + countOf(sideboard),
  };
}

export interface DeckValueSummary {
  /** Value of every copy in the deck, in forints. */
  totalHuf: number;
  /** Copies with no price figure at all; they add nothing to totalHuf. */
  unpricedCards: number;
  /** Every copy in the deck, priced or not. */
  totalCards: number;
}

/**
 * What the deck is worth, using the same per-card value the catalog and collection views show
 * (the market reference, pulled towards the site's asking prices where there are any).
 */
export function deckValueHuf(deck: DeckState, cards: CatalogCard[], values: CardValueData): DeckValueSummary {
  let totalHuf = 0;
  let unpricedCards = 0;
  let totalCards = 0;

  for (const { card, qty } of deckCardEntries(deck, cards)) {
    totalCards += qty;
    const value = valueOfCard(card, false, values).valueHuf;
    if (value == null) unpricedCards += qty;
    else totalHuf += value * qty;
  }

  return { totalHuf, unpricedCards, totalCards };
}
