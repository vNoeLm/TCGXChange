import { describe, it, expect } from 'vitest';
import { isStoreOrder, isMarketplaceOrder } from '../src/lib/orderClassification';
import { OWNER_ID } from '../src/lib/constants';

describe('Order Classification & Strict Segregation', () => {
  it('correctly classifies standard retail store orders', () => {
    expect(isStoreOrder({
      order_number: 'ORD-20261025-C101',
      status: 'Cancelled',
      items: [{ card_name: 'Booster Box', quantity: 1, price_huf: 45000 }],
    })).toBe(true);

    expect(isStoreOrder({
      order_number: 'ORD-849201-382',
      seller_id: 'platform-owner',
      status: 'Processing',
    })).toBe(true);

    expect(isStoreOrder({
      order_number: 'ORD-123456-789',
      seller_id: OWNER_ID,
      status: 'Pending',
    })).toBe(true);

    expect(isStoreOrder({
      order_number: 'TEST-STORE-01',
      store_order: true,
    })).toBe(true);
  });

  it('rejects P2P marketplace orders, hold requests, trades, auctions, and bulk deals from being store orders', () => {
    // P2P hold orders
    expect(isStoreOrder({
      order_number: 'P2P-396722-503',
      hold_request_id: '66148473-4fc6-411a-bf37-266009bfd59a',
      seller_id: '7cac994f-a9b1-4a8e-aa7c-1176181a7dff',
      status: 'Delivered',
    })).toBe(false);

    expect(isMarketplaceOrder({
      order_number: 'P2P-396722-503',
      hold_request_id: '66148473-4fc6-411a-bf37-266009bfd59a',
      seller_id: '7cac994f-a9b1-4a8e-aa7c-1176181a7dff',
    })).toBe(true);

    // Test system hold cases
    expect(isStoreOrder({ order_number: 'TEST-HOLD-01' })).toBe(false);
    expect(isStoreOrder({ order_number: 'TEST-TRADE-01' })).toBe(false);
    expect(isStoreOrder({ order_number: 'TEST-AUCT-01' })).toBe(false);
    expect(isStoreOrder({ order_number: 'TEST-BULK-01' })).toBe(false);

    // Order with hold_request_id regardless of prefix
    expect(isStoreOrder({
      order_number: 'CUSTOM-123',
      hold_request_id: 'some-uuid',
    })).toBe(false);

    // Order with individual community seller_id
    expect(isStoreOrder({
      order_number: 'SALE-999',
      seller_id: '12e14be9-1b69-4c24-9b2f-649fbe0fc477',
    })).toBe(false);
  });

  it('preserves complete separation when filtering order lists', () => {
    const mixedOrders = [
      { order_number: 'ORD-20261025-C101', status: 'Cancelled' },
      { order_number: 'P2P-396722-503', seller_id: 'user-1', hold_request_id: 'h-1' },
      { order_number: 'ORD-20261024-C102', status: 'Shipped' },
      { order_number: 'P2P-103661-388', seller_id: 'user-2', hold_request_id: 'h-2' },
      { order_number: 'TEST-STORE-01', store_order: true },
      { order_number: 'TEST-HOLD-05' },
    ];

    const storeOnly = mixedOrders.filter(isStoreOrder);
    const marketplaceOnly = mixedOrders.filter(isMarketplaceOrder);

    expect(storeOnly.map(o => o.order_number)).toEqual([
      'ORD-20261025-C101',
      'ORD-20261024-C102',
      'TEST-STORE-01',
    ]);

    expect(marketplaceOnly.map(o => o.order_number)).toEqual([
      'P2P-396722-503',
      'P2P-103661-388',
      'TEST-HOLD-05',
    ]);
  });
});
