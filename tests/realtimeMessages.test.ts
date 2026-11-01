import { describe, it, expect } from 'vitest';
import {
  createEventDeduper,
  shouldShowLiveNoticeToast,
  buildLiveNoticeToast,
  userRealtimeTopic,
  type RealtimeEventPayload,
} from '../src/lib/realtimeEvents';

describe('Realtime Messages & Notices', () => {
  it('formats per-user realtime topic consistently', () => {
    expect(userRealtimeTopic('user-123')).toBe('user-events:user-123');
  });

  it('deduplicates repeated event keys and evicts oldest entries once capacity is exceeded', () => {
    const deduper = createEventDeduper(3);

    expect(deduper.markIfNew('chat_message:m1')).toBe(true);
    expect(deduper.markIfNew('chat_message:m1')).toBe(false);

    expect(deduper.markIfNew('chat_message:m2')).toBe(true);
    expect(deduper.markIfNew('chat_message:m3')).toBe(true);
    // Adding m4 should evict m1
    expect(deduper.markIfNew('chat_message:m4')).toBe(true);

    expect(deduper.has('chat_message:m1')).toBe(false);
    expect(deduper.has('chat_message:m2')).toBe(true);
    expect(deduper.markIfNew('chat_message:m1')).toBe(true);
  });

  it('shows chat message toast when viewing another page or another thread, but suppresses on active thread or own message', () => {
    const incomingChat: RealtimeEventPayload = {
      event_id: 'msg-1',
      type: 'chat_message',
      conversation_id: 'conv-abc',
      sender_id: 'user-other',
      sender_name: 'Cirmi',
      message: {
        id: 'msg-1',
        conversation_id: 'conv-abc',
        hold_request_id: null,
        sender_id: 'user-other',
        body: 'Szia, mikor tudjuk atvenni?',
        message_type: 'user',
        metadata: null,
        read_at: null,
        created_at: '2026-11-01T05:00:00.000Z',
      },
      created_at: '2026-11-01T05:00:00.000Z',
    };

    // On catalog -> show toast
    expect(
      shouldShowLiveNoticeToast({
        event: incomingChat,
        myUserId: 'user-me',
        pathname: '/',
        activeConversationId: null,
      })
    ).toBe(true);

    // On /messages viewing a DIFFERENT conversation -> show toast
    expect(
      shouldShowLiveNoticeToast({
        event: incomingChat,
        myUserId: 'user-me',
        pathname: '/messages',
        activeConversationId: 'conv-other',
      })
    ).toBe(true);

    // On /messages actively viewing conv-abc -> suppress toast
    expect(
      shouldShowLiveNoticeToast({
        event: incomingChat,
        myUserId: 'user-me',
        pathname: '/messages',
        activeConversationId: 'conv-abc',
      })
    ).toBe(false);

    // Own sent message -> suppress toast
    expect(
      shouldShowLiveNoticeToast({
        event: incomingChat,
        myUserId: 'user-other',
        pathname: '/',
        activeConversationId: null,
      })
    ).toBe(false);
  });

  it('notifies both winner and seller on auto-finalized auction_won system notices', () => {
    const auctionWonNotice: RealtimeEventPayload = {
      event_id: 'sys-1',
      type: 'system_notice',
      conversation_id: 'conv-win',
      sender_id: 'buyer-1',
      message: {
        id: 'sys-1',
        conversation_id: 'conv-win',
        hold_request_id: 'hold-99',
        sender_id: 'buyer-1',
        body: 'Auction won for "Punch First" at 400 Ft.',
        message_type: 'system',
        metadata: {
          action: 'auction_won',
          kind: 'auction',
          seller_id: 'seller-1',
          buyer_id: 'buyer-1',
        },
        read_at: null,
        created_at: '2026-11-01T05:10:00.000Z',
      },
      created_at: '2026-11-01T05:10:00.000Z',
    };

    expect(
      shouldShowLiveNoticeToast({
        event: auctionWonNotice,
        myUserId: 'buyer-1',
        pathname: '/marketplace',
      })
    ).toBe(true);

    expect(
      shouldShowLiveNoticeToast({
        event: auctionWonNotice,
        myUserId: 'seller-1',
        pathname: '/seller',
      })
    ).toBe(true);
  });

  it('targets auction bid notices only to outbid user and seller', () => {
    const bidEvent: RealtimeEventPayload = {
      event_id: 'bid-1',
      type: 'auction_updated',
      auction_id: 'auc-1',
      previous_bidder_id: 'user-prev',
      sender_id: 'user-new-bidder',
      auction: {
        id: 'auc-1',
        title: 'Punch First',
        seller_id: 'user-seller',
        status: 'active',
        current_bid_huf: 1500,
      },
      created_at: '2026-11-01T05:15:00.000Z',
    };

    // Outbid user gets notified
    expect(
      shouldShowLiveNoticeToast({
        event: bidEvent,
        myUserId: 'user-prev',
        pathname: '/',
      })
    ).toBe(true);
    const outbidToast = buildLiveNoticeToast(bidEvent, 'user-prev', 'hu');
    expect(outbidToast?.title).toBe('Túllicitáltak!');
    expect(outbidToast?.href).toBe('/marketplace?tab=auctions');

    // Seller gets notified
    expect(
      shouldShowLiveNoticeToast({
        event: bidEvent,
        myUserId: 'user-seller',
        pathname: '/seller',
      })
    ).toBe(true);
    const sellerToast = buildLiveNoticeToast(bidEvent, 'user-seller', 'en');
    expect(sellerToast?.title).toBe('New Bid on Your Auction');

    // Bidder themselves does not get self-notified
    expect(
      shouldShowLiveNoticeToast({
        event: bidEvent,
        myUserId: 'user-new-bidder',
        pathname: '/marketplace',
      })
    ).toBe(false);

    // Unrelated user does not get notified
    expect(
      shouldShowLiveNoticeToast({
        event: bidEvent,
        myUserId: 'user-bystander',
        pathname: '/marketplace',
      })
    ).toBe(false);
  });

  it('builds localized toast payloads for system notices and trade reviews', () => {
    const holdEvt: RealtimeEventPayload = {
      event_id: 'sys-hold',
      type: 'system_notice',
      conversation_id: 'conv-42',
      sender_id: 'buyer-1',
      message: {
        id: 'sys-hold',
        conversation_id: 'conv-42',
        hold_request_id: 'hold-42',
        sender_id: 'buyer-1',
        body: 'Requested a hold on Ahri (1,200 Ft).',
        message_type: 'system',
        metadata: { action: 'requested' },
        read_at: null,
        created_at: '2026-11-01T05:20:00.000Z',
      },
      created_at: '2026-11-01T05:20:00.000Z',
    };

    const huToast = buildLiveNoticeToast(holdEvt, 'seller-1', 'hu');
    expect(huToast?.title).toBe('Új foglalási kérés');
    expect(huToast?.href).toBe('/messages?conversation=conv-42');

    const reviewEvt: RealtimeEventPayload = {
      event_id: 'rev-1',
      type: 'review_created',
      sender_id: 'buyer-1',
      sender_name: 'Cirmi',
      order_number: 'P2P-11AA22BB',
      rating: 5,
      created_at: '2026-11-01T05:25:00.000Z',
    };

    const enReview = buildLiveNoticeToast(reviewEvt, 'seller-1', 'en');
    expect(enReview?.title).toBe('New Trade Review');
    expect(enReview?.body).toContain('Cirmi');
    expect(enReview?.body).toContain('#P2P-11AA22BB');
    expect(enReview?.href).toBe('/profile');
  });
});
