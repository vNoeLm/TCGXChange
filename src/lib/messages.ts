import { supabase } from './supabase';
import { getCurrentUser } from './auth';
import { OPEN_HOLD_STATUSES } from './holdFlow';
import type { ChatMessage, ConversationSummary } from '../types';
import { sanitizePlainText } from './sanitize';

export const MAX_MESSAGE_LENGTH = 2000;
export const CHAT_IMAGE_EXPIRY_DAYS = 14;

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

/** Every conversation the current user is part of, newest activity first. */
export async function fetchConversations(): Promise<ConversationSummary[]> {
  const uid = await requireUserId();

  const { data: convRows, error: convErr } = await supabase
    .from('conversations')
    .select('id, buyer_id, seller_id, created_at')
    .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`);

  if (convErr || !convRows || convRows.length === 0) return [];

  const convIds = convRows.map((r) => r.id);

  // Latest hold request per conversation, for the card label + "open request" badge.
  const { data: holdRows } = await supabase
    .from('hold_requests')
    .select('conversation_id, buyer_name, card_name, image_path, items, status, created_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false });

  const latestHoldByConv = new Map<string, any>();
  const openRequestByConv = new Map<string, boolean>();
  (holdRows || []).forEach((r: any) => {
    if (!latestHoldByConv.has(r.conversation_id)) latestHoldByConv.set(r.conversation_id, r);
    if (OPEN_HOLD_STATUSES.includes(r.status)) {
      openRequestByConv.set(r.conversation_id, true);
    }
  });

  const counterpartIds = [...new Set(
    convRows.map((r) => (r.seller_id === uid ? r.buyer_id : r.seller_id)).filter(Boolean)
  )];
  const profileNames = new Map<string, string>();
  if (counterpartIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', counterpartIds);
    (profiles || []).forEach((p: any) => profileNames.set(p.id, p.display_name || 'User'));
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

  const summaries = convRows
    .filter((r: any) => {
      // Ignore phantom / orphan conversations that have neither messages nor hold requests
      return latestHoldByConv.has(r.id) || lastByConv.has(r.id);
    })
    .map((r: any): ConversationSummary => {
    const isSeller = r.seller_id === uid;
    const counterpartId = isSeller ? r.buyer_id : r.seller_id;
    const latestHold = latestHoldByConv.get(r.id);
    const items = latestHold && Array.isArray(latestHold.items) ? latestHold.items : null;
    const cardLabel = latestHold
      ? (items && items.length > 1 ? `${items.length} cards` : (latestHold.card_name || 'Card'))
      : 'New conversation';
    const last = lastByConv.get(r.id);
    return {
      conversation_id: r.id,
      counterpart_id: counterpartId || '',
      // From the other person's profile either way: one conversation now covers both directions
      // of buying between two people, so "the buyer" isn't always the other person.
      counterpart_name: profileNames.get(counterpartId) || (isSeller ? latestHold?.buyer_name : null) || 'User',
      card_name: cardLabel,
      image_path: latestHold?.image_path || null,
      is_seller: isSeller,
      has_open_request: openRequestByConv.get(r.id) || false,
      last_message: last?.body || null,
      last_message_at: last?.created_at || r.created_at,
      unread_count: unreadByConv.get(r.id) || 0,
    };
  });

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
