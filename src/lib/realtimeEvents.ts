import type { ChatMessage } from '../types';

export type RealtimeEventType =
  | 'chat_message'
  | 'system_notice'
  | 'thread_read'
  | 'hold_changed'
  | 'auction_updated'
  | 'review_created';

export interface RealtimeEventPayload {
  event_id: string;
  type: RealtimeEventType;
  conversation_id?: string | null;
  hold_request_id?: string | null;
  sender_id?: string | null;
  sender_name?: string | null;
  sender_avatar?: string | null;
  message?: ChatMessage | null;
  auction_id?: string | null;
  auction?: Record<string, any> | null;
  previous_bidder_id?: string | null;
  order_number?: string | null;
  rating?: number | null;
  created_at: string;
}

export interface LiveNoticeToast {
  id: string;
  title: string;
  body: string;
  href: string;
  kind: 'message' | 'notice' | 'auction' | 'review';
  conversationId?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
}

export const REALTIME_BROADCAST_EVENT = 'tcg_event';
export const AUCTIONS_REALTIME_TOPIC = 'marketplace:auctions';
export const ACTIVE_THREAD_WINDOW_EVENT = 'tcg-active-conversation';

export function userRealtimeTopic(userId: string): string {
  return `user-events:${userId}`;
}

/**
 * Bounded FIFO set for deduplicating events that may arrive from multiple channels
 * (same-tab local emit, Realtime Broadcast, and postgres_changes).
 */
export function createEventDeduper(maxEntries = 300) {
  const seen = new Set<string>();
  return {
    markIfNew(key: string | null | undefined): boolean {
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > maxEntries) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return true;
    },
    has(key: string): boolean {
      return seen.has(key);
    },
    clear(): void {
      seen.clear();
    },
  };
}

const AUTO_TRIGGERED_SYSTEM_ACTIONS = new Set([
  'auction_won',
  'expired',
  'auto_completed',
]);

/**
 * Determines whether an incoming realtime event should surface a floating toast notice
 * for `myUserId` given their current pathname and open conversation thread.
 */
export function shouldShowLiveNoticeToast(opts: {
  event: RealtimeEventPayload;
  myUserId: string;
  pathname: string;
  activeConversationId?: string | null;
}): boolean {
  const { event, myUserId, pathname, activeConversationId } = opts;
  if (!event || !myUserId) return false;

  if (event.type === 'thread_read' || event.type === 'hold_changed') {
    return false;
  }

  const onMessagesPage = pathname === '/messages' || pathname.startsWith('/messages/');
  const viewingSameThread =
    onMessagesPage &&
    Boolean(event.conversation_id) &&
    Boolean(activeConversationId) &&
    activeConversationId === event.conversation_id;

  if (viewingSameThread) {
    return false;
  }

  if (event.type === 'chat_message') {
    return Boolean(event.sender_id && event.sender_id !== myUserId);
  }

  if (event.type === 'system_notice') {
    const action = event.message?.metadata?.action as string | undefined;
    if (action && AUTO_TRIGGERED_SYSTEM_ACTIONS.has(action)) {
      return true;
    }
    return Boolean(event.sender_id !== myUserId);
  }

  if (event.type === 'auction_updated') {
    if (!event.auction) return false;
    if (event.sender_id === myUserId) return false;
    const isOutbid = event.previous_bidder_id === myUserId;
    const isSellerNewBid =
      event.auction.seller_id === myUserId && event.auction.status === 'active';
    return isOutbid || isSellerNewBid;
  }

  if (event.type === 'review_created') {
    return event.sender_id !== myUserId;
  }

  return false;
}

export function buildLiveNoticeToast(
  event: RealtimeEventPayload,
  myUserId: string,
  lang: 'en' | 'hu' = 'en'
): LiveNoticeToast | null {
  const isHu = lang === 'hu';

  if (event.type === 'chat_message' && event.message) {
    const senderLabel = event.sender_name || (isHu ? 'Új üzenet' : 'New Message');
    const href = event.conversation_id
      ? `/messages?conversation=${encodeURIComponent(event.conversation_id)}`
      : '/messages';
    return {
      id: event.event_id,
      title: senderLabel,
      body: event.message.body || (isHu ? 'Fényképet küldött' : 'Sent a photo'),
      href,
      kind: 'message',
      conversationId: event.conversation_id || null,
      avatarUrl: event.sender_avatar || null,
      createdAt: event.created_at,
    };
  }

  if (event.type === 'system_notice' && event.message) {
    const action = event.message.metadata?.action as string | undefined;
    let title = isHu ? 'Tranzakció értesítés' : 'Transaction Notice';

    switch (action) {
      case 'requested':
        title = isHu ? 'Új foglalási kérés' : 'New Hold Request';
        break;
      case 'trade_proposed':
        title = isHu ? 'Új csereajánlat' : 'New Trade Proposal';
        break;
      case 'auction_won':
        title = isHu ? 'Aukció lezárult' : 'Auction Won';
        break;
      case 'auction_cancelled':
        title = isHu ? 'Aukció törölve' : 'Auction Cancelled';
        break;
      case 'hold':
        title = isHu ? 'Foglalás elfogadva' : 'Hold Accepted';
        break;
      case 'mark_handed_over':
      case 'update_tracking':
        title = isHu ? 'Átadva / Feladva' : 'Handed Over / Sent';
        break;
      case 'confirm_received':
      case 'confirm_sale':
      case 'auto_completed':
        title = isHu ? 'Üzlet teljesítve' : 'Order Update';
        break;
      case 'reject':
      case 'deny':
      case 'release':
        title = isHu ? 'Foglalás frissítés' : 'Hold Update';
        break;
    }

    const href = event.conversation_id
      ? `/messages?conversation=${encodeURIComponent(event.conversation_id)}`
      : '/messages';

    return {
      id: event.event_id,
      title,
      body: event.message.body || '',
      href,
      kind: 'notice',
      conversationId: event.conversation_id || null,
      avatarUrl: event.sender_avatar || null,
      createdAt: event.created_at,
    };
  }

  if (event.type === 'auction_updated' && event.auction) {
    const cardTitle = event.auction.title || (isHu ? 'Aukció' : 'Auction');
    const bidHuf = Number(event.auction.current_bid_huf || 0);
    const formattedBid = bidHuf > 0 ? `${bidHuf.toLocaleString('hu-HU')} Ft` : '';

    if (event.previous_bidder_id === myUserId) {
      return {
        id: event.event_id,
        title: isHu ? 'Túllicitáltak!' : 'You Were Outbid',
        body: formattedBid
          ? `${cardTitle} — ${isHu ? 'új licit:' : 'new highest bid:'} ${formattedBid}`
          : cardTitle,
        href: '/marketplace?tab=auctions',
        kind: 'auction',
        createdAt: event.created_at,
      };
    }

    if (event.auction.seller_id === myUserId) {
      return {
        id: event.event_id,
        title: isHu ? 'Új licit érkezett' : 'New Bid on Your Auction',
        body: formattedBid ? `${cardTitle} — ${formattedBid}` : cardTitle,
        href: '/marketplace?tab=auctions',
        kind: 'auction',
        createdAt: event.created_at,
      };
    }
  }

  if (event.type === 'review_created') {
    const who = event.sender_name || (isHu ? 'Partnered' : 'Your trade partner');
    const stars = event.rating ? ` (${event.rating}/5)` : '';
    return {
      id: event.event_id,
      title: isHu ? 'Új értékelés érkezett' : 'New Trade Review',
      body: isHu
        ? `${who} értékelte a(z) #${event.order_number || ''} rendelést${stars}.`
        : `${who} rated order #${event.order_number || ''}${stars}.`,
      href: '/profile',
      kind: 'review',
      avatarUrl: event.sender_avatar || null,
      createdAt: event.created_at,
    };
  }

  return null;
}
