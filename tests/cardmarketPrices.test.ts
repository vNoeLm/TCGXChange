import { describe, expect, it } from 'vitest';
import { guideLowPrice, guidePrice, lowFromGuideRow, planCardmarketPrices, type CardmarketLink, type GuideRow } from '../src/lib/cardmarketPrices';
import type { PriceCard } from '../src/lib/priceImport';

const card = (id: string, name: string, card_number: string, rarity: string): PriceCard => ({
  id, name, card_number, rarity, game: 'riftbound', image_path: null, market_price_eur: null, market_price_foil_eur: null,
});

const CARDS = [
  card('c-common', 'Brazen Buccaneer', 'OGN-002/298', 'Common'),
  card('c-rare', 'Arise!', 'SFD-198/221', 'Rare'),
  card('c-showcase', 'Irelia, Fervent', 'SFD-225*/221', 'Showcase'),
  card('c-nolink', 'Some Promo', 'PRM-001', 'Rare'),
];

const LINKS: CardmarketLink[] = [
  { id: 'OGN-002', name: 'Brazen Buccaneer', cmid: 100 },
  { id: 'SFD-198', name: 'Arise!', cmid: 200 },
  { id: 'SFD-225-STAR', name: 'Irelia, Fervent', cmid: 300 },
  { id: 'PRM-001', name: 'Some Promo', cmid: null },
];

const GUIDE: GuideRow[] = [
  { idProduct: 100, trend: 0.05, avg7: 0.05, 'trend-foil': 0.16, 'avg7-foil': 0.19 },
  // A rare with no foil prices in the guide: its "normal" ones stand in.
  { idProduct: 200, trend: 20.1, avg7: 21.14, low: 17.5, 'trend-foil': 0 },
  // The overnumbered LeBlanc, Deceiver as the guide had it: the real sales are the foil ones.
  { idProduct: 300, trend: 43, avg7: 66.5, low: 79, 'trend-foil': 134.98, 'avg7-foil': 121.34, 'low-foil': 79 },
];

describe('which guide price is used', () => {
  it('the trend when there is one', () => {
    expect(guidePrice(GUIDE[1], false)).toBe(20.1);
  });

  it('falls back through the averages', () => {
    expect(guidePrice({ idProduct: 1, trend: 0, avg7: 0, avg30: 12.345 }, false)).toBe(12.35);
  });

  it('never the lowest offer (often another language or a worse copy): that is no price', () => {
    expect(guidePrice({ idProduct: 1, trend: 0, avg7: null, avg30: null, avg: null, low: 835 }, false)).toBeNull();
    expect(guidePrice(GUIDE[1], true)).toBeNull();
  });
});

describe('pricing our cards from the guide', () => {
  const plan = planCardmarketPrices(CARDS, LINKS, GUIDE);

  it('ties cards to guide rows through the Cardmarket product id', () => {
    expect(plan.linked).toBe(3);
    expect(plan.prices.get('c-common')).toEqual({ eur: 0.05, eurFoil: 0.16 });
  });

  it('a card printed only as a foil takes the foil prices, not the much lower "normal" ones', () => {
    expect(plan.prices.get('c-showcase')).toEqual({ eur: 134.98, eurFoil: 134.98 });
  });

  it('...and the normal prices only when the guide has no foil ones for it', () => {
    expect(plan.prices.get('c-rare')).toEqual({ eur: 20.1, eurFoil: 20.1 });
  });

  it('a card with no trend or average at all is left for the fallback source', () => {
    const lowOnly = planCardmarketPrices([CARDS[2]], LINKS, [{ idProduct: 300, trend: 0, low: 835, 'trend-foil': 0, 'low-foil': 835 }]);
    expect(lowOnly.prices.has('c-showcase')).toBe(false);
  });

  it('a card without a Cardmarket id is left for the fallback source', () => {
    expect(plan.prices.has('c-nolink')).toBe(false);
  });

  it('a promo/special edition card with metadata.cardmarket_id links directly even without a dotgg entry', () => {
    const promoCard: PriceCard = {
      id: 'kda-ahri',
      name: 'KDA Ahri, Nine-Tailed Fox',
      card_number: 'KDA-001',
      rarity: 'Promo',
      game: 'riftbound',
      image_path: null,
      metadata: { cardmarket_id: 920105 },
      market_price_eur: null,
      market_price_foil_eur: null,
    };
    const promoPlan = planCardmarketPrices(
      [promoCard],
      [],
      [{ idProduct: 920105, trend: 0, low: 44.5, 'trend-foil': 27.2 }]
    );
    expect(promoPlan.linked).toBe(1);
    expect(promoPlan.prices.get('kda-ahri')).toEqual({ eur: 27.2, eurFoil: 27.2 });
  });

  it('a name that does not match is not linked, even with the same number', () => {
    const wrong = planCardmarketPrices([card('x', 'Different Card', 'OGN-002/298', 'Common')], LINKS, GUIDE);
    expect(wrong.linked).toBe(0);
  });

  it('the usual checks still apply: a foil cheaper than the normal is dropped', () => {
    const odd = planCardmarketPrices([CARDS[0]], LINKS, [{ idProduct: 100, trend: 2, 'trend-foil': 1 }]);
    expect(odd.prices.get('c-common')).toEqual({ eur: 2, eurFoil: null });
    expect(odd.flagged[0].notes[0]).toContain('€1 dropped');
  });

  it('extracts guide low prices alongside trend prices, even when trend is missing on new promos', () => {
    expect(guideLowPrice({ idProduct: 500, low: 12.345, 'low-foil': 25 }, false)).toBe(12.35);
    expect(guideLowPrice({ idProduct: 500, low: 12.345, 'low-foil': 25 }, true)).toBe(25);
    expect(lowFromGuideRow('Promo', { idProduct: 500, low: 44.5, 'low-foil': 0 })).toEqual({
      lowEur: 44.5,
      lowFoilEur: 44.5,
    });
    expect(lowFromGuideRow('Common', { idProduct: 500, low: 0.1, 'low-foil': 0.5 })).toEqual({
      lowEur: 0.1,
      lowFoilEur: 0.5,
    });

    const lowOnlyPromo: PriceCard = {
      id: 'kda-ahri-low',
      name: 'KDA Ahri, Nine-Tailed Fox',
      card_number: 'KDA-001',
      rarity: 'Promo',
      game: 'riftbound',
      image_path: null,
      metadata: { cardmarket_id: 920105 },
      market_price_eur: null,
      market_price_foil_eur: null,
    };
    const lowPlan = planCardmarketPrices(
      [lowOnlyPromo, CARDS[2]],
      LINKS,
      [
        { idProduct: 920105, trend: 0, low: 44.5, 'trend-foil': 0 },
        { idProduct: 300, trend: 43, low: 79, 'trend-foil': 134.98, 'low-foil': 95.5 },
      ]
    );
    expect(lowPlan.prices.has('kda-ahri-low')).toBe(false);
    expect(lowPlan.lows.get('kda-ahri-low')).toEqual({ lowEur: 44.5, lowFoilEur: 44.5 });
    expect(lowPlan.lows.get('c-showcase')).toEqual({ lowEur: 95.5, lowFoilEur: 95.5 });
  });
});
