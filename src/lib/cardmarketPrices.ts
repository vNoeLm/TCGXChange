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
  fab: 16,
  onepiece: 18,
  lorcana: 19,
  starwars: 21,
  riftbound: 22,
};

/** Cardmarket public price guide URLs by game slug. */
export const PRICE_GUIDE_URLS_BY_GAME: Record<string, string> = {
  mtg: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json',
  pokemon: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json',
  fab: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_16.json',
  onepiece: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json',
  lorcana: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_19.json',
  starwars: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_21.json',
  riftbound: PRICE_GUIDE_URL,
};

/** Cardmarket public singles product catalog URLs by game slug (maps idProduct <-> name + idExpansion). */
export const PRODUCT_LIST_URLS_BY_GAME: Record<string, string> = {
  mtg: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_1.json',
  pokemon: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json',
  fab: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_16.json',
  onepiece: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json',
  lorcana: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_19.json',
  starwars: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_21.json',
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
  setId?: string | null;
  number?: string | null;
  displayName?: string | null;
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

export function lowFromGuideRow(
  rarity: string | null,
  row: GuideRow,
  game = 'riftbound'
): { lowEur: number | null; lowFoilEur: number | null } {
  if (game === 'riftbound') {
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
  const normalLow = guideLowPrice(row, false);
  const foilLow = guideLowPrice(row, true);
  return {
    lowEur: normalLow ?? foilLow,
    lowFoilEur: foilLow ?? normalLow,
  };
}

export function getCardmarketProductId(card: { metadata?: Record<string, any> | null } | null | undefined): number | null {
  const raw = card?.metadata?.cardmarket_id;
  if (raw === null || raw === undefined || raw === '') return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

export function priceFromGuideRow(rarity: string | null, row: GuideRow, game = 'riftbound') {
  if (game === 'riftbound') {
    // Rares, epics, promos and showcases are only printed as foils, but the guide still has "normal"
    // prices for them from copies listed without the foil box ticked. Use foil prices first when none
    // of the Common/Uncommon split applies.
    const single = !hasFoilVariant(rarity);
    const rawNormal = single ? guidePrice(row, true) ?? guidePrice(row, false) : guidePrice(row, false);
    const rawFoil = single ? rawNormal : guidePrice(row, true);
    return checkPrices(rarity, rawNormal, rawFoil, '€');
  }
  // Other TCGs (Lorcana, Star Wars, FaB, One Piece, MTG, Pokémon) can have both normal & foil trends on any rarity.
  const rawNormal = guidePrice(row, false);
  const rawFoil = guidePrice(row, true);
  if (rawNormal !== null) {
    const checked = checkPrices('Common', rawNormal, rawFoil, '€');
    return checked;
  }
  if (rawFoil !== null) {
    const checked = checkPrices('Promo', null, rawFoil, '€');
    return checked;
  }
  return { normal: null, foil: null, notes: [] as string[] };
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

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const foldNameKey = (s: string) =>
  stripAccents(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]/g, '');

const foldFullProductKey = (s: string) =>
  stripAccents(s)
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/\s*\(\s*v\.?\s*\d+\s*\)/gi, '')
    .replace(/\s*\(\s*(cold foil|rainbow foil|extended art|full art|marvel|showcase|hyperspace|enchanted|alt[- ]?art|promo)\s*\)/gi, '')
    .replace(/[^a-z0-9()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normSetToken = (raw: string | null | undefined, game: string): string => {
  let s = String(raw || '').trim().toUpperCase();
  if (game === 'lorcana') s = s.replace(/^LOR-/, '');
  else if (game === 'starwars') s = s.replace(/^SWU-/, '');
  else if (game === 'fab') s = s.replace(/^FAB-/, '');
  return s.replace(/^0+/, '') || s;
};

const normNumToken = (raw: string | null | undefined): string => {
  const s = String(raw || '').trim().toUpperCase().split('/')[0];
  return s.replace(/^0+(?=\d)/, '');
};

function candidateSetNumKeys(card: PriceCard): string[] {
  const game = card.game;
  const setTok = normSetToken(card.set_code, game);
  const rawNum = String(card.card_number || '').trim().toUpperCase();
  const keys: string[] = [];

  if (game === 'lorcana' && rawNum.includes('-')) {
    const [nPart, suffixSet] = rawNum.split('-', 2);
    if (suffixSet) keys.push(`${normSetToken(suffixSet, game)}:${normNumToken(nPart)}`);
  }
  if (setTok) {
    keys.push(`${setTok}:${normNumToken(rawNum.split('-')[0])}`);
    if (game === 'starwars' && setTok.endsWith('P')) {
      keys.push(`${setTok.slice(0, -1)}W:${normNumToken(rawNum)}`);
    }
  }
  return keys.filter(Boolean);
}

const isSpecialVariantProductName = (name: string) =>
  /\((oversized|v\.?\s*[2-9]|marvel|cold foil|rainbow foil|extended art|full art|showcase|enchanted|hyperspace|serialized|gold foil)\)/i.test(name);

function pickBestCatalogProduct(
  candidates: CardmarketCatalogProduct[],
  byProduct: Map<number, GuideRow>,
  preferredExpIds: Set<number> | undefined,
  cardRarity: string | null,
  game: string
): CardmarketCatalogProduct | null {
  const priced = candidates.filter((p) => {
    const row = byProduct.get(p.idProduct);
    return row && (guidePrice(row, false) !== null || guidePrice(row, true) !== null || guideLowPrice(row, false) !== null || guideLowPrice(row, true) !== null);
  });
  if (priced.length === 0) return null;

  const isCardChase = /(marvel|fabled|enchanted|showcase)/i.test(String(cardRarity || ''));
  const expFiltered = preferredExpIds?.size ? priced.filter((p) => p.idExpansion && preferredExpIds.has(p.idExpansion)) : [];
  const pool = expFiltered.length > 0 ? expFiltered : priced;
  const standardPool = isCardChase ? pool : pool.filter((p) => !isSpecialVariantProductName(p.name));
  const finalPool = standardPool.length > 0 ? standardPool : pool;

  // Prefer rows that have a real trend/avg price over low-only rows, then lower standard trend to avoid Alpha/Marvel outliers.
  finalPool.sort((a, b) => {
    const ra = byProduct.get(a.idProduct)!;
    const rb = byProduct.get(b.idProduct)!;
    const pa = guidePrice(ra, false) ?? guidePrice(ra, true);
    const pb = guidePrice(rb, false) ?? guidePrice(rb, true);
    if (pa !== null && pb === null) return -1;
    if (pb !== null && pa === null) return 1;
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    const la = guideLowPrice(ra, false) ?? guideLowPrice(ra, true) ?? 999999;
    const lb = guideLowPrice(rb, false) ?? guideLowPrice(rb, true) ?? 999999;
    return la - lb;
  });

  // For Riftbound/Pokemon we only return priced entries with guidePrice or guideLowPrice so plan() can populate price & low.
  void game;
  return finalPool[0] || null;
}

export function planCardmarketPrices(
  cards: PriceCard[],
  links: CardmarketLink[],
  guide: GuideRow[],
  targetGame = 'riftbound',
  catalogProducts: CardmarketCatalogProduct[] = []
): CardmarketPlan {
  const byKey = new Map<string, CardmarketLink>();
  const bySetNum = new Map<string, CardmarketLink>();
  const byFoldName = new Map<string, CardmarketLink>();

  for (const link of links) {
    const key = norm(link.id);
    const existing = byKey.get(key);
    // Oversized battlefields share their id with the regular card; the regular one is the one we hold.
    if (!existing || (/oversized/i.test(existing.name) && !/oversized/i.test(link.name))) byKey.set(key, link);

    if (link.cmid && link.setId && link.number) {
      const snKey = `${normSetToken(link.setId, targetGame)}:${normNumToken(link.number)}`;
      const cur = bySetNum.get(snKey);
      if (!cur || (/oversized/i.test(cur.name) && !/oversized/i.test(link.name))) {
        bySetNum.set(snKey, link);
      }
    }
    if (link.cmid) {
      const dn = foldNameKey(link.displayName || link.name);
      if (dn && !byFoldName.has(dn)) byFoldName.set(dn, link);
    }
  }
  const byProduct = new Map(guide.map((row) => [row.idProduct, row]));

  // Optional index over Cardmarket's products_singles catalog for games/sets missing dotgg cmids (e.g. FaB, promos).
  const catalogByExactName = new Map<string, CardmarketCatalogProduct[]>();
  const catalogByBareName = new Map<string, CardmarketCatalogProduct[]>();
  const catalogHasColoredVariant = new Set<string>();
  const singleSetVotes = new Map<string, string>(); // foldNameKey -> card.set_id (unique names)
  const nameCardCount = new Map<string, number>();

  for (const c of cards) {
    if (targetGame !== 'all' && c.game !== targetGame) continue;
    const fk = foldNameKey(c.name);
    if (!fk) continue;
    nameCardCount.set(fk, (nameCardCount.get(fk) || 0) + 1);
    if (c.set_id && nameCardCount.get(fk) === 1) singleSetVotes.set(fk, c.set_id);
    else singleSetVotes.delete(fk);
  }

  const setToExpVotes = new Map<string, Map<number, number>>();
  for (const prod of catalogProducts) {
    if (!byProduct.has(prod.idProduct)) continue;
    const fullK = foldFullProductKey(prod.name);
    if (fullK) {
      const list = catalogByExactName.get(fullK) || [];
      list.push(prod);
      catalogByExactName.set(fullK, list);
    }
    const bareK = foldNameKey(prod.name);
    if (bareK) {
      const list = catalogByBareName.get(bareK) || [];
      list.push(prod);
      catalogByBareName.set(bareK, list);
      if (/\((red|yellow|blue)\)/i.test(prod.name)) {
        catalogHasColoredVariant.add(bareK);
      }
      const votedSetId = singleSetVotes.get(bareK);
      if (votedSetId && prod.idExpansion) {
        let expCounts = setToExpVotes.get(votedSetId);
        if (!expCounts) {
          expCounts = new Map();
          setToExpVotes.set(votedSetId, expCounts);
        }
        expCounts.set(prod.idExpansion, (expCounts.get(prod.idExpansion) || 0) + 1);
      }
    }
  }

  const preferredExpBySetId = new Map<string, Set<number>>();
  for (const [setId, expCounts] of setToExpVotes) {
    const ranked = [...expCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length > 0) {
      const topCount = ranked[0][1];
      preferredExpBySetId.set(
        setId,
        new Set(ranked.filter(([, cnt]) => cnt >= Math.max(2, topCount * 0.5)).map(([exp]) => exp))
      );
    }
  }

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
      if (link?.cmid && sameCard(card.name, link.displayName || link.name)) {
        cmid = link.cmid;
      }
    }

    if (!cmid) {
      for (const snKey of candidateSetNumKeys(card)) {
        const link = bySetNum.get(snKey);
        if (link?.cmid && (sameCard(card.name, link.displayName || link.name) || foldNameKey(card.name) === foldNameKey(link.displayName || link.name))) {
          cmid = link.cmid;
          break;
        }
      }
    }

    if (!cmid) {
      const fk = foldNameKey(card.name);
      const link = fk ? byFoldName.get(fk) : undefined;
      if (link?.cmid) cmid = link.cmid;
    }

    if (!cmid && catalogProducts.length > 0) {
      const prefExps = card.set_id ? preferredExpBySetId.get(card.set_id) : undefined;
      const fullK = foldFullProductKey(card.name);
      let candidates = catalogByExactName.get(fullK) || [];
      if (candidates.length === 0 && card.game === 'fab' && /\(red\)$/i.test(card.name)) {
        const noRedK = foldFullProductKey(card.name.replace(/\s*\(red\)$/i, ''));
        candidates = catalogByExactName.get(noRedK) || [];
      }
      if (candidates.length === 0) {
        const bareK = foldNameKey(card.name);
        const allowBareForFab = card.game !== 'fab' || !/\((red|yellow|blue)\)/i.test(card.name) || !catalogHasColoredVariant.has(bareK);
        if (allowBareForFab) {
          candidates = catalogByBareName.get(bareK) || [];
        }
      }
      const picked = pickBestCatalogProduct(candidates, byProduct, prefExps, card.rarity, card.game);
      if (picked) cmid = picked.idProduct;
    }

    if (!cmid) continue;
    const row = byProduct.get(cmid);
    if (!row) continue;
    linked += 1;
    const { normal, foil, notes } = priceFromGuideRow(card.rarity, row, card.game);
    const { lowEur, lowFoilEur } = lowFromGuideRow(card.rarity, row, card.game);
    if (notes.length) flagged.push({ card, notes });
    if (normal !== null || foil !== null) prices.set(card.id, { eur: normal, eurFoil: foil });
    if (lowEur !== null || lowFoilEur !== null) lows.set(card.id, { lowEur, lowFoilEur });
  }
  return { prices, lows, linked, flagged };
}
