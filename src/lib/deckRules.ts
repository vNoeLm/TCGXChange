/**
 * Per-game deck rules and zone configuration for the deck builder.
 *
 * Every deck is stored in the same DeckState shape (legend / champion / mainDeck / runeDeck /
 * battlefields / sideboard); a game just uses a subset of those zones, relabelled:
 *  - Riftbound: legend, champion, main (40), runes (12), battlefields (3), sideboard (8), 3 copies.
 *  - One Piece: the leader sits in the "legend" slot, main deck is exactly 50 non-leader cards,
 *    4 copies, colour identity from the leader.
 *  - Magic: main deck of at least 60, optional sideboard of up to 15, 4 copies except basic lands.
 */

export type GameId = 'riftbound' | 'onepiece' | 'mtg' | 'lorcana' | 'starwars' | 'fab';

export const GAME_IDS: GameId[] = ['riftbound', 'onepiece', 'mtg', 'lorcana', 'starwars', 'fab'];

export type ZoneKey = 'legend' | 'extraLegends' | 'champion' | 'mainDeck' | 'runeDeck' | 'battlefields' | 'sideboard';

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as string[]).includes(value);
}

/** Any stored/unknown game value -> a valid GameId (Riftbound, the original game, by default). */
export function toGameId(value: unknown): GameId {
  return isGameId(value) ? value : 'riftbound';
}

/**
 * Per-game localStorage key: `${game}_${suffix}`. For Riftbound this yields the original
 * 'riftbound_deck' / 'riftbound_saved_decks' / 'riftbound_loaded_deck_id' keys, so existing
 * users keep their data.
 */
export function gameStorageKey(game: unknown, suffix: 'deck' | 'saved_decks' | 'loaded_deck_id'): string {
  return `${toGameId(game)}_${suffix}`;
}

export interface ZoneRule {
  key: ZoneKey;
  label: string;
  /** Card count that makes the zone valid: exactly `max` when `exact`, otherwise within min..max. */
  min?: number;
  max: number;
  exact?: boolean;
  /** card_type values that may go in this zone; null = any type. */
  types: string[] | null;
}

export interface DeckRules {
  game: GameId;
  /** What the single "legend" slot is called ("Legend" / "Leader"). */
  legendLabel: string;
  /** Visible zones in display order. */
  zones: ZoneRule[];
  /** Default max copies of one card name (across every zone). */
  copyLimit: number;
  /** One-line summary shown in the UI. */
  summary: string;
  /** Whether the legend's colours/domains restrict the rest of the catalog. */
  colorIdentity: boolean;
  /** Opening hand size, for the hand simulator. */
  handSize: number;
}

const RIFTBOUND: DeckRules = {
  game: 'riftbound',
  legendLabel: 'Legend',
  copyLimit: 3,
  colorIdentity: true,
  handSize: 4,
  summary: '1 Legend, 1 Champion, 40 Main Deck (incl. Champion), 12 Runes, 3 Battlefields (56 cards total), up to 3 copies per card',
  zones: [
    { key: 'legend', label: 'Legend Zone', max: 1, exact: true, types: ['Legend'] },
    { key: 'champion', label: 'Chosen Champion', max: 1, exact: true, types: ['Unit'] },
    { key: 'mainDeck', label: 'Main Deck', max: 40, exact: true, types: ['Unit', 'Spell', 'Gear'] },
    { key: 'runeDeck', label: 'Rune Deck', max: 12, exact: true, types: ['Rune'] },
    { key: 'battlefields', label: 'Battlefields', max: 3, exact: true, types: ['Battlefield'] },
    { key: 'sideboard', label: 'Sideboard', max: 8, exact: true, types: ['Unit', 'Spell', 'Gear'] },
  ],
};

const ONEPIECE: DeckRules = {
  game: 'onepiece',
  legendLabel: 'Leader',
  copyLimit: 4,
  colorIdentity: true,
  handSize: 5,
  summary: '1 Leader, exactly 50 Main Deck cards, up to 4 copies per card, cards must share a Leader colour',
  zones: [
    { key: 'legend', label: 'Leader', max: 1, exact: true, types: ['Leader'] },
    { key: 'mainDeck', label: 'Main Deck', max: 50, exact: true, types: ['Character', 'Event', 'Stage'] },
  ],
};

const MTG: DeckRules = {
  game: 'mtg',
  legendLabel: 'Legend',
  copyLimit: 4,
  colorIdentity: false,
  handSize: 7,
  summary: 'At least 60 Main Deck cards, up to 15 Sideboard, up to 4 copies per card (basic lands unlimited)',
  zones: [
    { key: 'mainDeck', label: 'Main Deck', min: 60, max: Infinity, types: null },
    { key: 'sideboard', label: 'Sideboard', max: 15, types: null },
  ],
};

const LORCANA: DeckRules = {
  game: 'lorcana',
  legendLabel: 'Character',
  copyLimit: 4,
  colorIdentity: false,
  handSize: 7,
  summary: 'At least 60 Main Deck cards, up to 4 copies per card, maximum 2 inks',
  zones: [
    { key: 'mainDeck', label: 'Main Deck', min: 60, max: Infinity, types: ['Character', 'Action', 'Item', 'Location'] },
  ],
};

const STARWARS: DeckRules = {
  game: 'starwars',
  legendLabel: 'Leader',
  copyLimit: 3,
  colorIdentity: false,
  handSize: 6,
  summary: '1 Leader, 1 Base, at least 50 Main Deck cards, up to 10 Sideboard, up to 3 copies per card',
  zones: [
    { key: 'legend', label: 'Leader', max: 1, exact: true, types: ['Leader'] },
    { key: 'battlefields', label: 'Base', max: 1, exact: true, types: ['Base'] },
    { key: 'mainDeck', label: 'Main Deck', min: 50, max: Infinity, types: ['Unit', 'Event', 'Upgrade'] },
    { key: 'sideboard', label: 'Sideboard', max: 10, types: ['Unit', 'Event', 'Upgrade', 'Leader', 'Base'] },
  ],
};

const FAB: DeckRules = {
  game: 'fab',
  legendLabel: 'Hero',
  copyLimit: 3,
  colorIdentity: false,
  handSize: 4,
  summary: '1 Hero, Weapons & Equipment, 40 to 60 Deck cards, up to 3 copies per card',
  zones: [
    { key: 'legend', label: 'Hero', max: 1, exact: true, types: ['Hero'] },
    { key: 'battlefields', label: 'Weapons & Equipment', max: 6, types: ['Weapon', 'Equipment'] },
    { key: 'mainDeck', label: 'Deck', min: 40, max: 80, types: ['Action', 'Attack Reaction', 'Defense Reaction', 'Instant', 'Resource', 'Aura', 'Item', 'Block'] },
    { key: 'sideboard', label: 'Inventory / Sideboard', max: 20, types: null },
  ],
};

const RULES: Record<GameId, DeckRules> = {
  riftbound: RIFTBOUND,
  onepiece: ONEPIECE,
  mtg: MTG,
  lorcana: LORCANA,
  starwars: STARWARS,
  fab: FAB,
};

export function getDeckRules(game: unknown): DeckRules {
  return RULES[toGameId(game)];
}

export function zoneRule(game: unknown, zone: string): ZoneRule | undefined {
  return getDeckRules(game).zones.find(z => z.key === zone);
}

export function hasZone(game: unknown, zone: string): boolean {
  return Boolean(zoneRule(game, zone));
}

/** The zone a fresh deck starts on: the first visible zone. */
export function defaultZone(game: unknown): ZoneKey {
  return getDeckRules(game).zones[0].key;
}

/** Zones that hold a card count map (everything except the single-card slots). */
export const MAP_ZONES = ['mainDeck', 'runeDeck', 'battlefields', 'sideboard'] as const;

const BASIC_LAND = /^(snow-covered )?(plains|island|swamp|mountain|forest)$|^wastes$|^snow-covered wastes$/i;

/** Magic basic lands (and Snow-Covered / Wastes variants) are exempt from the copy limit. */
export function isBasicLand(name: string | null | undefined): boolean {
  return BASIC_LAND.test((name || '').trim());
}

interface NamedCard {
  name?: string | null;
  card_type?: string | null;
}

/** Max copies of a card (by name, summed across zones) allowed in a deck of this game. */
export function maxCopies(game: unknown, card: NamedCard): number {
  const g = toGameId(game);
  if (g === 'mtg') return isBasicLand(card.name) ? Infinity : MTG.copyLimit;
  if (g === 'riftbound') return card.card_type === 'Rune' ? Infinity : RIFTBOUND.copyLimit;
  if (g === 'lorcana') return LORCANA.copyLimit;
  if (g === 'starwars') return STARWARS.copyLimit;
  if (g === 'fab') return FAB.copyLimit;
  return ONEPIECE.copyLimit;
}

/** Is this card allowed in the given zone by card type alone? */
export function cardFitsZone(game: unknown, zone: string, card: NamedCard): boolean {
  const rule = zoneRule(game, zone);
  if (!rule) return false;
  if (!rule.types) return true;
  return rule.types.includes(card.card_type || '');
}

/** Split a stored colour/domain string ("Red/Green", "Fury, Calm") into lowercase parts. */
export function parseColors(value: string | null | undefined): string[] {
  return (value || '')
    .toLowerCase()
    .split(/[,/]/)
    .map(s => s.trim())
    .filter(Boolean);
}

export interface ZoneCount {
  key: ZoneKey;
  count: number;
  valid: boolean;
}

/** Per-zone validity of a deck's card counts (counts already include any single-card slots). */
export function validateZoneCount(game: unknown, zone: ZoneKey, count: number): boolean {
  const rule = zoneRule(game, zone);
  if (!rule) return count === 0;
  if (rule.min !== undefined) return count >= rule.min && count <= rule.max;
  if (rule.exact) return count === rule.max || (zone === 'sideboard' && count === 0);
  return count <= rule.max;
}
