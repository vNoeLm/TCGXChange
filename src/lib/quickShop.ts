import type { InventoryCard } from '../types';
import { normalizeCardCondition } from './collectionDefaults';

export interface WantEntry {
  key: string;
  name: string;
  /** Card number as pasted (e.g. "VEN-038/166"); pins the exact print when present. */
  number: string | null;
  /** Exact card id (from a JSON export); pins the exact print when present. */
  cardId: string | null;
  qty: number;
  foil: boolean;
}

export type ShopStrategy = 'cheapest' | 'fewest_sellers';

export interface ShopOptions {
  /** Worst acceptable condition; "Any" accepts everything. */
  minCondition: string;
  /** Let a foil listing fill a request that didn't ask for foil. */
  allowFoilSubstitute: boolean;
  /** Skip the buyer's own listings. */
  excludeSellerId?: string | null;
}

export interface Allocation {
  listing: InventoryCard;
  qty: number;
}

export interface ShopLine {
  want: WantEntry;
  allocations: Allocation[];
  foundQty: number;
  /** How many copies were listed at all (before running out), to tell "none listed" from "only some". */
  availableQty: number;
}

export interface SellerBasket {
  sellerId: string;
  sellerName: string;
  items: Array<{ listing: InventoryCard; qty: number }>;
  subtotal: number;
  copies: number;
}

export interface ShopPlan {
  strategy: ShopStrategy;
  lines: ShopLine[];
  baskets: SellerBasket[];
  totalCost: number;
  copiesFound: number;
  copiesWanted: number;
}

export const CONDITION_ORDER = ['Pack Fresh', 'Near Mint', 'Excellent', 'Good', 'Played', 'Damaged'];

const simplify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ─── Parsing ────────────────────────────────────────────────────────────────

const looksLikeCardNumber = (s: string) => /\d/.test(s) && !/\s/.test(s.trim());

function mergeWants(entries: Omit<WantEntry, 'key'>[]): WantEntry[] {
  const merged = new Map<string, WantEntry>();
  entries.forEach(e => {
    const key = [e.cardId || '', simplify(e.name), (e.number || '').toUpperCase(), e.foil ? 'f' : 'n'].join('|');
    const existing = merged.get(key);
    if (existing) existing.qty += e.qty;
    else merged.set(key, { ...e, key });
  });
  return Array.from(merged.values());
}

function parseJsonWants(parsed: any): Omit<WantEntry, 'key'>[] | null {
  const fromObject = (o: any): Omit<WantEntry, 'key'> | null => {
    if (!o || typeof o !== 'object') return null;
    const qty = Number(o.qty ?? o.quantity ?? o.count ?? 1);
    const rawId = typeof o.id === 'string' ? o.id : typeof o.card_id === 'string' ? o.card_id : null;
    const name = String(o.name || o.card_name || '');
    const number = o.cardNumber || o.card_number || null;
    if (!rawId && !name && !number) return null;
    return { name, number, cardId: rawId, qty: qty > 0 ? Math.floor(qty) : 1, foil: Boolean(o.foil ?? o.isFoil ?? o.is_foil) };
  };

  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cards) ? parsed.cards : null;
  if (list) {
    const out: Omit<WantEntry, 'key'>[] = [];
    list.forEach((item: any) => {
      if (typeof item === 'string') out.push({ name: item, number: null, cardId: null, qty: 1, foil: false });
      else {
        const e = fromObject(item);
        if (e) out.push(e);
      }
    });
    return out;
  }

  // Plain collection map: { "<card id>": qty, "<card id>_foil": qty }
  if (parsed && typeof parsed === 'object') {
    const out: Omit<WantEntry, 'key'>[] = [];
    Object.entries(parsed).forEach(([k, v]) => {
      const qty = Number(v);
      if (!qty || qty <= 0) return;
      const foil = k.endsWith('_foil');
      out.push({ name: '', number: null, cardId: foil ? k.replace(/_foil$/, '') : k, qty: Math.floor(qty), foil });
    });
    return out;
  }
  return null;
}

/** Parses a pasted want-list: the missing-cards export (text or JSON), a collection backup, or hand-typed lines. */
export function parseWantList(input: string): WantEntry[] {
  const text = input.trim();
  if (!text) return [];

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const fromJson = parseJsonWants(JSON.parse(text));
      if (fromJson) return mergeWants(fromJson);
    } catch (e) {
      // not JSON, fall through to line parsing
    }
  }

  const entries: Omit<WantEntry, 'key'>[] = [];
  text.split(/\r?\n/).forEach(rawLine => {
    let line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#') || line.startsWith('===')) return;

    let qty = 1;
    const qtyMatch = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    if (qtyMatch) {
      qty = parseInt(qtyMatch[1], 10) || 1;
      line = qtyMatch[2].trim();
    }

    const foil = /\[\s*foil\s*\]|\(\s*foil\s*\)/i.test(line);
    line = line.replace(/\[\s*foil\s*\]|\(\s*foil\s*\)/gi, '').trim();

    let number: string | null = null;
    const tag = line.match(/^(.*?)\s*[\(\[]([^\)\]]+)[\)\]]\s*$/);
    if (tag && looksLikeCardNumber(tag[2])) {
      line = tag[1].trim();
      number = tag[2].trim();
    }

    if (line || number) entries.push({ name: line, number, cardId: null, qty, foil });
  });

  return mergeWants(entries);
}

// ─── Matching ───────────────────────────────────────────────────────────────

const normNumber = (s: string) => s.toUpperCase().replace(/\s+/g, '');
const baseNumber = (s: string) => normNumber(s).split('/')[0];
const stripSetPrefix = (s: string) => baseNumber(s).replace(/^[A-Z]+-/, '');

function numberMatches(listingNumber: string, wantNumber: string): boolean {
  if (!listingNumber) return false;
  const l = baseNumber(listingNumber);
  const w = baseNumber(wantNumber);
  if (l === w) return true;
  const wantHasPrefix = /^[A-Z]{2,5}-/.test(w);
  if (!wantHasPrefix) return stripSetPrefix(listingNumber) === w;
  return l === w.replace(/^[A-Z]+-/, '');
}

export function listingMatchesWant(l: InventoryCard, want: WantEntry): boolean {
  if (want.cardId) return l.card_id === want.cardId;
  if (want.number) {
    if (!numberMatches(l.card_number, want.number)) return false;
    return !want.name || simplify(l.name) === simplify(want.name);
  }
  return simplify(l.name) === simplify(want.name);
}

function conditionOk(condition: string, minCondition: string): boolean {
  if (!minCondition || minCondition === 'Any') return true;
  const rank = (c: string) => {
    const norm = normalizeCardCondition(c);
    const i = CONDITION_ORDER.indexOf(norm);
    return i === -1 ? CONDITION_ORDER.indexOf('Near Mint') : i;
  };
  return rank(condition) <= rank(minCondition);
}

export function candidatesFor(want: WantEntry, listings: InventoryCard[], options: ShopOptions): InventoryCard[] {
  return listings.filter(l => {
    if (l.status !== 'In Stock' || !(l.quantity > 0) || !(l.price_huf && l.price_huf > 0)) return false;
    if (options.excludeSellerId && l.seller_id === options.excludeSellerId) return false;
    if (!conditionOk(l.condition, options.minCondition)) return false;
    if (want.foil !== Boolean(l.is_foil) && !(!want.foil && l.is_foil && options.allowFoilSubstitute)) return false;
    return listingMatchesWant(l, want);
  });
}

// ─── Optimization ───────────────────────────────────────────────────────────

const sellerOf = (l: InventoryCard) => l.seller_id || 'owner';

/** Fills every want from the cheapest listings, optionally limited to a set of sellers. */
function allocate(
  wants: WantEntry[],
  candidates: Map<string, InventoryCard[]>,
  allowedSellers: Set<string> | null
): ShopLine[] {
  const remaining = new Map<string, number>();
  candidates.forEach(list => list.forEach(l => remaining.set(l.inventory_id, l.quantity)));

  // Tightest wants first, so they get first pick of contested listings.
  const order = [...wants].sort((a, b) => (candidates.get(a.key)?.length || 0) - (candidates.get(b.key)?.length || 0));
  const byKey = new Map<string, ShopLine>();

  order.forEach(want => {
    const all = candidates.get(want.key) || [];
    const usable = all
      .filter(l => !allowedSellers || allowedSellers.has(sellerOf(l)))
      .sort((a, b) => (a.price_huf as number) - (b.price_huf as number) || b.quantity - a.quantity);

    let need = want.qty;
    const allocations: Allocation[] = [];
    usable.forEach(l => {
      if (need <= 0) return;
      const left = remaining.get(l.inventory_id) || 0;
      const take = Math.min(need, left);
      if (take > 0) {
        allocations.push({ listing: l, qty: take });
        remaining.set(l.inventory_id, left - take);
        need -= take;
      }
    });

    byKey.set(want.key, {
      want,
      allocations,
      foundQty: want.qty - need,
      availableQty: all.reduce((sum, l) => sum + l.quantity, 0),
    });
  });

  return wants.map(w => byKey.get(w.key) as ShopLine);
}

function chooseFewestSellers(wants: WantEntry[], candidates: Map<string, InventoryCard[]>): Set<string> {
  const need = new Map(wants.map(w => [w.key, w.qty]));
  const stock = new Map<string, number>();
  const sellers = new Set<string>();
  candidates.forEach(list => list.forEach(l => { stock.set(l.inventory_id, l.quantity); sellers.add(sellerOf(l)); }));

  const coverage = (sellerId: string, commit: boolean) => {
    let covered = 0;
    let cost = 0;
    wants.forEach(w => {
      let n = need.get(w.key) || 0;
      if (n <= 0) return;
      const mine = (candidates.get(w.key) || [])
        .filter(l => sellerOf(l) === sellerId)
        .sort((a, b) => (a.price_huf as number) - (b.price_huf as number));
      mine.forEach(l => {
        const left = stock.get(l.inventory_id) || 0;
        const take = Math.min(n, left);
        if (take <= 0) return;
        covered += take;
        cost += take * (l.price_huf as number);
        n -= take;
        if (commit) stock.set(l.inventory_id, left - take);
      });
      if (commit) need.set(w.key, n);
    });
    return { covered, cost };
  };

  const chosen = new Set<string>();
  for (;;) {
    let best: { id: string; covered: number; cost: number } | null = null;
    sellers.forEach(id => {
      if (chosen.has(id)) return;
      const c = coverage(id, false);
      if (c.covered === 0) return;
      const better = !best
        || c.covered > best.covered
        || (c.covered === best.covered && c.cost / c.covered < best.cost / best.covered);
      if (better) best = { id, covered: c.covered, cost: c.cost };
    });
    if (!best) break;
    coverage((best as { id: string }).id, true);
    chosen.add((best as { id: string }).id);
  }

  // Drop any seller whose share the remaining sellers can cover without losing a copy.
  const foundWith = (set: Set<string>) => allocate(wants, candidates, set).reduce((s, l) => s + l.foundQty, 0);
  let target = foundWith(chosen);
  Array.from(chosen).reverse().forEach(id => {
    if (chosen.size <= 1) return;
    const trial = new Set(chosen);
    trial.delete(id);
    if (foundWith(trial) >= target) chosen.delete(id);
  });
  return chosen;
}

function buildPlan(strategy: ShopStrategy, lines: ShopLine[]): ShopPlan {
  const baskets = new Map<string, SellerBasket>();
  lines.forEach(line => {
    line.allocations.forEach(({ listing, qty }) => {
      const id = sellerOf(listing);
      let basket = baskets.get(id);
      if (!basket) {
        basket = { sellerId: id, sellerName: listing.seller_name || 'Community Seller', items: [], subtotal: 0, copies: 0 };
        baskets.set(id, basket);
      }
      basket.items.push({ listing, qty });
      basket.subtotal += (listing.price_huf as number) * qty;
      basket.copies += qty;
    });
  });

  const list = Array.from(baskets.values()).sort((a, b) => b.subtotal - a.subtotal);
  return {
    strategy,
    lines,
    baskets: list,
    totalCost: list.reduce((s, b) => s + b.subtotal, 0),
    copiesFound: lines.reduce((s, l) => s + l.foundQty, 0),
    copiesWanted: lines.reduce((s, l) => s + l.want.qty, 0),
  };
}

export function planPurchase(wants: WantEntry[], listings: InventoryCard[], options: ShopOptions): Record<ShopStrategy, ShopPlan> {
  const candidates = new Map<string, InventoryCard[]>();
  wants.forEach(w => candidates.set(w.key, candidatesFor(w, listings, options)));

  const cheapest = buildPlan('cheapest', allocate(wants, candidates, null));
  const sellers = chooseFewestSellers(wants, candidates);
  const fewest = buildPlan('fewest_sellers', allocate(wants, candidates, sellers));
  return { cheapest, fewest_sellers: fewest };
}
