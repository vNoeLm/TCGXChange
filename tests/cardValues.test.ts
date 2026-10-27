import { describe, expect, it } from 'vitest';
import { marketEurOf, valueOfCard, type CardValueData } from '../src/lib/cardValues';

const RATE = 400;

const values = (site: Record<string, number[]> = {}): CardValueData => ({
  ready: true,
  eurHuf: RATE,
  site: new Map(Object.entries(site)),
});

// A Riftbound Radiance rare: the price source only fills the foil column, because the card is
// printed foil only.
const radianceRare = {
  id: 'rad-015',
  rarity: 'Rare',
  game: 'riftbound',
  market_price_eur: null,
  market_price_foil_eur: 0.18,
};

// A Lorcana Enchanted: one print, but the source stores a normal and a foil figure, and the normal
// one is the one the app has always shown.
const enchanted = {
  id: 'lor-212',
  rarity: 'Enchanted',
  game: 'lorcana',
  market_price_eur: 337.81,
  market_price_foil_eur: 64.21,
};

// A Riftbound common: a normal and a foil print, priced apart.
const common = {
  id: 'ogn-002',
  rarity: 'Common',
  game: 'riftbound',
  market_price_eur: 0.05,
  market_price_foil_eur: 0.16,
};

describe('the market reference of a finish', () => {
  it('uses the foil price of a card that is printed foil only, for either finish', () => {
    expect(marketEurOf(radianceRare, false)).toBe(0.18);
    expect(marketEurOf(radianceRare, true)).toBe(0.18);
  });

  it('keeps the normal figure of a single-print card that has both, so its value does not move', () => {
    expect(marketEurOf(enchanted, false)).toBe(337.81);
    expect(marketEurOf(enchanted, true)).toBe(337.81);
  });

  it('keeps the two finishes of a card printed in both apart', () => {
    expect(marketEurOf(common, false)).toBe(0.05);
    expect(marketEurOf(common, true)).toBe(0.16);
    // A normal Common without its own price does not borrow the foil one: the catalog marks it as foil instead.
    expect(marketEurOf({ ...common, market_price_eur: null }, false)).toBeNull();
  });
});

describe('the estimated value of a card', () => {
  it('prices a foil-only Rare instead of leaving it blank', () => {
    const estimate = valueOfCard(radianceRare, false, values());
    expect(estimate.referenceHuf).toBe(72);
    expect(estimate.valueHuf).toBe(70);
    expect(estimate.basis).toBe('market');
  });

  it('shows the same figure whichever finish the catalog asks for', () => {
    expect(valueOfCard(radianceRare, true, values()).valueHuf).toBe(valueOfCard(radianceRare, false, values()).valueHuf);
  });

  it('still prices each finish of a card printed in both', () => {
    expect(valueOfCard(common, false, values()).valueHuf).toBe(20);
    expect(valueOfCard(common, true, values()).valueHuf).toBe(65);
    expect(valueOfCard(common, false, values()).valueHuf).not.toBe(valueOfCard(common, true, values()).valueHuf);
  });

  it('counts a listing of either finish for a single-print card', () => {
    const unpriced = { ...radianceRare, market_price_foil_eur: null };
    const estimate = valueOfCard(unpriced, false, values({ 'rad-015|foil': [5000, 7000] }));
    expect(estimate.site?.count).toBe(2);
    expect(estimate.valueHuf).toBe(6000);
  });
});
