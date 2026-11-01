import { supabaseAdmin } from './supabaseServer';
import { broadcastToUsersServer } from './realtimeServer';
import type { ChatMessage } from '../types';

/**
 * Finds the persistent conversation between two people, creating it if this is their first-ever
 * interaction. Every later hold request between them reuses it - whichever of them is buying.
 * It used to be looked up as (buyer, seller) only, so once two people swapped roles a second
 * thread opened for the same pair (see the 20261003 migration, which merged those).
 */
async function findConversation(a: string, b: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .or(`and(buyer_id.eq.${a},seller_id.eq.${b}),and(buyer_id.eq.${b},seller_id.eq.${a})`)
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0]?.id || null;
}

export async function getOrCreateConversation(buyerId: string, sellerId: string): Promise<string | null> {
  try {
    const existing = await findConversation(buyerId, sellerId);
    if (existing) return existing;

    const { data: created, error } = await supabaseAdmin
      .from('conversations')
      .insert({ buyer_id: buyerId, seller_id: sellerId })
      .select('id')
      .single();

    if (error) {
      // Another request may have created it in the gap above — fetch instead of failing.
      return findConversation(buyerId, sellerId);
    }
    return created?.id || null;
  } catch (e) {
    console.warn('Failed to get/create conversation:', e);
    return null;
  }
}

async function emitConversationRealtime(
  conversationId: string,
  senderId: string,
  message: ChatMessage,
  extraRecipientIds: Array<string | null | undefined> = []
): Promise<void> {
  try {
    const [convRes, profRes] = await Promise.all([
      supabaseAdmin
        .from('conversations')
        .select('buyer_id, seller_id')
        .eq('id', conversationId)
        .maybeSingle(),
      senderId
        ? supabaseAdmin
            .from('profiles')
            .select('display_name, avatar_url')
            .eq('id', senderId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const conv = convRes?.data;
    const prof = profRes?.data;

    await broadcastToUsersServer(
      [conv?.buyer_id, conv?.seller_id, ...extraRecipientIds],
      {
        event_id: message.id || crypto.randomUUID(),
        type: message.message_type === 'system' ? 'system_notice' : 'chat_message',
        conversation_id: conversationId,
        hold_request_id: message.hold_request_id || null,
        sender_id: senderId,
        sender_name: prof?.display_name || null,
        sender_avatar: prof?.avatar_url || null,
        message,
        created_at: message.created_at || new Date().toISOString(),
      }
    );
  } catch (e) {
    console.warn('Failed to emit conversation realtime event:', e);
  }
}

/** Posts an ordinary chat message on someone's behalf (e.g. the note a buyer wrote at checkout). */
export async function postUserMessage(conversationId: string, senderId: string, body: string): Promise<void> {
  try {
    const insertReq: any = supabaseAdmin.from('hold_request_messages').insert({
      conversation_id: conversationId,
      sender_id: senderId,
      body,
      message_type: 'user',
    });

    let inserted: ChatMessage | null = null;
    if (typeof insertReq?.select === 'function') {
      const { data } = await insertReq.select('*').single();
      inserted = data || null;
    } else {
      await insertReq;
    }

    const msgObj: ChatMessage = inserted || {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      hold_request_id: null,
      sender_id: senderId,
      body,
      message_type: 'user',
      metadata: null,
      read_at: null,
      created_at: new Date().toISOString(),
    };

    await emitConversationRealtime(conversationId, senderId, msgObj);
  } catch (e) {
    console.warn('Failed to post message:', e);
  }
}

/** Posts an automatic system message (hold requested/accepted/rejected/completed) into a conversation. */
export async function postSystemMessage(
  conversationId: string,
  senderId: string,
  body: string,
  opts?: { holdRequestId?: string | null; metadata?: Record<string, any> }
): Promise<void> {
  try {
    const insertReq: any = supabaseAdmin.from('hold_request_messages').insert({
      conversation_id: conversationId,
      hold_request_id: opts?.holdRequestId || null,
      sender_id: senderId,
      body,
      message_type: 'system',
      metadata: opts?.metadata || null,
    });

    let inserted: ChatMessage | null = null;
    if (typeof insertReq?.select === 'function') {
      const { data } = await insertReq.select('*').single();
      inserted = data || null;
    } else {
      await insertReq;
    }

    const msgObj: ChatMessage = inserted || {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      hold_request_id: opts?.holdRequestId || null,
      sender_id: senderId,
      body,
      message_type: 'system',
      metadata: opts?.metadata || null,
      read_at: null,
      created_at: new Date().toISOString(),
    };

    await emitConversationRealtime(conversationId, senderId, msgObj, [
      opts?.metadata?.buyer_id,
      opts?.metadata?.seller_id,
    ]);
  } catch (e) {
    console.warn('Failed to post system message:', e);
  }
}
