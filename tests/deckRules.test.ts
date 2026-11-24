import { describe, expect, it } from 'vitest';
import {
  getDeckRules,
  toGameId,
  gameStorageKey,
  maxCopies,
  cardCopyKey,
  isBasicLand,
  validateZoneCount,
  parseColors,
  hasZone,
  defaultZone,
} from '../src/lib/deckRules';
import {
  exportDeckToJson,
  exportDeckToText,
  parseDeckInput,
} from '../src/components/deck-builder/deckSerializer';
import type { DeckState } from '../src/components/deck-builder/useDeckBuilder';
import type { CatalogCard } from '../src/types';

describe('deckRules module', () => {
  it('toGameId validates and defaults unknown values to riftbound', () => {
    expect(toGameId('riftbound')).toBe('riftbound');
    expect(toGameId('onepiece')).toBe('onepiece');
    expect(toGameId('mtg')).toBe('mtg');
    expect(toGameId('pokemon')).toBe('riftbound');
    expect(toGameId(null)).toBe('riftbound');
    expect(toGameId(undefined)).toBe('riftbound');
  });

  it('gameStorageKey preserves riftbound storage keys while prefixing others', () => {
    expect(gameStorageKey('riftbound', 'deck')).toBe('riftbound_deck');
    expect(gameStorageKey('riftbound', 'saved_decks')).toBe('riftbound_saved_decks');
    expect(gameStorageKey('riftbound', 'loaded_deck_id')).toBe('riftbound_loaded_deck_id');
    expect(gameStorageKey('onepiece', 'deck')).toBe('onepiece_deck');
    expect(gameStorageKey('mtg', 'saved_decks')).toBe('mtg_saved_decks');
  });

  it('defines the correct zones and labels per game', () => {
    expect(hasZone('riftbound', 'legend')).toBe(true);
    expect(hasZone('riftbound', 'champion')).toBe(true);
    expect(hasZone('riftbound', 'runeDeck')).toBe(true);
    expect(hasZone('riftbound', 'battlefields')).toBe(true);
    expect(defaultZone('riftbound')).toBe('legend');

    expect(hasZone('onepiece', 'legend')).toBe(true);
    expect(hasZone('onepiece', 'champion')).toBe(false);
    expect(hasZone('onepiece', 'runeDeck')).toBe(false);
    expect(hasZone('onepiece', 'battlefields')).toBe(false);
    expect(hasZone('onepiece', 'sideboard')).toBe(false);
    expect(getDeckRules('onepiece').legendLabel).toBe('Leader');
    expect(defaultZone('onepiece')).toBe('legend');

    expect(hasZone('mtg', 'legend')).toBe(false);
    expect(hasZone('mtg', 'champion')).toBe(false);
    expect(hasZone('mtg', 'mainDeck')).toBe(true);
    expect(hasZone('mtg', 'sideboard')).toBe(true);
    expect(defaultZone('mtg')).toBe('mainDeck');
  });

  it('checks copy limits and basic land exemptions', () => {
    expect(maxCopies('riftbound', { name: 'Ahri', card_type: 'Unit' })).toBe(3);
    expect(maxCopies('riftbound', { name: 'Fury Rune', card_type: 'Rune' })).toBe(Infinity);

    expect(maxCopies('onepiece', { name: 'Monkey D. Luffy', card_type: 'Character' })).toBe(4);

    expect(maxCopies('mtg', { name: 'Lightning Bolt', card_type: 'Instant' })).toBe(4);
    expect(maxCopies('mtg', { name: 'Island', card_type: 'Land' })).toBe(Infinity);
    expect(maxCopies('mtg', { name: 'Snow-Covered Mountain', card_type: 'Land' })).toBe(Infinity);
    expect(maxCopies('mtg', { name: 'Wastes', card_type: 'Land' })).toBe(Infinity);
    expect(isBasicLand('Plains')).toBe(true);
    expect(isBasicLand('Forest')).toBe(true);
    expect(isBasicLand('Polluted Delta')).toBe(false);
  });

  it('validates zone card counts accurately', () => {
    expect(validateZoneCount('riftbound', 'mainDeck', 40)).toBe(true);
    expect(validateZoneCount('riftbound', 'mainDeck', 39)).toBe(false);
    expect(validateZoneCount('riftbound', 'sideboard', 10)).toBe(true);
    expect(validateZoneCount('riftbound', 'sideboard', 11)).toBe(false);
    expect(validateZoneCount('riftbound', 'sideboard', 0)).toBe(true);

    expect(validateZoneCount('onepiece', 'mainDeck', 50)).toBe(true);
    expect(validateZoneCount('onepiece', 'mainDeck', 49)).toBe(false);

    expect(validateZoneCount('mtg', 'mainDeck', 60)).toBe(true);
    expect(validateZoneCount('mtg', 'mainDeck', 100)).toBe(true);
    expect(validateZoneCount('mtg', 'mainDeck', 59)).toBe(false);
    expect(validateZoneCount('mtg', 'sideboard', 15)).toBe(true);
    expect(validateZoneCount('mtg', 'sideboard', 16)).toBe(false);
  });

  it('parses colors from domain strings', () => {
    expect(parseColors('Red/Green')).toEqual(['red', 'green']);
    expect(parseColors('Fury, Calm')).toEqual(['fury', 'calm']);
    expect(parseColors('Blue')).toEqual(['blue']);
    expect(parseColors(null)).toEqual([]);
  });

  it('distinguishes different domain/cost variants sharing a base name in Riftbound and One Piece', () => {
    const seraphineMind = { name: 'Seraphine', domain: 'Mind', cost: 3, card_type: 'Unit' };
    const seraphineMindAlt = { name: 'Seraphine', domain: 'Mind', cost: 3, card_type: 'Unit' };
    const seraphineOrder = { name: 'Seraphine', domain: 'Order', cost: 4, card_type: 'Unit' };

    expect(cardCopyKey('riftbound', seraphineMind)).toBe(cardCopyKey('riftbound', seraphineMindAlt));
    expect(cardCopyKey('riftbound', seraphineMind)).not.toBe(cardCopyKey('riftbound', seraphineOrder));

    const buggyBlue = { name: 'Buggy', domain: 'Blue', cost: 1, card_type: 'Character' };
    const buggyRed = { name: 'Buggy', domain: 'Red', cost: 3, card_type: 'Character' };
    expect(cardCopyKey('onepiece', buggyBlue)).not.toBe(cardCopyKey('onepiece', buggyRed));
  });
});

describe('Multi-game deck serialization', () => {
  const dummyCards: CatalogCard[] = [
    {
      id: 'op-luffy',
      name: 'Monkey D. Luffy',
      card_number: 'OP01-001',
      card_type: 'Leader',
      domain: 'Red',
      game: 'onepiece',
      rarity: 'Leader',
    } as any,
    {
      id: 'op-zoro',
      name: 'Roronoa Zoro',
      card_number: 'OP01-025',
      card_type: 'Character',
      domain: 'Red',
      game: 'onepiece',
      rarity: 'Super Rare',
    } as any,
    {
      id: 'mtg-bolt',
      name: 'Lightning Bolt',
      card_number: '123',
      card_type: 'Instant',
      game: 'mtg',
      rarity: 'Common',
    } as any,
  ];

  it('exports and round-trips a One Piece deck in JSON', () => {
    const opDeck: DeckState = {
      game: 'onepiece',
      legend: 'op-luffy',
      champion: null,
      extraLegends: [],
      mainDeck: { 'op-zoro': 4 },
      runeDeck: {},
      battlefields: {},
      sideboard: {},
    };

    const json = exportDeckToJson(opDeck, dummyCards, 'Straw Hats');
    const parsed = JSON.parse(json);
    expect(parsed.game).toBe('onepiece');
    expect(parsed.leader).toBe('Monkey D. Luffy');
    expect(parsed.mainDeck).toEqual({ 'Roronoa Zoro': 4 });

    const imported = parseDeckInput(json, dummyCards);
    expect(imported.type).toBe('single');
    if (imported.type === 'single') {
      expect(imported.deck.game).toBe('onepiece');
      expect(imported.deck.legend).toBe('op-luffy');
      expect(imported.deck.mainDeck['op-zoro']).toBe(4);
    }
  });

  it('exports and round-trips a One Piece deck in Text with Leader header', () => {
    const opDeck: DeckState = {
      game: 'onepiece',
      legend: 'op-luffy',
      champion: null,
      extraLegends: [],
      mainDeck: { 'op-zoro': 4 },
      runeDeck: {},
      battlefields: {},
      sideboard: {},
    };

    const text = exportDeckToText(opDeck, dummyCards, 'Straw Hats');
    expect(text).toContain('// Leader');
    expect(text).toContain('1 Monkey D. Luffy');
    expect(text).toContain('4 Roronoa Zoro');
    expect(text).not.toContain('// Champion');
    expect(text).not.toContain('// Rune Deck');

    const imported = parseDeckInput(text, dummyCards);
    expect(imported.type).toBe('single');
    if (imported.type === 'single') {
      expect(imported.deck.legend).toBe('op-luffy');
      expect(imported.deck.mainDeck['op-zoro']).toBe(4);
      expect(imported.deck.game).toBe('onepiece');
    }
  });

  it('detects alt arts correctly for both regular cards and rune cards', async () => {
    const { isAltArt } = await import('../src/lib/cardVariants');
    // Regular alt arts
    expect(isAltArt({ card_number: 'OGN-214a/298' })).toBe(true);
    expect(isAltArt({ card_number: 'OGN-042a/298' })).toBe(true);
    expect(isAltArt({ card_number: 'RAD-109A' })).toBe(true);
    expect(isAltArt({ card_number: 'OGN-193a-P' })).toBe(true);

    // Rune alt arts
    expect(isAltArt({ card_number: 'SFD-R04a' })).toBe(true);
    expect(isAltArt({ card_number: 'RAD-R01A' })).toBe(true);
    expect(isAltArt({ card_number: 'UNL-R05b' })).toBe(true);
    expect(isAltArt({ card_number: 'VEN-R01b-P' })).toBe(true);

    // Base cards should not be alt arts
    expect(isAltArt({ card_number: 'OGN-214/298' })).toBe(false);
    expect(isAltArt({ card_number: 'SFD-R04' })).toBe(false);
    expect(isAltArt({ card_number: 'RAD-R01' })).toBe(false);
    expect(isAltArt({ card_number: 'RAD-109' })).toBe(false);
  });

  it('determines foil variant availability per game', async () => {
    const { hasFoilVariant } = await import('../src/lib/cardVariants');
    // Riftbound: Common and Uncommon only
    expect(hasFoilVariant({ game: 'riftbound', rarity: 'Common' })).toBe(true);
    expect(hasFoilVariant({ game: 'riftbound', rarity: 'Uncommon' })).toBe(true);
    expect(hasFoilVariant({ game: 'riftbound', rarity: 'Rare' })).toBe(false);
    expect(hasFoilVariant({ game: 'riftbound', rarity: 'Epic' })).toBe(false);
    expect(hasFoilVariant({ rarity: 'Rare' })).toBe(false); // default riftbound

    // SWU and MTG: standard rarities have foils
    expect(hasFoilVariant({ game: 'starwars', rarity: 'Rare' })).toBe(true);
    expect(hasFoilVariant({ game: 'starwars', rarity: 'Legendary' })).toBe(true);
    expect(hasFoilVariant({ game: 'mtg', rarity: 'Mythic Rare' })).toBe(true);

    // Lorcana: Super Rare has foils, Enchanted is intrinsically foil
    expect(hasFoilVariant({ game: 'lorcana', rarity: 'Super Rare' })).toBe(true);
    expect(hasFoilVariant({ game: 'lorcana', rarity: 'Enchanted' })).toBe(false);

    // One Piece: Super Rare and Common are not separate toggles, Rare and Alt Art have foils
    expect(hasFoilVariant({ game: 'onepiece', rarity: 'Rare' })).toBe(true);
    expect(hasFoilVariant({ game: 'onepiece', rarity: 'Super Rare' })).toBe(false);
    expect(hasFoilVariant({ game: 'onepiece', rarity: 'Common' })).toBe(false);
    expect(hasFoilVariant({ game: 'onepiece', rarity: 'Super Rare', card_number: 'OP05-100a' })).toBe(true);

    // Tokens are not foil
    expect(hasFoilVariant({ game: 'starwars', rarity: 'Common', card_type: 'Token' })).toBe(false);
  });
});
