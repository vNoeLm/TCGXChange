import { describe, expect, it } from 'vitest';
import { buildDeckBoard, deckCardEntries, deckValueHuf } from '../src/lib/deckBoard';
import type { CardValueData } from '../src/lib/cardValues';
import type { CatalogCard } from '../src/types';
import type { DeckState } from '../src/components/deck-builder/useDeckBuilder';

const card = (overrides: Partial<CatalogCard> & { id: string; name: string }): CatalogCard => ({
  card_number: 'OGN-001/298',
  rarity: 'Common',
  card_type: 'Unit',
  cost: 1,
  image_path: null,
  set_id: 'set-1',
  set_name: 'Origins',
  set_code: 'OGN',
  game: 'riftbound',
  ...overrides,
});

const emptyDeck = (overrides: Partial<DeckState> = {}): DeckState => ({
  legend: null,
  champion: null,
  extraLegends: [],
  mainDeck: {},
  runeDeck: {},
  battlefields: {},
  sideboard: {},
  ...overrides,
});

const values = (): CardValueData => ({ ready: true, eurHuf: 400, site: new Map() });

describe('deck board layout', () => {
  const legend = card({ id: 'legend', name: 'Seraphine', card_type: 'Legend', cost: 0 });
  const champion = card({ id: 'champion', name: 'Seraphine, Champion', card_type: 'Unit', subtype: 'Champion', cost: 3 });
  const rune = card({ id: 'rune', name: 'Mind Rune', card_type: 'Rune', cost: 0, domain: 'Mind' });
  const battlefield = card({ id: 'bf', name: 'Rockfall Path', card_type: 'Battlefield', cost: 0 });
  const cheapSpell = card({ id: 'spell-cheap', name: 'Stupefy', card_type: 'Spell', cost: 1 });
  const dearSpell = card({ id: 'spell-dear', name: 'Dredge Up', card_type: 'Spell', cost: 2 });
  const unit = card({ id: 'unit', name: 'Vanguard Captain', card_type: 'Unit', cost: 3 });
  const gear = card({ id: 'gear', name: 'Concert Poster', card_type: 'Gear', cost: 1 });
  const allCards = [legend, champion, rune, battlefield, cheapSpell, dearSpell, unit, gear];

  const deck = emptyDeck({
    legend: legend.id,
    champion: champion.id,
    mainDeck: { [cheapSpell.id]: 2, [dearSpell.id]: 1, [unit.id]: 1, [gear.id]: 1 },
    runeDeck: { [rune.id]: 6 },
    battlefields: { [battlefield.id]: 1 },
  });

  it('puts legend, champion, runes and battlefields in the command zone', () => {
    const board = buildDeckBoard(deck, allCards, 'riftbound');
    expect(board.command.map(section => section.key)).toEqual(['legend', 'champion', 'runeDeck', 'battlefields']);
    expect(board.command.find(section => section.key === 'runeDeck')?.count).toBe(6);
  });

  it('splits the main deck into card types, largest group first', () => {
    const board = buildDeckBoard(deck, allCards, 'riftbound');
    expect(board.main.map(section => section.label)).toEqual(['Spell', 'Unit', 'Gear']);
    expect(board.main.map(section => section.count)).toEqual([3, 1, 1]);
  });

  it('leads with whichever type has the most copies', () => {
    const unitHeavy = emptyDeck({ mainDeck: { [unit.id]: 5, [cheapSpell.id]: 1, [gear.id]: 1 } });
    const board = buildDeckBoard(unitHeavy, allCards, 'riftbound');
    expect(board.main.map(section => section.label)).toEqual(['Unit', 'Spell', 'Gear']);
    expect(board.main.map(section => section.count)).toEqual([5, 1, 1]);
  });

  it('keeps the canonical type order when groups are the same size', () => {
    const even = emptyDeck({ mainDeck: { [cheapSpell.id]: 1, [unit.id]: 1, [gear.id]: 1 } });
    const board = buildDeckBoard(even, allCards, 'riftbound');
    expect(board.main.map(section => section.label)).toEqual(['Spell', 'Unit', 'Gear']);
  });

  it('sorts each section by cost, then name', () => {
    const board = buildDeckBoard(deck, allCards, 'riftbound');
    const spells = board.main[0].cards.map(entry => entry.card.name);
    expect(spells).toEqual(['Stupefy', 'Dredge Up']);
  });

  it('counts the main board separately from the sideboard', () => {
    const withSideboard = emptyDeck({ ...deck, sideboard: { [unit.id]: 2 } });
    const board = buildDeckBoard(withSideboard, allCards, 'riftbound');
    expect(board.mainBoardCards).toBe(1 + 1 + 6 + 1 + 3 + 1 + 1);
    expect(board.sideboard).toHaveLength(1);
    expect(board.totalCards).toBe(board.mainBoardCards + 2);
  });

  it('ignores cards that are no longer in the catalog', () => {
    const stale = emptyDeck({ mainDeck: { 'missing-card': 3, [unit.id]: 1 } });
    const board = buildDeckBoard(stale, allCards, 'riftbound');
    expect(board.main).toHaveLength(1);
    expect(board.main[0].count).toBe(1);
  });

  it('keeps a main deck heading when the deck has no main deck cards yet', () => {
    const board = buildDeckBoard(emptyDeck(), allCards, 'riftbound');
    expect(board.main).toHaveLength(1);
    expect(board.main[0].label).toBe('Main Deck');
    expect(board.main[0].count).toBe(0);
  });
});

describe('deck value', () => {
  it('counts every copy, including the sideboard', () => {
    const a = card({ id: 'a', name: 'A', market_price_eur: 0.5 });
    const b = card({ id: 'b', name: 'B', market_price_eur: 0.25 });
    const deck = emptyDeck({ mainDeck: { a: 2 }, sideboard: { b: 1 } });

    const summary = deckValueHuf(deck, [a, b], values());
    // 0.5 EUR * 400 = 200 HUF each, 0.25 EUR * 400 = 100 HUF each.
    expect(summary.totalCards).toBe(3);
    expect(summary.totalHuf).toBe(200 * 2 + 100);
    expect(summary.unpricedCards).toBe(0);
  });

  it('reports copies it has no price for instead of counting them as free', () => {
    const priced = card({ id: 'a', name: 'A', market_price_eur: 0.5 });
    const priceless = card({ id: 'b', name: 'B', market_price_eur: null, market_price_foil_eur: null });
    const deck = emptyDeck({ mainDeck: { a: 1, b: 2 } });

    const summary = deckValueHuf(deck, [priced, priceless], values());
    expect(summary.totalHuf).toBe(200);
    expect(summary.totalCards).toBe(3);
    expect(summary.unpricedCards).toBe(2);
  });

  it('lists every card slot once, so single-card zones are not dropped', () => {
    const legend = card({ id: 'legend', name: 'Legend', card_type: 'Legend' });
    const champion = card({ id: 'champion', name: 'Champion', subtype: 'Champion' });
    const extra = card({ id: 'extra', name: 'Extra', card_type: 'Legend' });
    const deck = emptyDeck({
      legend: legend.id,
      champion: champion.id,
      extraLegends: [extra.id],
      mainDeck: { [legend.id]: 1 },
    });

    const entries = deckCardEntries(deck, [legend, champion, extra]);
    expect(entries.map(entry => entry.card.id)).toEqual(['legend', 'champion', 'extra', 'legend']);
    expect(entries.map(entry => entry.qty)).toEqual([1, 1, 1, 1]);
  });
});
