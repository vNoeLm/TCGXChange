import type { StoreProduct } from '../types';

/** Filters of the shop page. Every list is "any of"; the groups are combined with "and". */
export interface StoreFilters {
  search: string;
  category: string; // 'all' or a category id
  subcategories?: string[]; // e.g. 'Booster Display', 'Booster Pack', 'Vault', 'Starter Deck', 'Playmat', 'Toploader'
  brands: string[];
  games: string[]; // game ids, 'universal' for products not tied to one game
  sizes: string[];
  colors?: string[];
  languages?: string[];
  minPrice: number | null;
  maxPrice: number | null;
  inStockOnly: boolean;
}

export const EMPTY_STORE_FILTERS: StoreFilters = {
  search: '',
  category: 'all',
  subcategories: [],
  brands: [],
  games: [],
  sizes: [],
  colors: [],
  languages: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
};

export type FacetKey = 'category' | 'subcategories' | 'brands' | 'games' | 'sizes' | 'colors' | 'languages';

export const gameOf = (p: StoreProduct) => p.game || 'universal';

export function sizeOf(p: StoreProduct): string | null {
  if (p.attributes?.size && String(p.attributes.size).trim()) return String(p.attributes.size).trim();
  if (p.variant_kind === 'size' && p.variant_label?.trim()) return p.variant_label.trim();
  const name = p.name || '';
  const deckCap = name.match(/\b(80\+|100\+|133\+|200\+|266\+|400\+|550\+)\b/i);
  if (deckCap) return deckCap[1];
  const ptMatch = name.match(/\b(35pt|55pt|75pt|100pt|130pt|180pt|360pt)\b/i);
  if (ptMatch) return ptMatch[1].toLowerCase();
  const dimMatch = name.match(/\b(\d{2,3}\s*x\s*\d{2,3}\s*(?:cm|mm))\b/i);
  if (dimMatch) return dimMatch[1].replace(/\s+/g, '');
  if (p.category === 'sleeves') {
    if (/\b(japanese|small\s*size|mini)\b/i.test(name)) return 'Japanese';
    if (/\b(inner|perfect\s*fit)\b/i.test(name)) return 'Inner / Perfect Fit';
    if (/\b(outer|oversleeve)\b/i.test(name)) return 'Outer';
    if (/\bstandard\b/i.test(name)) return 'Standard';
  }
  return null;
}

export function colorOf(p: StoreProduct): string | null {
  if (p.attributes?.color && String(p.attributes.color).trim()) return String(p.attributes.color).trim();
  if (p.variant_kind === 'color' && p.variant_label?.trim()) return p.variant_label.trim();
  return null;
}

export function languageOf(p: StoreProduct): string | null {
  if (p.attributes?.language && String(p.attributes.language).trim()) return String(p.attributes.language).trim();
  if (p.variant_kind === 'language' && p.variant_label?.trim()) return p.variant_label.trim();
  const text = `${p.name || ''} ${p.variant_label || ''}`;
  if (/\b(simplified\s*chinese|s-chinese|chinese\b|zh-cn|zh\b)/i.test(text)) return 'Simplified Chinese';
  if (/\b(traditional\s*chinese|t-chinese|zh-tw)\b/i.test(text)) return 'Traditional Chinese';
  if (/\b(japanese|jpn|jp\b)/i.test(text)) return 'Japanese';
  if (/\b(korean|kor|kr\b)/i.test(text)) return 'Korean';
  if (/\b(german|deu|de\b)/i.test(text)) return 'German';
  if (/\b(french|fra|fr\b)/i.test(text)) return 'French';
  if (/\b(italian|ita|it\b)/i.test(text)) return 'Italian';
  if (/\b(spanish|esp|es\b)/i.test(text)) return 'Spanish';
  if (p.category === 'sealed' || p.game) return 'English';
  return null;
}

export function subcategoryOf(p: StoreProduct): string | null {
  if (p.attributes?.subcategory && String(p.attributes.subcategory).trim()) {
    return String(p.attributes.subcategory).trim();
  }
  const text = `${p.name || ''} ${p.variant_label || ''}`;
  if (p.category === 'sealed') {
    if (/\b(display|booster\s*box)\b/i.test(text)) return 'Booster Display';
    if (/\b(vault|collector\s*box|treasure\s*box)\b/i.test(text)) return 'Vault';
    if (/\b(starter\s*deck|champion\s*deck|structure\s*deck|theme\s*deck|trial\s*deck|\bdeck\b)\b/i.test(text)) return 'Starter Deck';
    if (/\b(bundle|fat\s*pack|prerelease|etb|elite\s*trainer|gift\s*box|collection\s*box|tin)\b/i.test(text)) return 'Bundle';
    if (/\b(booster\s*pack|sleeved\s*booster|blister|\bpack\b|\bbooster\b)\b/i.test(text)) return 'Booster Pack';
  } else if (p.category === 'playmats') {
    if (/\b(tube|case|holder)\b/i.test(text)) return 'Playmat Tube';
    if (/\b(2-player|two-player|double\s*mat|xl\s*playmat)\b/i.test(text)) return '2-Player Playmat';
    return 'Playmat';
  } else if (p.category === 'protection') {
    if (/\b(magnetic|one-touch|one\s*touch)\b/i.test(text)) return 'Magnetic One-Touch';
    if (/\b(semi-rigid|card\s*saver)\b/i.test(text)) return 'Semi-Rigid / Card Saver';
    if (/\b(stand|easel|frame)\b/i.test(text)) return 'Display Stand';
    if (/\b(team\s*bag|resealable)\b/i.test(text)) return 'Team Bags';
    if (/\b(toploader|top\s*loader)\b/i.test(text)) return 'Toploader';
  } else if (p.category === 'sleeves') {
    if (/\b(inner|perfect\s*fit|perfect\s*size)\b/i.test(text)) return 'Inner / Perfect Fit';
    if (/\b(outer|oversleeve|character\s*guard)\b/i.test(text)) return 'Outer Sleeves';
    if (/\b(japanese|small\s*size|mini)\b/i.test(text)) return 'Japanese Sleeves';
    if (/\b(art\s*sleeve)\b/i.test(text)) return 'Art Sleeves';
    if (/\bstandard\b/i.test(text)) return 'Standard Sleeves';
  } else if (p.category === 'binders') {
    if (/\b(12-pocket|12\s*pocket|quad-row)\b/i.test(text)) return '12-Pocket Binder';
    if (/\b(9-pocket|9\s*pocket)\b/i.test(text)) return '9-Pocket Binder';
    if (/\b(4-pocket|4\s*pocket)\b/i.test(text)) return '4-Pocket Binder';
    if (/\b(page|pages|sheet)\b/i.test(text)) return 'Pocket Pages';
  } else if (p.category === 'deck_boxes') {
    if (/\b(80\+)\b/i.test(text)) return 'Deck Box (80+)';
    if (/\b(100\+)\b/i.test(text)) return 'Deck Box (100+)';
    if (/\b(133\+)\b/i.test(text)) return 'Double Deck Box (133+)';
    if (/\b(200\+|266\+|400\+)\b/i.test(text)) return 'Storage Deck Case (200+)';
  }
  return null;
}

export function releaseAtOf(p: StoreProduct): string | null {
  const raw = p.attributes?.release_at;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ts = Date.parse(raw.trim());
  return Number.isFinite(ts) ? raw.trim() : null;
}

export function isScheduledForFuture(p: StoreProduct, nowMs = Date.now()): boolean {
  const rel = releaseAtOf(p);
  if (!rel) return false;
  return Date.parse(rel) > nowMs;
}

/**
 * Whether a product is publicly visible to shoppers right now:
 * - Archived products are never visible.
 * - Products with a future `attributes.release_at` stay hidden (draft) until that timestamp.
 * - Products in `draft` status become visible automatically once their `attributes.release_at` has passed.
 */
export function isPubliclyVisibleProduct(p: StoreProduct, nowMs = Date.now()): boolean {
  if (p.status === 'archived') return false;
  if (isScheduledForFuture(p, nowMs)) return false;
  if (p.status === 'draft') {
    return Boolean(releaseAtOf(p));
  }
  return true;
}

export function msrpOf(p: StoreProduct): number | null {
  const n = Number(p.attributes?.msrp_huf);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export const isSoldOut = (p: StoreProduct) => (p.stock_quantity ?? 0) <= 0;

/** `skip` leaves one facet out, which is how a facet's own counts ignore its own selection. */
export function applyStoreFilters(products: StoreProduct[], f: StoreFilters, skip?: FacetKey): StoreProduct[] {
  const q = f.search.trim().toLowerCase();
  const subcats = f.subcategories || [];
  const colors = f.colors || [];
  const languages = f.languages || [];
  return products.filter((p) => {
    if (q && !`${p.name} ${p.brand} ${p.sku ?? ''} ${p.ean ?? ''} ${p.variant_label ?? ''} ${subcategoryOf(p) ?? ''}`.toLowerCase().includes(q)) return false;
    if (skip !== 'category' && f.category !== 'all' && p.category !== f.category) return false;
    if (skip !== 'subcategories' && subcats.length) {
      const sub = subcategoryOf(p);
      if (!sub || !subcats.includes(sub)) return false;
    }
    if (skip !== 'brands' && f.brands.length && !f.brands.includes(p.brand)) return false;
    if (skip !== 'games' && f.games.length && !f.games.includes(gameOf(p))) return false;
    if (skip !== 'sizes' && f.sizes.length) {
      const size = sizeOf(p);
      if (!size || !f.sizes.includes(size)) return false;
    }
    if (skip !== 'colors' && colors.length) {
      const col = colorOf(p);
      if (!col || !colors.includes(col)) return false;
    }
    if (skip !== 'languages' && languages.length) {
      const lang = languageOf(p);
      if (!lang || !languages.includes(lang)) return false;
    }
    if (f.minPrice !== null && p.price_huf < f.minPrice) return false;
    if (f.maxPrice !== null && p.price_huf > f.maxPrice) return false;
    if (f.inStockOnly && isSoldOut(p)) return false;
    return true;
  });
}

/** [value, count] pairs for one facet, biggest first. */
export function facetCounts(products: StoreProduct[], f: StoreFilters, key: FacetKey): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of applyStoreFilters(products, f, key)) {
    const value =
      key === 'category' ? p.category :
      key === 'subcategories' ? subcategoryOf(p) :
      key === 'brands' ? p.brand :
      key === 'games' ? gameOf(p) :
      key === 'colors' ? colorOf(p) :
      key === 'languages' ? languageOf(p) :
      sizeOf(p);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function activeFilterCount(f: StoreFilters): number {
  return (
    (f.category !== 'all' ? 1 : 0) +
    (f.subcategories?.length || 0) +
    f.brands.length +
    f.games.length +
    f.sizes.length +
    (f.colors?.length || 0) +
    (f.languages?.length || 0) +
    (f.minPrice !== null || f.maxPrice !== null ? 1 : 0) +
    (f.inStockOnly ? 1 : 0)
  );
}

export type StoreSort = 'newest' | 'price_asc' | 'price_desc' | 'name';

export function sortStoreProducts(products: StoreProduct[], sort: StoreSort): StoreProduct[] {
  const list = [...products];
  // Sold-out products always sink to the bottom, whatever the sort.
  const soldOut = (p: StoreProduct) => (isSoldOut(p) ? 1 : 0);
  const by: Record<StoreSort, (a: StoreProduct, b: StoreProduct) => number> = {
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    price_asc: (a, b) => a.price_huf - b.price_huf,
    price_desc: (a, b) => b.price_huf - a.price_huf,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return list.sort((a, b) => soldOut(a) - soldOut(b) || by[sort](a, b));
}

/** How many products each variant group holds, so a card can say "5 options". */
export function variantCounts(products: StoreProduct[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of products) {
    if (p.variant_group) map.set(p.variant_group, (map.get(p.variant_group) || 0) + 1);
  }
  return map;
}
