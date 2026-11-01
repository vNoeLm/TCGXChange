import { supabase } from './supabase';
import { getCurrentUser } from './auth';
import { OPEN_HOLD_STATUSES } from './holdFlow';
import type { ChatMessage, ConversationSummary } from '../types';
import { sanitizePlainText } from './sanitize';

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

  const { data: convRows, error: convErr } = await supabase
    .from('conversations')
    .select('id, buyer_id, seller_id, created_at')
    .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`);

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

  const counterpartIds = [...new Set(
    convRows.map((r) => (r.seller_id === uid ? r.buyer_id : r.seller_id)).filter(Boolean)
  )];
  const profileNames = new Map<string, string>();
  const profileAvatars = new Map<string, string | null>();
  if (counterpartIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', counterpartIds);
    (profiles || []).forEach((p: any) => {
      profileNames.set(p.id, p.display_name || 'User');
      profileAvatars.set(p.id, p.avatar_url || null);
    });
  }

  const { data: messages } = await supabase
    .from('hold_request_messages')
    .select('conversation_id, sender_id, body, read_at, created_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: true });

  const lastByConv = new Map<string, { body: string; created_at: string }>();
  const unreadByConv = new Map<string, number>();
  (messages || []).forEach((m: any) => {
    lastByConv.set(m.conversation_id, { body: m.body, created_at: m.created_at });
    if (m.sender_id !== uid && !m.read_at) {
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

    const isSeller = latestHold?.seller_id ? latestHold.seller_id === uid : r.seller_id === uid;
    const counterpartId = r.seller_id === uid ? r.buyer_id : r.seller_id;
    const items = latestHold && Array.isArray(latestHold.items) ? latestHold.items : null;
    const cardLabel = latestHold
      ? (items && items.length > 1 ? `${items.length} cards` : (latestHold.card_name || 'Card'))
      : 'New conversation';

    summaries.push({
      conversation_id: r.id,
      counterpart_id: counterpartId || '',
      // From the other person's profile either way: one conversation now covers both directions
      // of buying between two people, so "the buyer" isn't always the other person.
      counterpart_name: profileNames.get(counterpartId) || (isSeller ? latestHold?.buyer_name : null) || 'User',
      counterpart_avatar: profileAvatars.get(counterpartId) || null,
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
      .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`);
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

/** Resolves a hold_request_id (e.g. from an old deep link) to the conversation it belongs to. */
export async function resolveConversationIdFromHoldRequest(holdRequestId: string): Promise<string | null> {
  const { data } = await supabase
    .from('hold_requests')
    .select('conversation_id')
    .eq('id', holdRequestId)
    .maybeSingle();
  return data?.conversation_id || null;
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
  metadata?: Record<string, any>
): Promise<{ message: ChatMessage | null; error: any }> {
  if (typeof body !== 'string') return { message: null, error: new Error('Invalid message payload.') };
  const cleaned = sanitizePlainText(body, MAX_MESSAGE_LENGTH);
  const hasImages = Array.isArray(metadata?.images) && metadata.images.length > 0;
  if (!cleaned && !hasImages) return { message: null, error: new Error('Message cannot be empty.') };

  try {
    const uid = await requireUserId();
    const payload: Record<string, any> = {
      conversation_id: conversationId,
      sender_id: uid,
      body: cleaned || (hasImages ? 'Shared photo' : ''),
      message_type: 'user',
    };
    if (metadata && Object.keys(metadata).length > 0) {
      payload.metadata = metadata;
    }
    const { data, error } = await supabase
      .from('hold_request_messages')
      .insert(payload)
      .select()
      .single();

    return { message: error ? null : data, error };
  } catch (e: any) {
    return { message: null, error: e };
  }
}

/** Marks every message from the other participant in this conversation as read. */
export async function markThreadRead(conversationId: string): Promise<void> {
  try {
    const uid = await requireUserId();
    await supabase
      .from('hold_request_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', uid)
      .is('read_at', null);
  } catch (e) {
    // Non-critical — the badge will just stay stale until the next successful call.
  }
}
