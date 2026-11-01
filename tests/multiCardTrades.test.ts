import { describe, it, expect } from 'vitest';
import {
  normalizeTradeItems,
  getTradeOfferedItems,
  getTradeWantedItems,
  getTradeSideTotalQuantity,
  summarizeTradeSide,
} from '../src/lib/tradeItems';
import type { CatalogCard, MarketplaceTrade } from '../src/types';

const makeCard = (id: string, name: string): CatalogCard => ({
  id,
  card_number: '001',
  name,
  rarity: 'Rare',
  card_type: 'Unit',
  cost: 3,
  image_path: `/cards/${id}.webp`,
  set_id: 'set-1',
  set_name: 'Origins',
  set_code: 'OGN',
  game: 'riftbound',
});

describe('multi-card trade helpers', () => {
  it('normalizes raw trade item arrays and filters invalid entries', () => {
    const items = normalizeTradeItems(
      [
        { card_id: 'c1', condition: 'Lightly Played', is_foil: true, quantity: 3 },
        { card_id: '', condition: 'Near Mint', quantity: 1 },
        null,
        { card_id: 'c2', quantity: 0 },
      ],
      false
    );

    expect(items).toEqual([
      { card_id: 'c1', condition: 'Lightly Played', is_foil: true, quantity: 3 },
      { card_id: 'c2', condition: 'Near Mint', is_foil: false, quantity: 1 },
    ]);
  });

  it('falls back to legacy single-card fields when offered_items / wanted_items are absent', () => {
    const legacyTrade: Partial<MarketplaceTrade> = {
      offered_card_id: 'c-ahri',
      offered_card: makeCard('c-ahri', 'Ahri'),
      offered_condition: 'Near Mint',
      offered_is_foil: true,
      offered_quantity: 2,
      wanted_card_id: 'c-yasuo',
      wanted_card: makeCard('c-yasuo', 'Yasuo'),
      wanted_min_condition: 'Lightly Played',
      wanted_is_foil: null,
      wanted_quantity: 1,
    };

    const offered = getTradeOfferedItems(legacyTrade);
    const wanted = getTradeWantedItems(legacyTrade);

    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({
      card_id: 'c-ahri',
      condition: 'Near Mint',
      is_foil: true,
      quantity: 2,
    });
    expect(wanted).toHaveLength(1);
    expect(wanted[0]).toMatchObject({
      card_id: 'c-yasuo',
      condition: 'Lightly Played',
      is_foil: null,
      quantity: 1,
    });
  });

  it('computes total quantities and localized summaries for single and multi-card sides', () => {
    const multiItems = [
      { card_id: 'c1', card: makeCard('c1', 'Ahri'), condition: 'Near Mint', is_foil: false, quantity: 2 },
      { card_id: 'c2', card: makeCard('c2', 'Jinx'), condition: 'Near Mint', is_foil: true, quantity: 1 },
      { card_id: 'c3', card: makeCard('c3', 'Vi'), condition: 'Lightly Played', is_foil: false, quantity: 1 },
    ];

    expect(getTradeSideTotalQuantity(multiItems)).toBe(4);
    expect(summarizeTradeSide(multiItems, 'en')).toBe('2x Ahri +2 more');
    expect(summarizeTradeSide(multiItems, 'hu')).toBe('2x Ahri +2 további');
    expect(summarizeTradeSide([multiItems[1]], 'en')).toBe('Jinx');
  });
});
