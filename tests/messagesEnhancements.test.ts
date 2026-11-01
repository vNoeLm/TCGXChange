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

  it('correctly detects auction cancellation message semantics without false matching on body text', () => {
    const isSellerAction = (body: string) =>
      /auction cancelled|by seller|accepted the hold|declined|rejected|marked as handed over|marked trade cards handed over|seller confirmed|hold released/i.test(body);

    const isBuyerAction = (body: string) =>
      /(?:^|\s)\[?auction won\]?|auction won:|requested a hold|requested bulk|proposed a trade|confirmed receiving|buyer reported/i.test(body);

    const cancelMsg = 'Auction cancelled by seller ("Punch First"). Because the seller did not honor the winning bid of 400 Ft, an automatic 1-star system review has been recorded on the seller\'s profile.';
    const wonMsg = '[Auction Won] Punch First — Winning bid: 400 Ft';
    const releaseMsg = 'Hold released — the card is back in stock.';

    expect(isSellerAction(cancelMsg)).toBe(true);
    expect(isBuyerAction(cancelMsg)).toBe(false);

    expect(isSellerAction(wonMsg)).toBe(false);
    expect(isBuyerAction(wonMsg)).toBe(true);

    expect(isSellerAction(releaseMsg)).toBe(true);
    expect(isBuyerAction(releaseMsg)).toBe(false);
  });

  it('resolves linked hold and correct destination for seller and buyer in cancelled auction messages', () => {
    const threadHolds = [
      {
        id: '96b950cf-4d2d-4fd0-848b-d7004548bf4e',
        seller_id: 'd47ca466-6520-46ec-aff2-718732f1baf7',
        buyer_id: '7cac994f-a9b1-4a8e-aa7c-1176181a7dff',
        order_number: 'P2P-96B950CF',
        card_name: '[Auction] Punch First',
        price_huf: 400,
        status: 'cancelled',
      },
      {
        id: 'old-hold-1',
        seller_id: '7cac994f-a9b1-4a8e-aa7c-1176181a7dff',
        buyer_id: 'd47ca466-6520-46ec-aff2-718732f1baf7',
        order_number: 'P2P-OLD00001',
        card_name: 'Other Card',
        price_huf: 200,
        status: 'completed',
      },
    ];

    const cancelMsgBody =
      'Auction cancelled by seller ("Punch First"). Because the seller did not honor the winning bid of 400 Ft, an automatic 1-star system review has been recorded on the seller\'s profile.';

    // Extract quoted title:
    const quotedMatch = cancelMsgBody.match(/\("([^"]+)"\)/);
    expect(quotedMatch?.[1]).toBe('Punch First');

    const matchedHold = threadHolds.find((h) => {
      const hClean = String(h.card_name || '').replace(/^\[(Auction|Trade|Bulk)\]\s*/i, '').trim().toLowerCase();
      return hClean === quotedMatch![1].trim().toLowerCase();
    });

    expect(matchedHold).toBeDefined();
    expect(matchedHold?.id).toBe('96b950cf-4d2d-4fd0-848b-d7004548bf4e');

    // For seller (TCGXChange: d47ca466)
    const isSellerUser = matchedHold!.seller_id === 'd47ca466-6520-46ec-aff2-718732f1baf7';
    expect(isSellerUser).toBe(true);

    const sellerDest = resolveTransactionDestination({
      isSeller: isSellerUser,
      holdRequestId: matchedHold!.id,
      orderNumber: matchedHold!.order_number,
    });
    expect(sellerDest.labelKey).toBe('seller_hub');
    expect(sellerDest.href).toBe('/seller?hold=96b950cf-4d2d-4fd0-848b-d7004548bf4e&order=P2P-96B950CF');

    // For buyer (cirmi: 7cac994f)
    const isBuyerUser = matchedHold!.seller_id === '7cac994f-a9b1-4a8e-aa7c-1176181a7dff';
    expect(isBuyerUser).toBe(false);

    const buyerDest = resolveTransactionDestination({
      isSeller: isBuyerUser,
      holdRequestId: matchedHold!.id,
      orderNumber: matchedHold!.order_number,
    });
    expect(buyerDest.labelKey).toBe('order_history');
    expect(buyerDest.href).toBe('/profile?order=P2P-96B950CF&hold=96b950cf-4d2d-4fd0-848b-d7004548bf4e#order-history');
  });
});
