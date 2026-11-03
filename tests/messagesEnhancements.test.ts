import { describe, expect, it } from 'vitest';
import {
  computeLatestActivityAt,
  isConversationHidden,
  resolveTransactionDestination,
  extractOrderKey,
  consolidateConversationMessages,
  localizeNoticeBody,
} from '../src/lib/messages';
import type { ChatMessage } from '../src/types';

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

  it('filters out redundant hold release messages when auction cancellation message exists', () => {
    const rawMessages = [
      {
        id: 'msg-won',
        conversation_id: 'conv-1',
        message_type: 'system',
        body: '[Auction Won] Punch First — Winning bid: 400 Ft',
        hold_request_id: 'hold-1',
        created_at: '2026-10-31T20:00:00.000Z',
      },
      {
        id: 'msg-cancel',
        conversation_id: 'conv-1',
        message_type: 'system',
        body: 'Auction cancelled by seller ("Punch First"). Because the seller did not honor the winning bid of 400 Ft, an automatic 1-star system review has been recorded on the seller\'s profile.',
        hold_request_id: 'hold-1',
        metadata: { action: 'auction_cancelled', hold_request_id: 'hold-1', order_number: 'P2P-96B950CF' },
        created_at: '2026-10-31T22:36:00.000Z',
      },
      {
        id: 'msg-release',
        conversation_id: 'conv-1',
        message_type: 'system',
        body: 'Hold released — the card is back in stock.',
        hold_request_id: 'hold-1',
        metadata: { action: 'release', hold_request_id: 'hold-1', order_number: 'P2P-96B950CF' },
        created_at: '2026-10-31T22:36:01.000Z',
      },
    ];

    const cancelHoldIds = new Set<string>();
    const cancelOrderNums = new Set<string>();
    const cancelTimestamps: number[] = [];

    for (const m of rawMessages) {
      const isCancel =
        m.metadata?.action === 'auction_cancelled' ||
        /auction cancelled/i.test(m.body || '');
      if (isCancel) {
        const hId = m.hold_request_id || m.metadata?.hold_request_id;
        if (hId) cancelHoldIds.add(String(hId));
        const ordMatch = (m.body || '').match(/#?(P2P-[A-Z0-9]+)/i);
        const oNum = m.metadata?.order_number || (ordMatch ? ordMatch[1].toUpperCase() : null);
        if (oNum) cancelOrderNums.add(oNum);
        cancelTimestamps.push(new Date(m.created_at).getTime());
      }
    }

    const filtered = rawMessages.filter((m) => {
      const isRelease =
        (m.metadata?.action === 'release' || /hold released — the card is back in stock/i.test(m.body || '')) &&
        m.message_type === 'system';

      if (isRelease) {
        const hId = m.hold_request_id || m.metadata?.hold_request_id;
        if (hId && cancelHoldIds.has(String(hId))) return false;
        const ordMatch = (m.body || '').match(/#?(P2P-[A-Z0-9]+)/i);
        const oNum = m.metadata?.order_number || (ordMatch ? ordMatch[1].toUpperCase() : null);
        if (oNum && cancelOrderNums.has(oNum)) return false;
        const mTime = new Date(m.created_at).getTime();
        if (cancelTimestamps.some((t) => Math.abs(t - mTime) <= 10 * 60 * 1000)) {
          return false;
        }
      }
      return true;
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.map((m) => m.id)).toEqual(['msg-won', 'msg-cancel']);
  });

  it('extractOrderKey correctly associates hold requests, order numbers, and store orders', () => {
    const threadHolds = [
      {
        id: 'hold-1234',
        order_number: 'P2P-66148473',
        card_name: 'Seraphine - Not Alone',
      },
    ];

    const sysMsgWithHoldId: ChatMessage = {
      id: 'm-1',
      conversation_id: 'c-1',
      sender_id: 'u-1',
      body: 'Hold requested',
      message_type: 'system',
      hold_request_id: 'hold-1234',
      metadata: null,
      read_at: null,
      created_at: '2026-11-03T08:00:00Z',
    };
    expect(extractOrderKey(sysMsgWithHoldId, threadHolds)).toBe('hold:hold-1234');

    const sysMsgWithOrderNum: ChatMessage = {
      id: 'm-2',
      conversation_id: 'c-1',
      sender_id: 'u-2',
      body: 'Piactéri félretétel #P2P-66148473',
      message_type: 'system',
      hold_request_id: null,
      metadata: { order_number: 'P2P-66148473' },
      read_at: null,
      created_at: '2026-11-03T08:05:00Z',
    };
    expect(extractOrderKey(sysMsgWithOrderNum, threadHolds)).toBe('hold:hold-1234');

    const storeMsg: ChatMessage = {
      id: 'm-store',
      conversation_id: 'c-1',
      sender_id: 'u-admin',
      body: 'Store Order #ORD-2026-999',
      message_type: 'system',
      hold_request_id: null,
      metadata: { store_order: true, order_number: 'ORD-2026-999' },
      read_at: null,
      created_at: '2026-11-03T08:10:00Z',
    };
    expect(extractOrderKey(storeMsg, threadHolds)).toBe('store:ORD-2026-999');

    const chatMsg: ChatMessage = {
      id: 'm-chat',
      conversation_id: 'c-1',
      sender_id: 'u-1',
      body: 'Hello, can you ship it today?',
      message_type: 'user',
      hold_request_id: null,
      metadata: null,
      read_at: null,
      created_at: '2026-11-03T08:15:00Z',
    };
    expect(extractOrderKey(chatMsg, threadHolds)).toBeNull();
  });

  it('consolidates multiple status messages for the same order into strictly 1 container', () => {
    const raw: ChatMessage[] = [
      {
        id: 'msg-1-req',
        conversation_id: 'c-1',
        sender_id: 'buyer-1',
        message_type: 'system',
        body: 'Requested a hold on Seraphine - Not Alone — 1200 Ft · Személyes átvétel',
        hold_request_id: 'hold-p2p-66148473',
        metadata: {
          action: 'requested',
          hold_request_id: 'hold-p2p-66148473',
          card_name: 'Seraphine - Not Alone',
          image_path: '/cards/seraphine.jpg',
          items: [
            {
              card_name: 'Seraphine - Not Alone',
              price_huf: 1200,
              quantity: 1,
              condition: 'Near Mint',
            },
          ],
          price_huf: 1200,
          handover: 'in_person',
          handover_details: 'Budapest, Blaha',
        },
        read_at: null,
        created_at: '2026-11-03T08:19:00Z',
      },
      {
        id: 'msg-user-chat-1',
        conversation_id: 'c-1',
        sender_id: 'buyer-1',
        message_type: 'user',
        body: 'Hi, I would like to pick this up today!',
        hold_request_id: null,
        metadata: null,
        read_at: null,
        created_at: '2026-11-03T08:19:10Z',
      },
      {
        id: 'msg-2-accept',
        conversation_id: 'c-1',
        sender_id: 'seller-1',
        message_type: 'system',
        body: 'Accepted the hold — this card is reserved.',
        hold_request_id: 'hold-p2p-66148473',
        metadata: {
          action: 'hold',
          hold_request_id: 'hold-p2p-66148473',
        },
        read_at: null,
        created_at: '2026-11-03T08:19:20Z',
      },
      {
        id: 'msg-3-handover',
        conversation_id: 'c-1',
        sender_id: 'seller-1',
        message_type: 'system',
        body: 'Átadottnak / feladottnak jelölve. The buyer has 3 days to confirm or deny before it auto-completes.',
        hold_request_id: 'hold-p2p-66148473',
        metadata: {
          action: 'mark_handed_over',
          hold_request_id: 'hold-p2p-66148473',
          tracking_number: 'FOXPOST-987654',
        },
        read_at: null,
        created_at: '2026-11-03T08:19:30Z',
      },
      {
        id: 'msg-other-order',
        conversation_id: 'c-1',
        sender_id: 'seller-1',
        message_type: 'system',
        body: 'Sale completed!',
        hold_request_id: 'hold-p2p-396722',
        metadata: {
          action: 'confirm_sale',
          hold_request_id: 'hold-p2p-396722',
          completed: true,
          items: [{ card_name: 'Other Card', price_huf: 1200 }],
        },
        read_at: null,
        created_at: '2026-11-03T08:19:40Z',
      },
    ];

    const consolidated = consolidateConversationMessages(raw, {
      threadHolds: [
        { id: 'hold-p2p-66148473', order_number: 'P2P-66148473' },
        { id: 'hold-p2p-396722', order_number: 'P2P-396722-503' },
      ],
    });

    // Expect 3 messages:
    // 1. msg-user-chat-1 (preserved in place)
    // 2. consolidated hold-p2p-66148473 container (at latest position msg-3-handover)
    // 3. msg-other-order container
    expect(consolidated).toHaveLength(3);

    expect(consolidated[0].id).toBe('msg-user-chat-1');
    expect(consolidated[0].body).toBe('Hi, I would like to pick this up today!');

    const order1Card = consolidated[1];
    expect(order1Card.id).toBe('msg-3-handover');
    expect(order1Card.hold_request_id).toBe('hold-p2p-66148473');
    // Rich details preserved from msg-1-req:
    expect(order1Card.metadata?.items).toHaveLength(1);
    expect(order1Card.metadata?.items[0].card_name).toBe('Seraphine - Not Alone');
    expect(order1Card.metadata?.handover).toBe('in_person');
    expect(order1Card.metadata?.price_huf).toBe(1200);
    // Latest state merged from msg-3-handover:
    expect(order1Card.metadata?.action).toBe('mark_handed_over');
    expect(order1Card.metadata?.tracking_number).toBe('FOXPOST-987654');
    expect(order1Card.body).toBe(
      'Átadottnak / feladottnak jelölve. The buyer has 3 days to confirm or deny before it auto-completes.'
    );

    const order2Card = consolidated[2];
    expect(order2Card.id).toBe('msg-other-order');
    expect(order2Card.hold_request_id).toBe('hold-p2p-396722');
  });

  it('localizes status notice bodies cleanly to Hungarian', () => {
    expect(localizeNoticeBody('Accepted the hold — this card is reserved.', 'hu')).toBe(
      'Félretétel elfogadva — a kártya lefoglalva.'
    );

    expect(
      localizeNoticeBody(
        'Átadottnak / feladottnak jelölve. The buyer has 3 days to confirm or deny before it auto-completes.',
        'hu'
      )
    ).toBe(
      'Átadottnak / feladottnak jelölve. A vevőnek 3 napja van jóváhagyni az automatikus lezárás előtt.'
    );

    expect(
      localizeNoticeBody(
        'Marked as handed over / sent (Tracking: GL12345). The buyer has 3 days to confirm or deny before it auto-completes.',
        'hu'
      )
    ).toBe(
      'Átadottnak / feladottnak jelölve (Csomagkövetés: GL12345). A vevőnek 3 napja van jóváhagyni az automatikus lezárás előtt.'
    );

    expect(localizeNoticeBody('Received the card — sale completed!', 'hu')).toBe(
      'Kártya átvéve — adásvétel sikeresen lezárult!'
    );

    // Preserves English when lang !== 'hu'
    expect(localizeNoticeBody('Accepted the hold — this card is reserved.', 'en')).toBe(
      'Accepted the hold — this card is reserved.'
    );
  });
});
