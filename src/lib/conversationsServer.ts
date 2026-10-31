import { supabaseAdmin } from './supabaseServer';

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

/** Posts an ordinary chat message on someone's behalf (e.g. the note a buyer wrote at checkout). */
export async function postUserMessage(conversationId: string, senderId: string, body: string): Promise<void> {
  try {
    await supabaseAdmin.from('hold_request_messages').insert({
      conversation_id: conversationId,
      sender_id: senderId,
      body,
      message_type: 'user',
    });
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
    await supabaseAdmin.from('hold_request_messages').insert({
      conversation_id: conversationId,
      hold_request_id: opts?.holdRequestId || null,
      sender_id: senderId,
      body,
      message_type: 'system',
      metadata: opts?.metadata || null,
    });
  } catch (e) {
    console.warn('Failed to post system message:', e);
  }
}
