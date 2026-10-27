import { describe, it, expect, beforeEach } from 'vitest';
import { addToStoreCart, effectiveMaxQuantity, readStoreCart, clearStoreCart } from '../src/lib/storeCart';
import type { StoreProduct } from '../src/types';

const makeProduct = (over: Partial<StoreProduct>): StoreProduct => ({
  id: 'prod-1',
  slug: 'test-product',
  name: 'Test Product',
  category: 'sealed',
  brand: 'TestBrand',
  game: 'riftbound',
  price_huf: 1000,
  stock_quantity: 36,
  status: 'active',
  images: [],
  attributes: {},
  is_featured: false,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...over,
});

describe('effectiveMaxQuantity', () => {
  it('returns stock quantity when no maxPerOrder is configured', () => {
    expect(effectiveMaxQuantity(36, null)).toBe(36);
    expect(effectiveMaxQuantity(36, undefined)).toBe(36);
    expect(effectiveMaxQuantity(36, 0)).toBe(36);
  });

  it('caps at maxPerOrder when smaller than stock', () => {
    expect(effectiveMaxQuantity(36, 5)).toBe(5);
  });

  it('caps at stock when stock is smaller than maxPerOrder', () => {
    expect(effectiveMaxQuantity(3, 10)).toBe(3);
  });
});

describe('addToStoreCart limit vs stock reasons', () => {
  beforeEach(() => {
    clearStoreCart();
  });

  it('correctly distinguishes stock cap when there is no order limit', () => {
    const product = makeProduct({ stock_quantity: 36, attributes: {} });

    // Try adding 40 when stock is 36
    const res1 = addToStoreCart(product, 40);
    expect(res1.added).toBe(36);
    expect(res1.cappedByLimit).toBe(true);
    expect(res1.capReason).toBe('stock');

    // Try adding 1 more when cart is already at 36
    const res2 = addToStoreCart(product, 1);
    expect(res2.added).toBe(0);
    expect(res2.cappedByLimit).toBe(true);
    expect(res2.capReason).toBe('stock');
  });

  it('correctly distinguishes the customer limit cap when a limit is configured', () => {
    const product = makeProduct({ stock_quantity: 36, attributes: { max_per_order: 5 } });

    // Try adding 10 when order limit is 5
    const res1 = addToStoreCart(product, 10);
    expect(res1.added).toBe(5);
    expect(res1.cappedByLimit).toBe(true);
    expect(res1.capReason).toBe('customer_limit');

    // Try adding 1 more when cart is already at 5
    const res2 = addToStoreCart(product, 1);
    expect(res2.added).toBe(0);
    expect(res2.cappedByLimit).toBe(true);
    expect(res2.capReason).toBe('customer_limit');
  });

  it('reports stock cap when stock is smaller than order limit', () => {
    const product = makeProduct({ stock_quantity: 3, attributes: { max_per_order: 10 } });

    // Try adding 5 when stock is 3 and limit is 10
    const res = addToStoreCart(product, 5);
    expect(res.added).toBe(3);
    expect(res.cappedByLimit).toBe(true);
    expect(res.capReason).toBe('stock');
  });
});
