import { supabase } from './supabase';
import { getCurrentUser } from './auth';
const OPEN_HOLD_STATUSES: ReadonlyArray<string> = ['pending', 'held', 'handed_over', 'buyer_received'];
import type { ChatMessage, ConversationSummary } from '../types';
import { sanitizePlainText } from './sanitize';
import { broadcastClientRealtime, emitLocalRealtimeEvent } from './realtimeClient';
import type { RealtimeEventPayload } from './realtimeEvents';

export const MAX_MESSAGE_LENGTH = 2000;
export const CHAT_IMAGE_EXPIRY_DAYS = 14;

const HIDDEN_STORAGE_PREFIX = 'tcg_hidden_conversations_';

/**
 * Returns the latest valid ISO timestamp among a list of candidate timestamps,
 * or null if none are valid.
 */
export function computeLatestActivityAt(timestamps: Array<string | null | undefined>): string | null {
  let bestIso: string | null = null;
  let bestMs = -Infinity;
  for (const ts of timestamps) {
    if (!ts) continue;
    const ms = Date.parse(ts);
    if (!Number.isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      bestIso = ts;
    }
  }
  return bestIso;
}

/**
 * Pure check for whether a conversation is currently hidden.
 * A conversation stays hidden only while its latest activity/transaction timestamp
 * is at or before the moment the user hid it. As soon as a new hold, trade, bulk,
 * auction, or message occurs after `hiddenAt`, this returns false so the thread
 * automatically reappears.
 */
export function isConversationHidden(
  conversationId: string,
  latestActivityIso: string | null | undefined,
  hiddenMap: Record<string, string | null | undefined>
): boolean {
  const hiddenAt = hiddenMap?.[conversationId];
  if (!hiddenAt) return false;
  const hiddenMs = Date.parse(hiddenAt);
  if (Number.isNaN(hiddenMs)) return false;
  if (!latestActivityIso) return true;
  const activityMs = Date.parse(latestActivityIso);
  if (Number.isNaN(activityMs)) return true;
  return activityMs <= hiddenMs;
}

/**
 * Resolves the click-through destination for a transaction system card in chat:
 * - Buyers open `/profile?...#order-history` with that order expanded.
 * - Marketplace sellers open `/seller?...`, which routes to Active Holds or Sales History.
 * - Official store owner opens `/store/admin` for official retail orders.
 */
export function resolveTransactionDestination(opts: {
  isSeller: boolean;
  isStoreOrder?: boolean;
  isStoreOwner?: boolean;
  holdRequestId?: string | null;
  orderNumber?: string | null;
}): { href: string; labelKey: 'order_history' | 'seller_hub' | 'store_admin' } {
  const { isSeller, isStoreOrder = false, isStoreOwner = false, holdRequestId, orderNumber } = opts;

  if (isStoreOrder && isStoreOwner) {
    return { href: '/store/admin', labelKey: 'store_admin' };
  }

  if (isSeller && !isStoreOrder) {
    const params = new URLSearchParams();
    if (holdRequestId) params.set('hold', holdRequestId);
    if (orderNumber) params.set('order', orderNumber);
    const qs = params.toString();
    return {
      href: `/seller${qs ? `?${qs}` : ''}`,
      labelKey: 'seller_hub',
    };
  }

  const params = new URLSearchParams();
  if (orderNumber) params.set('order', orderNumber);
  if (holdRequestId) params.set('hold', holdRequestId);
  const qs = params.toString();
  return {
    href: `/profile${qs ? `?${qs}` : ''}#order-history`,
    labelKey: 'order_history',
  };
}

/**
 * Localizes system notice texts to Hungarian when lang === 'hu'.
 */
export function localizeNoticeBody(body: string, lang: string = 'en'): string {
  if (!body || lang !== 'hu') return body;

  let text = body;

  // Initial requests / proposals
  text = text.replace(/^Proposed a trade:\s*(.+?)\s+for\s+(.+)$/i, 'Csereajánlat küldve: $1 ⇄ $2');
  text = text.replace(/^Requested a hold on\s+(.+)$/i, 'Félretételi kérelem: $1');

  // Hold acceptance
  text = text.replace(/^Accepted the hold — this card is reserved\.?$/i, 'Félretétel elfogadva — a kártya lefoglalva.');
  text = text.replace(/^Accepted the hold request\.?(.*)$/i, 'Félretétel elfogadva.$1');

  // Rejections and cancellations
  text = text.replace(/^Declined the hold request\.?(.*)$/i, 'Félretételi kérelem elutasítva.$1');
  text = text.replace(/^Hold request rejected\.?$/i, 'Félretételi kérelem elutasítva.');
  text = text.replace(/^Trade proposal declined — listing returned to marketplace\.?$/i, 'Csereajánlat elutasítva — a tétel visszakerült a piactérre.');
  text = text.replace(/^Hold released — the card is back in stock\.?$/i, 'Félretétel feloldva — a tétel újra elérhető.');
  text = text.replace(/^Trade hold released — listing returned to marketplace\.?$/i, 'Cserezárolás feloldva — a tétel visszakerült a piactérre.');
  text = text.replace(/^Auction cancelled by seller\.?(.*)$/i, 'Az aukciót az eladó törölte.$1');
  text = text.replace(
    /^Hold request expired after (\d+) hours without a seller response\. The cards were released back to the seller\.?$/i,
    'A félretételi kérelem $1 óra után válasz hiányában lejárt. A kártyák visszakerültek az eladóhoz.'
  );
  text = text.replace(/^Buyer reported they did not receive the card — hold cancelled\.?$/i, 'A vevő jelezte, hogy nem kapta meg a kártyát — félretétel törölve.');
  text = text.replace(/^Seller reported the card was not handed over — hold cancelled\.?$/i, 'Az eladó jelezte, hogy a kártya nem került átadásra — félretétel törölve.');
  text = text.replace(/^Trader reported cards were not exchanged — trade cancelled\.?$/i, 'A cserepartner jelezte, hogy a csere meghiúsult — csere törölve.');
  text = text.replace(/^Trader reported exchange could not proceed — trade cancelled\.?$/i, 'A csere nem tudott megvalósulni — csere törölve.');

  // Handover / Sent (including mixed Hungarian/English status logs)
  text = text.replace(
    /^(?:Átadottnak \/ feladottnak jelölve\.\s*)?(?:Marked as handed over \/ sent)?(?:\s*\(Tracking:\s*([^)]+)\))?\.?\s*The buyer has 3 days to confirm or deny before it auto-completes\.?$/i,
    (_match, tr) => tr
      ? `Átadottnak / feladottnak jelölve (Csomagkövetés: ${tr}). A vevőnek 3 napja van jóváhagyni az automatikus lezárás előtt.`
      : 'Átadottnak / feladottnak jelölve. A vevőnek 3 napja van jóváhagyni az automatikus lezárás előtt.'
  );
  text = text.replace(
    /^Marked trade cards handed over \/ sent(?:\s*\(Tracking:\s*([^)]+)\))?\.?\s*Proposer has 3 days to confirm\.?$/i,
    (_match, tr) => tr
      ? `Cserekártyák átadottnak / feladottnak jelölve (Csomagkövetés: ${tr}). A partnernek 3 napja van jóváhagyni.`
      : 'Cserekártyák átadottnak / feladottnak jelölve. A partnernek 3 napja van jóváhagyni.'
  );

  // Receipts and completion
  text = text.replace(/^Confirmed receiving the card — waiting for seller OK or denial \(auto-completes in 3 days\)\.?$/i, 'Átvétel megerősítve — várakozás az eladó jóváhagyására (3 napon belül automatikusan lezárul).');
  text = text.replace(/^Confirmed receiving trade cards — waiting for trader final confirmation\.?$/i, 'Cserekártyák átvétele megerősítve — várakozás a partner végleges jóváhagyására.');
  text = text.replace(/^Received the card — sale completed!?$/i, 'Kártya átvéve — adásvétel sikeresen lezárult!');
  text = text.replace(/^Received trade cards — trade completed successfully!?$/i, 'Cserekártyák átvéve — csere sikeresen lezárult!');
  text = text.replace(/^Trade completed successfully!?$/i, 'Csere sikeresen lezárult!');
  text = text.replace(/^Seller confirmed handover — sale completed!?$/i, 'Eladó jóváhagyta az átadást — adásvétel sikeresen lezárult!');
  text = text.replace(/^Sale completed\.?(.*)$/i, 'Adásvétel lezárult.$1');
  text = text.replace(/^No response within \d+ days of handover — sale completed!?$/i, 'Nem érkezett visszajelzés az átadás után 3 napon belül — adásvétel lezárult!');
  text = text.replace(/^No response from buyer within 3 days — order auto-completed!?$/i, 'A vevő nem válaszolt 3 napon belül — a rendelés automatikusan lezárult!');
  text = text.replace(/^No response from seller within 3 days — order auto-completed!?$/i, 'Az eladó nem válaszolt 3 napon belül — a rendelés automatikusan lezárult!');

  // Tracking update
  text = text.replace(/^Tracking number added:\s*(.+)$/i, 'Csomagkövetési szám hozzáadva: $1');

  return text;
}

export interface ConsolidateConversationMessagesOptions {
  threadHolds?: any[];
  threadOrders?: any[];
}

/**
 * Extracts a canonical order grouping key from a system or legacy transaction message.
 * Returns null if the message is a normal user chat message that shouldn't be consolidated.
 */
export function extractOrderKey(
  m: ChatMessage,
  threadHolds: any[] = [],
  threadOrders: any[] = []
): string | null {
  const isLegacyTxPrefix =
    m.message_type === 'user' &&
    /^\[(Trade Proposal|Bulk Hold Request|Auction Won)\]/i.test(m.body || '');

  if (m.message_type !== 'system' && !isLegacyTxPrefix) {
    return null;
  }

  // 1. Official Store Order
  if (m.metadata?.store_order) {
    const orderNum =
      m.metadata?.order_number ||
      (m.body || '').match(/#?(ORD-[A-Z0-9]+)/i)?.[1]?.toUpperCase();
    return orderNum ? `store:${orderNum}` : `store:${m.id}`;
  }

  // 2. Direct hold request id in message or metadata
  const holdId = m.hold_request_id || m.metadata?.hold_request_id;
  if (holdId) {
    return `hold:${String(holdId)}`;
  }

  // 3. Order number in metadata or body (e.g. #P2P-66148473 or #TEST-HOLD-01)
  const ordMatch = (m.body || '').match(/#?((?:P2P|ORD|TEST)-[A-Z0-9-]+)/i);
  const orderNum = m.metadata?.order_number || (ordMatch ? ordMatch[1].toUpperCase() : null);
  if (orderNum) {
    const matchedHold = threadHolds.find(
      (h) =>
        h.order_number === orderNum ||
        `P2P-${String(h.id).slice(0, 8).toUpperCase()}` === orderNum
    );
    if (matchedHold?.id) {
      return `hold:${String(matchedHold.id)}`;
    }
    return `order:${orderNum}`;
  }

  // 4. Exact message match in thread holds
  const exactHold = threadHolds.find((h) => h.message && h.message === m.body);
  if (exactHold?.id) {
    return `hold:${String(exactHold.id)}`;
  }

  // 5. Trade card pair matching (e.g. Mirror Image ⇄ Encore)
  const isTradeMsg =
    (isLegacyTxPrefix && /^\[Trade Proposal\]/i.test(m.body || '')) ||
    m.metadata?.kind === 'trade' ||
    /proposed a trade/i.test(m.body || '');
  if (isTradeMsg) {
    const matchedTrade = threadHolds.find((h) => {
      const isTradeHold = h.card_number === 'TRADE' || String(h.card_name || '').startsWith('[Trade]');
      if (!isTradeHold) return false;
      const clean = String(h.card_name || '').replace(/^\[Trade\]\s*/i, '');
      if (clean.includes('⇄')) {
        const [s1, s2] = clean.split('⇄').map((s) => s.trim().toLowerCase());
        const bLow = (m.body || '').toLowerCase();
        return s1 && s2 && bLow.includes(s1) && bLow.includes(s2);
      }
      return false;
    });
    if (matchedTrade?.id) {
      return `hold:${String(matchedTrade.id)}`;
    }
  }

  // 6. Quoted card title in body: ("Punch First")
  const quotedMatch = (m.body || '').match(/\("([^"]+)"\)/);
  if (quotedMatch) {
    const quotedTitle = quotedMatch[1].trim().toLowerCase();
    const matched = threadHolds.find((h) => {
      const hClean = String(h.card_name || '').replace(/^\[(Auction|Trade|Bulk)\]\s*/i, '').trim().toLowerCase();
      if (hClean === quotedTitle || hClean.includes(quotedTitle) || quotedTitle.includes(hClean)) return true;
      if (Array.isArray(h.items)) {
        return h.items.some((it: any) => String(it.card_name || '').trim().toLowerCase() === quotedTitle);
      }
      return false;
    });
    if (matched?.id) return `hold:${String(matched.id)}`;
  }

  // 7. Card name substring match in body
  const subHold = threadHolds.find((h) => {
    const raw = String(h.card_name || '');
    const hClean = raw.replace(/^\[(Auction|Trade|Bulk)\]\s*/i, '').trim();
    if (hClean.includes('⇄')) {
      const [s1, s2] = hClean.split('⇄').map((s) => s.trim().toLowerCase());
      const bLow = (m.body || '').toLowerCase();
      return s1 && s2 && bLow.includes(s1) && bLow.includes(s2);
    }
    return hClean.length >= 3 && (m.body || '').toLowerCase().includes(hClean.toLowerCase());
  });
  if (subHold?.id) {
    return `hold:${String(subHold.id)}`;
  }

  // 8. Single hold in thread fallback - only if transaction types match
  if (threadHolds.length === 1 && threadHolds[0]?.id) {
    const only = threadHolds[0];
    const isTradeHold = only.card_number === 'TRADE' || (only.card_name || '').startsWith('[Trade]');
    const isAuctionHold = only.card_number === 'AUCTION' || (only.card_name || '').startsWith('[Auction]');
    const isAuctionMsg = (isLegacyTxPrefix && /^\[Auction Won\]/i.test(m.body || '')) || m.metadata?.kind === 'auction';

    if (isTradeMsg === isTradeHold && isAuctionMsg === isAuctionHold) {
      return `hold:${String(only.id)}`;
    }
  }

  // Fallback to distinct system notice
  return `sys:${m.id}`;
}

/**
 * Consolidates multiple system messages for the same order into strictly 1 container per order,
 * dynamically updated to reflect the latest order state, while preserving ordinary chat messages.
 */
export function consolidateConversationMessages(
  messages: ChatMessage[],
  opts: ConsolidateConversationMessagesOptions = {}
): ChatMessage[] {
  const { threadHolds = [], threadOrders = [] } = opts;

  // Step 1: Filter out redundant "Hold released — the card is back in stock" messages when an auction cancellation message exists
  const cancelHoldIds = new Set<string>();
  const cancelOrderNums = new Set<string>();
  const cancelTimestamps: number[] = [];

  for (const m of messages) {
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

  const uncancelled = messages.filter((m) => {
    const isRelease =
      (m.metadata?.action === 'release' || /hold released — the card is back in stock/i.test(m.body || '')) &&
      (m.message_type === 'system' || !m.message_type);

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

  // Step 2: Identify order keys for each message
  const msgKeys = uncancelled.map((m) => extractOrderKey(m, threadHolds, threadOrders));

  // Record the latest index and list of messages for each order key
  const lastIndexByKey = new Map<string, number>();
  const groupsByKey = new Map<string, ChatMessage[]>();

  msgKeys.forEach((key, idx) => {
    if (!key || key.startsWith('sys:')) return;
    lastIndexByKey.set(key, idx);
    const existing = groupsByKey.get(key) || [];
    existing.push(uncancelled[idx]);
    groupsByKey.set(key, existing);
  });

  // Step 3: Build consolidated message list (1 container per order, at the latest update position)
  const result: ChatMessage[] = [];

  for (let i = 0; i < uncancelled.length; i++) {
    const m = uncancelled[i];
    const key = msgKeys[i];

    // Regular chat messages and unkeyed standalone system messages stay in place
    if (!key || key.startsWith('sys:')) {
      result.push(m);
      continue;
    }

    const lastIdx = lastIndexByKey.get(key);
    // If this is NOT the last occurrence of this order, collapse it (omit earlier duplicates)
    if (i !== lastIdx) {
      continue;
    }

    // This IS the last occurrence: consolidate group into 1 dynamic card
    const group = groupsByKey.get(key) || [m];
    if (group.length <= 1) {
      result.push(m);
      continue;
    }

    // Identify the message with richest details (e.g. items, images, handover from initial hold request)
    const richestMsg =
      group.find((item) => Array.isArray(item.metadata?.items) && item.metadata.items.length > 0) ||
      group.find((item) => item.metadata?.image_path || item.metadata?.price_huf !== undefined) ||
      group[0];

    const lastMsg = group[group.length - 1];

    // Merge metadata chronologically
    let mergedMeta: Record<string, any> = {};
    for (const item of group) {
      if (item.metadata) {
        mergedMeta = { ...mergedMeta, ...item.metadata };
      }
    }

    // Preserve rich items and specifics from richestMsg if missing in mergedMeta
    if (richestMsg.metadata?.items && (!mergedMeta.items || mergedMeta.items.length === 0)) {
      mergedMeta.items = richestMsg.metadata.items;
    }
    if (richestMsg.metadata?.image_path && !mergedMeta.image_path) {
      mergedMeta.image_path = richestMsg.metadata.image_path;
    }
    if (richestMsg.metadata?.card_name && !mergedMeta.card_name) {
      mergedMeta.card_name = richestMsg.metadata.card_name;
    }
    if (richestMsg.metadata?.handover && !mergedMeta.handover) {
      mergedMeta.handover = richestMsg.metadata.handover;
    }
    if (richestMsg.metadata?.handover_details && !mergedMeta.handover_details) {
      mergedMeta.handover_details = richestMsg.metadata.handover_details;
    }
    if (richestMsg.metadata?.price_huf !== undefined && mergedMeta.price_huf === undefined) {
      mergedMeta.price_huf = richestMsg.metadata.price_huf;
    }
    if (richestMsg.metadata?.shipping_huf !== undefined && mergedMeta.shipping_huf === undefined) {
      mergedMeta.shipping_huf = richestMsg.metadata.shipping_huf;
    }
    if (richestMsg.metadata?.seller_id && !mergedMeta.seller_id) {
      mergedMeta.seller_id = richestMsg.metadata.seller_id;
    }
    if (richestMsg.metadata?.buyer_id && !mergedMeta.buyer_id) {
      mergedMeta.buyer_id = richestMsg.metadata.buyer_id;
    }

    // Always apply the latest state from the last message
    if (lastMsg.metadata?.action) {
      mergedMeta.action = lastMsg.metadata.action;
    }
    if (lastMsg.metadata?.status) {
      mergedMeta.status = lastMsg.metadata.status;
    }
    if (lastMsg.metadata?.tracking_number) {
      mergedMeta.tracking_number = lastMsg.metadata.tracking_number;
    }
    if (lastMsg.metadata?.completed !== undefined) {
      mergedMeta.completed = lastMsg.metadata.completed;
    }

    const consolidated: ChatMessage = {
      ...lastMsg,
      message_type: 'system',
      hold_request_id: lastMsg.hold_request_id || richestMsg.hold_request_id || null,
      body: lastMsg.body,
      metadata: mergedMeta,
    };

    result.push(consolidated);
  }

  return result;
}

function readHiddenConversationsMap(
  uid: string,
  metaMap?: Record<string, any> | null
): Record<string, string> {
  const merged: Record<string, string> = {};
  if (metaMap && typeof metaMap === 'object') {
    for (const [k, v] of Object.entries(metaMap)) {
      if (typeof v === 'string') merged[k] = v;
    }
  }
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(`${HIDDEN_STORAGE_PREFIX}${uid}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') merged[k] = v;
          }
        }
      }
    } catch {
      // Ignore storage read errors
    }
  }
  return merged;
}

function writeHiddenConversationsMap(
  uid: string,
  map: Record<string, string>,
  syncRemote = true
): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`${HIDDEN_STORAGE_PREFIX}${uid}`, JSON.stringify(map));
    } catch {
      // Ignore quota / private browsing errors
    }
  }
  if (syncRemote) {
    const remoteClean: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      if (v) remoteClean[k] = v;
    }
    supabase.auth.updateUser({ data: { hidden_conversations: remoteClean } }).catch(() => {});
  }
}

/**
 * Temporarily hides a conversation from the user's Messages inbox until new activity
 * or a new transaction occurs in that thread.
 */
export async function hideConversation(
  conversationId: string,
  latestActivityIso?: string | null
): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must be signed in to use messages.');
  const map = readHiddenConversationsMap(user.id, user.user_metadata?.hidden_conversations);
  const latestMs = latestActivityIso ? Date.parse(latestActivityIso) : NaN;
  const effectiveMs = !Number.isNaN(latestMs) ? Math.max(Date.now(), latestMs) : Date.now();
  const hiddenAtIso = new Date(effectiveMs).toISOString();
  map[conversationId] = hiddenAtIso;
  writeHiddenConversationsMap(user.id, map, true);
  await markThreadRead(conversationId);
  return hiddenAtIso;
}

/** Restores a hidden conversation immediately (e.g. Undo or explicit deep-link open). */
export async function unhideConversation(conversationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const map = readHiddenConversationsMap(user.id, user.user_metadata?.hidden_conversations);
  if (map[conversationId]) {
    map[conversationId] = '';
    writeHiddenConversationsMap(user.id, map, true);
  }
}

/**
 * Buyer/seller chat, one persistent thread per (buyer, seller) pair — every hold
 * request between the same two people reuses the same conversation instead of
 * starting a new thread, so a relationship's chat just keeps going across
 * purchases. Reads/writes go straight through the browser Supabase client — RLS
 * on conversations/hold_request_messages restricts everything to the two
 * participants, so no API route is needed.
 */

async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must be signed in to use messages.');
  return user.id;
}

/** Every visible conversation the current user is part of, newest activity first. */
export async function fetchConversations(options?: {
  includeConversationId?: string | null;
}): Promise<ConversationSummary[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must be signed in to use messages.');
  const uid = user.id;

  const convQuery = supabase
    .from('conversations')
    .select('id, buyer_id, seller_id, created_at')
    .eq('buyer_id', uid);

  const { data: convRows, error: convErr } = await convQuery;

  if (convErr || !convRows || convRows.length === 0) return [];

  const convIds = convRows.map((r) => r.id);

  // Latest hold request per conversation, for the card label + "open request" badge + activity timestamp.
  const { data: holdRows } = await supabase
    .from('hold_requests')
    .select('conversation_id, buyer_id, seller_id, buyer_name, card_name, image_path, items, status, created_at, updated_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false });

  const latestHoldByConv = new Map<string, any>();
  const latestHoldActivityByConv = new Map<string, string>();
  const openRequestByConv = new Map<string, boolean>();
  (holdRows || []).forEach((r: any) => {
    if (!latestHoldByConv.has(r.conversation_id)) latestHoldByConv.set(r.conversation_id, r);
    const holdAct = computeLatestActivityAt([
      latestHoldActivityByConv.get(r.conversation_id),
      r.updated_at,
      r.created_at,
    ]);
    if (holdAct) latestHoldActivityByConv.set(r.conversation_id, holdAct);
    if (OPEN_HOLD_STATUSES.includes(r.status)) {
      openRequestByConv.set(r.conversation_id, true);
    }
  });

  const { data: messages } = await supabase
    .from('hold_request_messages')
    .select('conversation_id, sender_id, body, message_type, metadata, read_at, created_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: true });

  const lastByConv = new Map<string, { body: string; created_at: string }>();
  const unreadByConv = new Map<string, number>();
  (messages || []).forEach((m: any) => {
    lastByConv.set(m.conversation_id, { body: m.body, created_at: m.created_at });
    const isFromSupport = m.sender_id !== uid || Boolean(m.metadata?.via_admin_support);
    if (m.message_type !== 'system' && isFromSupport && !m.read_at) {
      unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) || 0) + 1);
    }
  });

  const hiddenMap = readHiddenConversationsMap(uid, user.user_metadata?.hidden_conversations);
  const resurfacedIds: string[] = [];
  const forceIncludeId = options?.includeConversationId || null;

  const summaries: ConversationSummary[] = [];

  for (const r of convRows as any[]) {
    // Ignore phantom / orphan conversations that have neither messages nor hold requests
    if (!latestHoldByConv.has(r.id) && !lastByConv.has(r.id)) continue;

    const last = lastByConv.get(r.id);
    const latestHold = latestHoldByConv.get(r.id);
    const latestActivityAt = computeLatestActivityAt([
      last?.created_at,
      latestHoldActivityByConv.get(r.id),
      r.created_at,
    ]);

    const currentlyHidden = isConversationHidden(r.id, latestActivityAt, hiddenMap);
    if (currentlyHidden && r.id !== forceIncludeId) {
      continue;
    }
    if (hiddenMap[r.id]) {
      // Either new activity occurred after hiddenAt, or caller explicitly opened this thread
      resurfacedIds.push(r.id);
    }

    const isSeller = false;
    const counterpartId = r.seller_id;
    const items = latestHold && Array.isArray(latestHold.items) ? latestHold.items : null;
    let cardLabel = latestHold
      ? (items && items.length > 1 ? `${items.length} cards` : (latestHold.card_name || 'Card'))
      : 'Bolt & Rendelések';

    if (last?.body) {
      const ordMatch = last.body.match(/Store Order #?([A-Z0-9-]+)/i) || last.body.match(/#?(ORD-[A-Z0-9-]+)/i);
      if (ordMatch) {
        cardLabel = `Rendelés · #${ordMatch[1]}`;
      }
    }

    const counterpartName = 'TCGXChange';
    const counterpartAvatar = '/brand/logo.svg';

    summaries.push({
      conversation_id: r.id,
      counterpart_id: counterpartId || '',
      counterpart_name: counterpartName,
      counterpart_avatar: counterpartAvatar,
      card_name: cardLabel,
      image_path: latestHold?.image_path || null,
      is_seller: isSeller,
      has_open_request: openRequestByConv.get(r.id) || false,
      last_message: last?.body || null,
      last_message_at: last?.created_at || latestActivityAt || r.created_at,
      latest_activity_at: latestActivityAt,
      unread_count: unreadByConv.get(r.id) || 0,
    });
  }

  if (resurfacedIds.length > 0) {
    const nextMap = { ...hiddenMap };
    resurfacedIds.forEach((id) => {
      nextMap[id] = '';
    });
    writeHiddenConversationsMap(uid, nextMap, true);
  }

  return summaries.sort((a, b) =>
    new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
  );
}

/** Total unread messages across every conversation — for a nav badge. */
export async function fetchUnreadCount(): Promise<number> {
  try {
    const uid = await requireUserId();
    const { data: convRows } = await supabase
      .from('conversations')
      .select('id')
      .eq('buyer_id', uid);
    if (!convRows || convRows.length === 0) return 0;

    const { count } = await supabase
      .from('hold_request_messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', convRows.map((r) => r.id))
      .is('read_at', null)
      .neq('sender_id', uid);

    return count || 0;
  } catch (e) {
    return 0;
  }
}

/** Full message history for one conversation, oldest first. */
export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('hold_request_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function sendMessage(
  conversationId: string,
  body: string,
  metadata?: Record<string, any>,
  opts?: {
    counterpartId?: string | null;
    senderName?: string | null;
    senderAvatar?: string | null;
  }
): Promise<{ message: ChatMessage | null; error: any }> {
  if (typeof body !== 'string') return { message: null, error: new Error('Invalid message payload.') };
  const cleaned = sanitizePlainText(body, MAX_MESSAGE_LENGTH);
  const hasImages = Array.isArray(metadata?.images) && metadata.images.length > 0;
  if (!cleaned && !hasImages) return { message: null, error: new Error('Message cannot be empty.') };

  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('You must be signed in to use messages.');
    const uid = user.id;

    const payload: Record<string, any> = {
      conversation_id: conversationId,
      sender_id: uid,
      body: cleaned || (hasImages ? 'Shared photo' : ''),
      message_type: 'user',
    };
    if (metadata && Object.keys(metadata).length > 0) {
      payload.metadata = metadata;
    }
    let { data, error } = await supabase
      .from('hold_request_messages')
      .insert(payload)
      .select()
      .single();

    // If client insert fails (e.g. admin replying across conversations or RLS restriction), fallback to server API
    if (error) {
      try {
        const sessionRes = await supabase.auth.getSession();
        const token = sessionRes.data.session?.access_token;
        if (token) {
          const apiRes = await fetch('/api/messages/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              conversation_id: conversationId,
              body: cleaned,
              metadata,
            }),
          }).then((r) => r.json());

          if (apiRes?.success && apiRes.message) {
            data = apiRes.message;
            error = null;
          }
        }
      } catch (fallbackErr) {
        console.error('Fallback send API failed:', fallbackErr);
      }
    }

    if (!error && data) {
      const senderName =
        opts?.senderName ||
        user.user_metadata?.display_name ||
        user.user_metadata?.full_name ||
        null;
      const senderAvatar = opts?.senderAvatar || user.user_metadata?.avatar_url || null;

      const evt: RealtimeEventPayload = {
        event_id: data.id,
        type: 'chat_message',
        conversation_id: conversationId,
        sender_id: uid,
        sender_name: senderName,
        sender_avatar: senderAvatar,
        message: data,
        created_at: data.created_at || new Date().toISOString(),
      };

      emitLocalRealtimeEvent(uid, evt);

      void (async () => {
        let recipientId = opts?.counterpartId || null;
        if (!recipientId) {
          const { data: conv } = await supabase
            .from('conversations')
            .select('buyer_id, seller_id')
            .eq('id', conversationId)
            .maybeSingle();
          if (conv) {
            recipientId = conv.buyer_id === uid ? conv.seller_id : conv.buyer_id;
          }
        }
        await broadcastClientRealtime([uid, recipientId], evt);
      })();
    }

    return { message: error ? null : data, error };
  } catch (e: any) {
    return { message: null, error: e };
  }
}

/** Marks every message from the other participant in this conversation as read. */
export async function markThreadRead(conversationId: string): Promise<void> {
  try {
    const uid = await requireUserId();
    const nowIso = new Date().toISOString();
    await supabase
      .from('hold_request_messages')
      .update({ read_at: nowIso })
      .eq('conversation_id', conversationId)
      .neq('sender_id', uid)
      .is('read_at', null);

    const evt: RealtimeEventPayload = {
      event_id: `read:${conversationId}:${Date.now()}`,
      type: 'thread_read',
      conversation_id: conversationId,
      sender_id: uid,
      created_at: nowIso,
    };
    emitLocalRealtimeEvent(uid, evt);
    void broadcastClientRealtime([uid], evt);
  } catch (e) {
    // Non-critical — the badge will just stay stale until the next successful call.
  }
}
