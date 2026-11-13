import { describe, it, expect } from 'vitest';
import {
  CUSTOMER_TIER_THRESHOLDS,
  computeCustomerTierFromOrders,
  getCustomerTier,
  type QualifyingStoreOrder,
} from '../src/lib/badges';

describe('Customer Tiers & Private Spend Calculation', () => {
  it('counts only Delivered orders and ignores Pending, Processing, Shipped, and Cancelled orders', () => {
    const orders: QualifyingStoreOrder[] = [
      { status: 'Pending', total_huf: 500_000, items: [{ quantity: 10 }] },
      { status: 'Processing', total_huf: 500_000, items: [{ quantity: 5 }] },
      { status: 'Shipped', total_huf: 500_000, items: [{ quantity: 5 }] },
      { status: 'Cancelled', total_huf: 500_000, items: [{ quantity: 5 }] },
      { status: 'Delivered', total_huf: 12_000, items: [{ quantity: 3 }] },
    ];

    const stats = computeCustomerTierFromOrders(orders);
    expect(stats).toEqual({
      tier: 1,
      completed_orders: 1,
      items_purchased: 3,
    });
  });

  it('returns strictly public stats and never leaks spend or score fields', () => {
    const stats = computeCustomerTierFromOrders([
      { status: 'Delivered', total_huf: 250_000, subtotal_huf: 245_000, items: [{ quantity: 4 }] },
    ]);

    expect(Object.keys(stats).sort()).toEqual(['completed_orders', 'items_purchased', 'tier']);
    expect('total_huf' in stats).toBe(false);
    expect('subtotal_huf' in stats).toBe(false);
    expect('score' in stats).toBe(false);
  });

  it('prevents tiny 50 Ft orders from farming high tiers while rewarding genuine 10k Ft orders', () => {
    const tinyOrders: QualifyingStoreOrder[] = Array.from({ length: 100 }, () => ({
      status: 'Delivered',
      total_huf: 50,
      items: [{ quantity: 1 }],
    }));

    const tinyStats = computeCustomerTierFromOrders(tinyOrders);
    // 100 orders * 50 Ft = 5,000 Ft total spend -> score stays well under 30,000, so Tier stays 1
    expect(tinyStats.completed_orders).toBe(100);
    expect(tinyStats.items_purchased).toBe(100);
    expect(tinyStats.tier).toBe(1);

    const highValueOrders: QualifyingStoreOrder[] = Array.from({ length: 100 }, () => ({
      status: 'Delivered',
      total_huf: 10_000,
      items: [{ quantity: 1 }],
    }));

    const highValueStats = computeCustomerTierFromOrders(highValueOrders);
    // 100 orders * 10,000 Ft = 1,000,000 Ft + bonuses -> meets Tier 6 threshold
    expect(highValueStats.completed_orders).toBe(100);
    expect(highValueStats.items_purchased).toBe(100);
    expect(highValueStats.tier).toBe(6);
  });

  it('progresses cleanly across all CUSTOMER_TIER_THRESHOLDS from Tier 0 to Tier 6', () => {
    expect(computeCustomerTierFromOrders([])).toEqual({
      tier: 0,
      completed_orders: 0,
      items_purchased: 0,
    });

    for (const threshold of CUSTOMER_TIER_THRESHOLDS) {
      const orders: QualifyingStoreOrder[] = Array.from({ length: threshold.minOrders }, () => ({
        status: 'Delivered',
        total_huf: threshold.minScore > 0 ? Math.ceil(threshold.minScore / threshold.minOrders) : 1_000,
        items: [{ quantity: 1 }],
      }));
      const stats = computeCustomerTierFromOrders(orders);
      expect(stats.tier).toBeGreaterThanOrEqual(threshold.tier);
    }
  });

  it('returns localized tier names, counts, and theme-aware styling in getCustomerTier', () => {
    const tier0 = getCustomerTier(0, 0, 0, false);
    expect(tier0.tier).toBe(0);
    expect(tier0.nameEn).toBe('Member');
    expect(tier0.nameHu).toBe('Tag');

    const tier3Dark = getCustomerTier(3, 6, 12, false);
    expect(tier3Dark.tier).toBe(3);
    expect(tier3Dark.nameEn).toBe('Silver Collector');
    expect(tier3Dark.nameHu).toBe('Ezüst Gyűjtő');
    expect(tier3Dark.completedOrders).toBe(6);
    expect(tier3Dark.itemsPurchased).toBe(12);
    expect(tier3Dark.color).toBe('#e2e8f0');

    const tier3Light = getCustomerTier(3, 6, 12, true);
    expect(tier3Light.color).toBe('#334155');
  });
});
