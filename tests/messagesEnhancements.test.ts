import { describe, expect, it } from 'vitest';
import {
  computeLatestActivityAt,
  isConversationHidden,
  resolveTransactionDestination,
} from '../src/lib/messages';

describe('Messages conversation hiding and transaction card routing', () => {
  it('computes the latest valid activity timestamp across messages and holds', () => {
    const t1 = '2026-10-30T10:00:00.000Z';
    const t2 = '2026-10-31T08:30:00.000Z';
    const t3 = '2026-10-31T12:15:00.000Z';

    expect(computeLatestActivityAt([null, undefined, t1, t3, t2])).toBe(t3);
    expect(computeLatestActivityAt([null, undefined, 'not-a-date'])).toBeNull();
  });

  it('keeps a removed conversation hidden while no new activity has happened', () => {
    const hiddenMap = {
      'conv-1': '2026-10-31T10:00:00.000Z',
    };

    // Older message/hold before hide -> stays hidden
    expect(isConversationHidden('conv-1', '2026-10-31T09:59:59.000Z', hiddenMap)).toBe(true);
    // Exact timestamp at hide moment -> stays hidden
    expect(isConversationHidden('conv-1', '2026-10-31T10:00:00.000Z', hiddenMap)).toBe(true);
  });

  it('automatically resurfaces a removed conversation when a new transaction or message arrives', () => {
    const hiddenMap = {
      'conv-1': '2026-10-31T10:00:00.000Z',
      'conv-unhidden': '',
    };

    // New hold/trade/message 1 second after hide -> automatically visible again
    expect(isConversationHidden('conv-1', '2026-10-31T10:00:01.000Z', hiddenMap)).toBe(false);
    // Explicitly unhidden entry -> visible
    expect(isConversationHidden('conv-unhidden', '2026-10-30T00:00:00.000Z', hiddenMap)).toBe(false);
    // Conversation never hidden -> visible
    expect(isConversationHidden('conv-other', '2026-10-30T00:00:00.000Z', hiddenMap)).toBe(false);
  });

  it('routes buyer transaction card clicks to Profile Order History with order/hold parameters', () => {
    const activeBuyerDest = resolveTransactionDestination({
      isSeller: false,
      holdRequestId: 'hold-abc-123',
      orderNumber: null,
    });
    expect(activeBuyerDest).toEqual({
      href: '/profile?hold=hold-abc-123#order-history',
      labelKey: 'order_history',
    });

    const completedBuyerDest = resolveTransactionDestination({
      isSeller: false,
      holdRequestId: 'hold-abc-123',
      orderNumber: 'P2P-654321-999',
    });
    expect(completedBuyerDest).toEqual({
      href: '/profile?order=P2P-654321-999&hold=hold-abc-123#order-history',
      labelKey: 'order_history',
    });
  });

  it('routes seller transaction card clicks to Seller Hub with hold/order parameters', () => {
    const activeSellerDest = resolveTransactionDestination({
      isSeller: true,
      holdRequestId: 'hold-abc-123',
    });
    expect(activeSellerDest).toEqual({
      href: '/seller?hold=hold-abc-123',
      labelKey: 'seller_hub',
    });

    const completedSellerDest = resolveTransactionDestination({
      isSeller: true,
      holdRequestId: 'hold-abc-123',
      orderNumber: 'P2P-654321-999',
    });
    expect(completedSellerDest).toEqual({
      href: '/seller?hold=hold-abc-123&order=P2P-654321-999',
      labelKey: 'seller_hub',
    });
  });

  it('routes official store order cards to Order History for customers and Store Admin for store owner', () => {
    const customerStoreDest = resolveTransactionDestination({
      isSeller: false,
      isStoreOrder: true,
      isStoreOwner: false,
      orderNumber: 'ORD-2026-001',
    });
    expect(customerStoreDest).toEqual({
      href: '/profile?order=ORD-2026-001#order-history',
      labelKey: 'order_history',
    });

    const ownerStoreDest = resolveTransactionDestination({
      isSeller: true,
      isStoreOrder: true,
      isStoreOwner: true,
      orderNumber: 'ORD-2026-001',
    });
    expect(ownerStoreDest).toEqual({
      href: '/store/admin',
      labelKey: 'store_admin',
    });
  });
});
