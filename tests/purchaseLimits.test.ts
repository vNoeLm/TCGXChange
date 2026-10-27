import { describe, expect, it } from 'vitest';
import {
  countsTowardsLimit,
  customerLimitFor,
  normalizeEmail,
  normalizePhone,
  orderCapFor,
  unitsPurchasedInWindow,
} from '../src/lib/purchaseLimits';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-27T12:00:00Z');

const order = (overrides: Record<string, any> = {}) => ({
  user_id: 'user-1',
  created_at: new Date(NOW - DAY).toISOString(),
  status: 'Pending',
  payment_status: 'pending',
  customer_info: {},
  notes: null,
  items: [{ inventory_id: 'product-1', quantity: 1 }],
  ...overrides,
});

describe('identity normalization', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail('  Buyer@Example.COM ')).toBe('buyer@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
  });

  it('collapses the Hungarian phone formats to one number', () => {
    const expected = '36301234567';
    expect(normalizePhone('+36 30 123 4567')).toBe(expected);
    expect(normalizePhone('06-30-123-4567')).toBe(expected);
    expect(normalizePhone('0036 30 123 4567')).toBe(expected);
    expect(normalizePhone('30 123 4567')).toBe(expected);
    expect(normalizePhone('')).toBeNull();
  });
});

describe('product limits', () => {
  it('reads a per-customer number and window, falling back to the old per-order value', () => {
    expect(customerLimitFor({ max_per_customer: 12, limit_window_days: 3 })).toEqual({ maxPerCustomer: 12, windowDays: 3 });
    expect(customerLimitFor({ max_per_customer: 1 })).toEqual({ maxPerCustomer: 1, windowDays: 0 });
    expect(customerLimitFor({ max_per_order: 2 })).toEqual({ maxPerCustomer: 2, windowDays: 0 });
    expect(customerLimitFor({})).toEqual({ maxPerCustomer: null, windowDays: 0 });
  });

  it('uses one basket cap, the unified customer limit', () => {
    expect(orderCapFor({ max_per_customer: 12 })).toBe(12);
    expect(orderCapFor({ max_per_order: 2 })).toBe(2);
    expect(orderCapFor({ max_per_customer: 3, max_per_order: 5 })).toBe(3);
    expect(orderCapFor({})).toBeNull();
  });
});

describe('counting past orders', () => {
  const buyer = { userId: 'user-1', emails: ['buyer@example.com'], phones: ['+36301234567'] };

  it('counts units for the same account across orders', () => {
    const orders = [
      order({ user_id: 'user-1', items: [{ inventory_id: 'product-1', quantity: 2 }] }),
      order({ user_id: 'user-1', items: [{ inventory_id: 'product-1', quantity: 1 }] }),
      order({ user_id: 'someone-else', items: [{ inventory_id: 'product-1', quantity: 9 }] }),
    ];
    expect(unitsPurchasedInWindow(orders, buyer, 'product-1', 7, NOW)).toBe(3);
  });

  it('links another account by email or phone', () => {
    const byEmail = order({ user_id: null, customer_info: { email: 'BUYER@example.com' } });
    const byPhone = order({ user_id: null, notes: 'Phone: 06 30 123 4567 | Email: other@example.com' });
    expect(unitsPurchasedInWindow([byEmail, byPhone], buyer, 'product-1', 7, NOW)).toBe(2);
  });

  it('ignores orders outside the window, but a zero window means lifetime', () => {
    const old = order({ created_at: new Date(NOW - 8 * DAY).toISOString() });
    const recent = order({ created_at: new Date(NOW - 2 * DAY).toISOString() });
    expect(unitsPurchasedInWindow([old, recent], buyer, 'product-1', 7, NOW)).toBe(1);
    expect(unitsPurchasedInWindow([old, recent], buyer, 'product-1', 0, NOW)).toBe(2);
  });

  it('does not count cancelled, refunded or failed orders', () => {
    const orders = [
      order({ status: 'Cancelled' }),
      order({ status: 'Refunded' }),
      order({ payment_status: 'failed' }),
      order({ status: 'Completed' }),
    ];
    expect(unitsPurchasedInWindow(orders, buyer, 'product-1', 7, NOW)).toBe(1);
  });

  it('counts every matching line, not just the first', () => {
    const orders = [order({ items: [{ inventory_id: 'product-1', quantity: 4 }, { inventory_id: 'product-1', quantity: 2 }] })];
    expect(unitsPurchasedInWindow(orders, buyer, 'product-1', 7, NOW)).toBe(6);
  });

  it('treats pending orders as already bought', () => {
    expect(countsTowardsLimit(order())).toBe(true);
    expect(countsTowardsLimit(order({ status: 'Cancelled' }))).toBe(false);
  });
});
