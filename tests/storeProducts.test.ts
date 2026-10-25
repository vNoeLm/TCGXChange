import { describe, it, expect } from 'vitest';
import type { StoreProduct } from '../src/types';
import { EMPTY_STORE_FILTERS, applyStoreFilters, facetCounts, sortStoreProducts, activeFilterCount, isSoldOut } from '../src/lib/storeProducts';

const make = (over: Partial<StoreProduct>): StoreProduct => ({
  id: over.sku || 'x', name: 'P', slug: 'p', category: 'sleeves', brand: 'Ultimate Guard', game: null,
  price_huf: 1000, stock_quantity: 5, status: 'active', images: [], attributes: {}, is_featured: false,
  created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
});

const products = [
  make({ sku: 'a', name: 'Katana Black', price_huf: 5000, attributes: { size: 'Standard' } }),
  make({ sku: 'b', name: 'Katana Red', price_huf: 5000, attributes: { size: 'Standard' }, stock_quantity: 0 }),
  make({ sku: 'c', name: 'Boulder', category: 'deck_boxes', brand: 'Gamegenic', game: 'riftbound', price_huf: 9000 }),
  make({ sku: 'd', name: 'Display Radiance', category: 'sealed', brand: 'Riftbound', game: 'riftbound', price_huf: 60000, attributes: { language: 'English' } }),
  make({ sku: 'e', name: 'OP-05 Japanese Display', category: 'sealed', brand: 'Bandai', game: 'onepiece', price_huf: 45000, attributes: { language: 'Japanese' } }),
];

describe('applyStoreFilters', () => {
  it('combines groups with AND and values with OR', () => {
    const f = { ...EMPTY_STORE_FILTERS, brands: ['Gamegenic', 'Riftbound'], games: ['riftbound'] };
    expect(applyStoreFilters(products, f).map((p) => p.sku)).toEqual(['c', 'd']);
  });

  it('filters by language', () => {
    const f = { ...EMPTY_STORE_FILTERS, languages: ['Japanese'] };
    expect(applyStoreFilters(products, f).map((p) => p.sku)).toEqual(['e']);
  });

  it('treats products with no game as universal', () => {
    const f = { ...EMPTY_STORE_FILTERS, games: ['universal'] };
    expect(applyStoreFilters(products, f).map((p) => p.sku)).toEqual(['a', 'b']);
  });

  it('filters by price range, size and stock', () => {
    expect(applyStoreFilters(products, { ...EMPTY_STORE_FILTERS, minPrice: 6000 }).map((p) => p.sku)).toEqual(['c', 'd', 'e']);
    expect(applyStoreFilters(products, { ...EMPTY_STORE_FILTERS, sizes: ['Standard'], inStockOnly: true }).map((p) => p.sku)).toEqual(['a']);
  });

  it('searches name, brand and variant label', () => {
    expect(applyStoreFilters(products, { ...EMPTY_STORE_FILTERS, search: 'radiance' }).map((p) => p.sku)).toEqual(['d']);
  });
});

describe('facetCounts', () => {
  it('ignores the facet\'s own selection so other options stay visible', () => {
    const f = { ...EMPTY_STORE_FILTERS, brands: ['Gamegenic'] };
    const brands = facetCounts(products, f, 'brands');
    expect(brands.map(([b]) => b).sort()).toEqual(['Bandai', 'Gamegenic', 'Riftbound', 'Ultimate Guard']);
  });

  it('narrows other facets by the current selection', () => {
    const f = { ...EMPTY_STORE_FILTERS, brands: ['Gamegenic'] };
    expect(facetCounts(products, f, 'category')).toEqual([['deck_boxes', 1]]);
  });
});

describe('sortStoreProducts', () => {
  it('sinks sold-out products below the rest', () => {
    const sorted = sortStoreProducts(products, 'price_asc');
    expect(sorted[sorted.length - 1].sku).toBe('b');
  });
});

describe('activeFilterCount', () => {
  it('counts each selection', () => {
    expect(activeFilterCount({ ...EMPTY_STORE_FILTERS, category: 'sealed', brands: ['x', 'y'], inStockOnly: true })).toBe(4);
  });
});

describe('isSoldOut', () => {
  it('determines out of stock automatically based on stock <= 0', () => {
    expect(isSoldOut(make({ stock_quantity: 0, status: 'active' }))).toBe(true);
    expect(isSoldOut(make({ stock_quantity: -1, status: 'active' }))).toBe(true);
    expect(isSoldOut(make({ stock_quantity: 10, status: 'active' }))).toBe(false);
  });
});
