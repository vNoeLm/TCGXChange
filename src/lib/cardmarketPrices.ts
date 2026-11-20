import { cardKey, checkPrices, hasFoilVariant, norm, sameCard, type PriceCard } from './priceImport.ts';

/**
 * Card prices from Cardmarket's public price guide, in euros: the European market, which is the
 * one buyers here actually use (the older source was US TCGplayer prices converted from dollars).
 *
 * The guide is a daily file of Cardmarket product ids and prices, with no card names in it. Either
 * a card's manual `metadata.cardmarket_id` (for promos / special editions) or the dotgg card API
 * ties a card to its Cardmarket product id.
 */

/** Riftbound's game id at Cardmarket is 22. Public, no login; refreshed every night. */
export const PRICE_GUIDE_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_22.json';

/** Cardmarket numeric game ids by our game slug. */
export const CARDMARKET_GAME_IDS: Record<string, number> = {
  mtg: 1,
  pokemon: 6,
  onepiece: 18,
  lorcana: 19,
  starwars: 20,
  riftbound: 22,
};

/** Cardmarket public price guide URLs by game slug. */
export const PRICE_GUIDE_URLS_BY_GAME: Record<string, string> = {
  mtg: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json',
  pokemon: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json',
  onepiece: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json',
  lorcana: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_19.json',
  starwars: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_20.json',
  riftbound: PRICE_GUIDE_URL,
};

/** Cardmarket public singles product catalog URLs by game slug (maps idProduct <-> name + idExpansion). */
export const PRODUCT_LIST_URLS_BY_GAME: Record<string, string> = {
  mtg: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_1.json',
  pokemon: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json',
  onepiece: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json',
  lorcana: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_19.json',
  starwars: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_20.json',
  riftbound: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_22.json',
};

/** One row of the guide (prices in euros; missing ones are null or 0). */
export interface GuideRow {
  idProduct: number;
  idCategory?: number;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  'avg-foil'?: number | null;
  'low-foil'?: number | null;
  'trend-foil'?: number | null;
  'avg7-foil'?: number | null;
  'avg30-foil'?: number | null;
}

/** One row of Cardmarket's public products_singles_{id}.json catalog. */
export interface CardmarketCatalogProduct {
  idProduct: number;
  name: string;
  idCategory?: number;
  categoryName?: string;
  idExpansion?: number;
  idMetacard?: number;
  dateAdded?: string;
}

/** A card in the dotgg API: its id ("OGN-042"), name, and Cardmarket product id if it has one. */
export interface CardmarketLink {
  id: string;
  name: string;
  cmid: number | null;
}

/**
 * The price to use from a guide row: the trend, which follows recent sales, and when a card sells
 * too rarely to have one (the trend is 0 on many showcase and signed cards), the 7-day average, the
 * 30-day average, then the all-time average. Never the lowest current offer: that is often a copy
 * in another language or a worse condition, far below what the card goes for. A card with none of
 * these keeps the fallback price instead.
 */
export function guidePrice(row: GuideRow, foil: boolean): number | null {
  const fields = foil
    ? (['trend-foil', 'avg7-foil', 'avg30-foil', 'avg-foil'] as const)
    : (['trend', 'avg7', 'avg30', 'avg'] as const);
  for (const field of fields) {
    const value = Number(row[field]);
    if (Number.isFinite(value) && value > 0) return Math.round(value * 100) / 100;
  }
  return null;
}

export function guideLowPrice(row: GuideRow, foil: boolean): number | null {
  const fields = foil
    ? (['low-foil', 'low'] as const)
    : (['low'] as const);
  for (const field of fields) {
    const value = Number(row[field]);
    if (Number.isFinite(value) && value > 0) return Math.round(value * 100) / 100;
  }
  return null;
}

export function lowFromGuideRow(rarity: string | null, row: GuideRow): { lowEur: number | null; lowFoilEur: number | null } {
  const single = !hasFoilVariant(rarity);
  if (single) {
    const onlyLow = guideLowPrice(row, true) ?? guideLowPrice(row, false);
    return { lowEur: onlyLow, lowFoilEur: onlyLow };
  }
  return {
    lowEur: guideLowPrice(row, false),
    lowFoilEur: guideLowPrice(row, true) ?? guideLowPrice(row, false),
  };
}

export function getCardmarketProductId(card: { metadata?: Record<string, any> | null } | null | undefined): number | null {
  const raw = card?.metadata?.cardmarket_id;
  if (raw === null || raw === undefined || raw === '') return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

export function priceFromGuideRow(rarity: string | null, row: GuideRow) {
  // Rares, epics, promos and showcases are only printed as foils, but the guide still has "normal"
  // prices for them from copies listed without the foil box ticked. Use foil prices first when none
  // of the Common/Uncommon split applies.
  const single = !hasFoilVariant(rarity);
  const rawNormal = single ? guidePrice(row, true) ?? guidePrice(row, false) : guidePrice(row, false);
  const rawFoil = single ? rawNormal : guidePrice(row, true);
  return checkPrices(rarity, rawNormal, rawFoil, '€');
}

export interface CardmarketPlan {
  /** Euro prices by card id, for every card the guide could price. */
  prices: Map<string, { eur: number | null; eurFoil: number | null }>;
  /** Cardmarket lowest offer prices (EUR) by card id. */
  lows: Map<string, { lowEur: number | null; lowFoilEur: number | null }>;
  /** Cards tied to a guide row. */
  linked: number;
  /** Prices dropped by the usual checks (a foil cheaper than the normal, and so on). */
  flagged: { card: PriceCard; notes: string[] }[];
}

export function planCardmarketPrices(
  cards: PriceCard[],
  links: CardmarketLink[],
  guide: GuideRow[],
  targetGame = 'riftbound'
): CardmarketPlan {
  const byKey = new Map<string, CardmarketLink>();
  for (const link of links) {
    const key = norm(link.id);
    const existing = byKey.get(key);
    // Oversized battlefields share their id with the regular card; the regular one is the one we hold.
    if (!existing || (/oversized/i.test(existing.name) && !/oversized/i.test(link.name))) byKey.set(key, link);
  }
  const byProduct = new Map(guide.map((row) => [row.idProduct, row]));

  const prices: CardmarketPlan['prices'] = new Map();
  const lows: CardmarketPlan['lows'] = new Map();
  const flagged: CardmarketPlan['flagged'] = [];
  let linked = 0;
  for (const card of cards) {
    if (targetGame !== 'all' && card.game !== targetGame) continue;

    // 1. Explicit manual cardmarket_id in card metadata (promos / special collections) takes precedence.
    const manualCmid = getCardmarketProductId(card);
    let cmid: number | null = manualCmid;

    if (!cmid) {
      const link = byKey.get(cardKey(card));
      if (!link || !link.cmid || !sameCard(card.name, link.name)) continue;
      cmid = link.cmid;
    }

    const row = byProduct.get(cmid);
    if (!row) continue;
    linked += 1;
    const { normal, foil, notes } = priceFromGuideRow(card.rarity, row);
    const { lowEur, lowFoilEur } = lowFromGuideRow(card.rarity, row);
    if (notes.length) flagged.push({ card, notes });
    if (normal !== null || foil !== null) prices.set(card.id, { eur: normal, eurFoil: foil });
    if (lowEur !== null || lowFoilEur !== null) lows.set(card.id, { lowEur, lowFoilEur });
  }
  return { prices, lows, linked, flagged };
}
