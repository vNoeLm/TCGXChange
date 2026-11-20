/**
 * Turning a prices CSV into market reference prices for our cards.
 *
 * The CSV has one row per card: Card ID, Detailed Name, Set, Rarity, Normal Price, Foil Price, with
 * prices in US dollars. This file only decides what should be written (nothing here touches the
 * database), so the upload page can show exactly what a file would do before anything changes.
 *
 * How rows are read (all of this comes from looking at real files):
 *  - Card IDs are matched ignoring case, spaces and the "/total" on our card numbers, and our "*"
 *    alt-arts are the CSV's "-STAR". The six basic runes are stored under numbers like "R04" but
 *    print as e.g. OGN-126, so they are matched through their image filename.
 *  - Only Common and Uncommon come in normal and foil. Rare, Epic and Showcase are one entry in the
 *    catalog, so their single price is used for both columns.
 *  - Values that cannot be real are dropped and reported: a foil under a cent, or a foil cheaper
 *    than the normal. Above a $0.50 normal price a foil more than 40x the normal is also dropped;
 *    below it (the basic runes: a cent or two normal, $10-15 foil) that ratio is meaningless, so
 *    instead a foil over $50 is dropped.
 *  - Where a card has an "(Oversized)" twin under the same ID, the regular one is used.
 *  - A row is only used when its name agrees with ours, since a disagreement means the IDs paired
 *    the wrong cards and one card would get another's price.
 */

export const EXPECTED_HEADER = ['Card ID', 'Detailed Name', 'Set', 'Rarity', 'Normal Price', 'Foil Price'];

const MAX_FOIL_TO_NORMAL = 40;
const MAX_PRICE_USD = 10000;
const MIN_PRICE_USD = 0.01;
// A basic rune's normal print is worth almost nothing (a cent or two) while its foil genuinely
// trades for $10-15, a few hundred times as much - a ratio cap alone would drop every one of
// those as "unreliable". Below this normal price the ratio is meaningless, so the foil is instead
// checked against a flat ceiling: still enough to catch a real typo (one file had a rune foil at
// $8,888), but not so low that it drops the legitimate $10-15 foils.
const CHEAP_NORMAL_USD = 0.5;
const MAX_FOIL_WHEN_NORMAL_IS_CHEAP_USD = 50;

export interface PriceCard {
  id: string;
  game: string;
  name: string;
  card_number: string;
  rarity: string | null;
  image_path: string | null;
  metadata?: Record<string, any> | null;
  market_price_eur: number | null;
  market_price_foil_eur: number | null;
}

export interface CsvRow {
  id: string;
  name: string;
  set: string;
  rarity: string;
  normal: number | null;
  foil: number | null;
}

export interface PriceUpdate {
  card: PriceCard;
  /** Normal price in euros, or null when the file has none. */
  eur: number | null;
  eurFoil: number | null;
  /** The same prices at the exchange rate of the previous upload, which is what is compared with the stored ones. */
  compareEur: number | null;
  compareEurFoil: number | null;
}

export interface PricePlan {
  csvRows: number;
  distinctIds: number;
  ourCards: number;
  /** Cards with a usable price in the file: these are the ones that would be written. */
  updates: PriceUpdate[];
  /**
   * Of `updates`, those whose price really moved, or that had none. A price is compared as it would
   * have been at the previous upload's exchange rate: otherwise a file that has not changed would
   * still show a change on nearly every card, just from the euro rate drifting since.
   */
  changes: PriceUpdate[];
  newlyPriced: number;
  unchanged: number;
  unmatched: PriceCard[];
  csvLeftover: CsvRow[];
  nameMismatches: { card: PriceCard; row: CsvRow }[];
  flagged: { card: PriceCard; notes: string[] }[];
}

// ---- CSV -------------------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const usd = (s: string | undefined): number | null => {
  const n = s ? parseFloat(String(s).replace('$', '')) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The rows of a prices file, or a message saying what is wrong with it. */
export function readPriceCsv(text: string): { rows: CsvRow[] } | { error: string } {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ''));
  if (!header) return { error: 'The file is empty.' };
  if (EXPECTED_HEADER.some((h, i) => header[i]?.trim() !== h)) {
    return { error: `The columns are not what was expected. Found: ${header.join(' | ')}. Expected: ${EXPECTED_HEADER.join(' | ')}.` };
  }
  const rows = body
    .filter((r) => r[0]?.trim())
    .map((r) => ({
      id: r[0].trim(),
      name: (r[1] || '').replace(r[0], '').trim(),
      set: r[2] || '',
      rarity: r[3] || '',
      normal: usd(r[4]),
      foil: usd(r[5]),
    }));
  if (rows.length === 0) return { error: 'The file has a header but no cards.' };
  return { rows };
}

// ---- matching --------------------------------------------------------------------------------
export const norm = (id: string) => id.toUpperCase().replace(/\s+/g, '').replace(/\/\d+/, '').replace(/\*/g, '-STAR');

/** "riftbound/ogn-126-298.webp" -> "OGN-126", for cards whose stored number has no set prefix. */
function keyFromImage(imagePath: string | null): string | null {
  const file = (imagePath || '').split('/').pop()?.replace(/\.[a-z0-9]+$/i, '');
  const m = file && file.toUpperCase().match(/^([A-Z]{2,4})-(\d+[A-Z]?)-\d+$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export const cardKey = (card: PriceCard): string => {
  if (/^[A-Z]{2,4}\s*-/i.test(card.card_number)) return norm(card.card_number);
  return keyFromImage(card.image_path) || norm(card.card_number);
};

/** Compared with punctuation, case and any "(promo)" note removed, so "Akali, Silent" and "Akali - Silent" agree. */
const nameKey = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
export const sameCard = (a: string, b: string) => {
  const x = nameKey(a);
  const y = nameKey(b);
  return x === y || (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x)));
};

// ---- prices ----------------------------------------------------------------------------------
/** Commons and uncommons come in a normal and a foil print; every other rarity in one print only. */
export const hasFoilVariant = (rarity: string | null) => rarity === 'Common' || rarity === 'Uncommon';
const usable = (p: number | null): p is number => p !== null && p > MIN_PRICE_USD && p <= MAX_PRICE_USD;

/**
 * The prices to store for one card from a source's normal and foil price, and anything dropped
 * along the way. Used for the dollar prices here and for Cardmarket's euro prices
 * (lib/cardmarketPrices.ts); the limits are close enough for either currency. `unit` only labels
 * the notes.
 */
export function checkPrices(rarity: string | null, rawNormal: number | null, rawFoil: number | null, unit = '$') {
  const notes: string[] = [];
  const normal = usable(rawNormal) ? rawNormal : null;
  let foil = usable(rawFoil) ? rawFoil : null;
  if (rawNormal !== null && normal === null) notes.push(`normal ${unit}${rawNormal} dropped (not a usable price)`);
  if (rawFoil !== null && foil === null) notes.push(`foil ${unit}${rawFoil} dropped (not a usable price)`);

  if (hasFoilVariant(rarity)) {
    if (foil !== null && normal !== null && foil < normal) {
      notes.push(`foil ${unit}${foil} dropped (cheaper than the normal, ${unit}${normal})`);
      foil = null;
    }
    if (foil !== null && normal !== null && normal < CHEAP_NORMAL_USD) {
      if (foil > MAX_FOIL_WHEN_NORMAL_IS_CHEAP_USD) {
        notes.push(`foil ${unit}${foil} dropped (over ${unit}${MAX_FOIL_WHEN_NORMAL_IS_CHEAP_USD} for a card whose normal is only ${unit}${normal})`);
        foil = null;
      }
    } else if (foil !== null && normal !== null && foil / normal > MAX_FOIL_TO_NORMAL) {
      notes.push(`foil ${unit}${foil} dropped (${Math.round(foil / normal)}x the normal, ${unit}${normal})`);
      foil = null;
    }
    return { normal, foil, notes };
  }

  // One entry in the catalog: use whichever price exists, preferring the normal one.
  const only = normal ?? foil;
  return { normal: only, foil: only, notes };
}

/** The dollar prices to store for one card, and anything dropped along the way. */
function pricesFor(card: PriceCard, row: CsvRow) {
  return checkPrices(card.rarity, row.normal, row.foil);
}

const cents = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(Number(n) * 100));

/** What loading these rows would do to these cards. Only Riftbound cards are matched. */
export function planPriceImport(
  rows: CsvRow[],
  allCards: PriceCard[],
  usdEur: number,
  /** The dollar-to-euro rate used by the last upload, if known. */
  previousUsdEur: number | null = null, targetGame = 'riftbound'
): PricePlan {
  const compareRate = previousUsdEur && previousUsdEur > 0 ? previousUsdEur : usdEur;
  const inEuros = (dollars: number | null, rate: number) => (dollars !== null ? Math.round(dollars * rate * 100) / 100 : null);
  const byKey = new Map<string, CsvRow>();
  for (const row of rows) {
    const k = norm(row.id);
    const existing = byKey.get(k);
    // Oversized battlefields share their ID with the regular card; the regular one is the one we hold.
    if (!existing || (/oversized/i.test(existing.name) && !/oversized/i.test(row.name))) byKey.set(k, row);
  }

  const riftbound = allCards.filter((c) => targetGame === 'all' || c.game === targetGame);
  const matched: PriceUpdate[] = [];
  const flagged: PricePlan['flagged'] = [];
  const unmatched: PriceCard[] = [];
  const nameMismatches: PricePlan['nameMismatches'] = [];

  for (const card of riftbound) {
    const row = byKey.get(cardKey(card));
    if (!row) { unmatched.push(card); continue; }
    if (!sameCard(card.name, row.name)) { nameMismatches.push({ card, row }); unmatched.push(card); continue; }
    const { normal, foil, notes } = pricesFor(card, row);
    if (notes.length) flagged.push({ card, notes });
    matched.push({
      card,
      eur: inEuros(normal, usdEur),
      eurFoil: inEuros(foil, usdEur),
      compareEur: inEuros(normal, compareRate),
      compareEurFoil: inEuros(foil, compareRate),
    });
  }

  const usedKeys = new Set(riftbound.map(cardKey));
  const csvLeftover = [...byKey.entries()].filter(([k]) => !usedKeys.has(k)).map(([, r]) => r);

  // A card whose file has no usable price is left as it is, not cleared.
  const updates = matched.filter((u) => u.eur !== null || u.eurFoil !== null);
  const changes = updates.filter(
    (u) => cents(u.compareEur) !== cents(u.card.market_price_eur) || cents(u.compareEurFoil) !== cents(u.card.market_price_foil_eur)
  );
  const newlyPriced = changes.filter((u) => u.card.market_price_eur === null && u.card.market_price_foil_eur === null).length;

  return {
    csvRows: rows.length,
    distinctIds: byKey.size,
    ourCards: riftbound.length,
    updates,
    changes,
    newlyPriced,
    unchanged: updates.length - changes.length,
    unmatched,
    csvLeftover,
    nameMismatches,
    flagged,
  };
}
