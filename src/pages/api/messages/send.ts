import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import { MAX_MESSAGE_LENGTH } from '../../../lib/messages';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: false, error: 'Unauthorized: please sign in.' }, 401);
    }
    if (caller.isBanned) {
      return jsonResponse({ success: false, error: 'Your account is suspended.' }, 403);
    }

    const payload = await request.json().catch(() => null);
    const conversationId = String(payload?.conversation_id || '').trim();
    const rawBody = typeof payload?.body === 'string' ? payload.body : '';
    const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined;

    if (!conversationId) {
      return jsonResponse({ success: false, error: 'Missing conversation_id.' }, 400);
    }

    // Verify conversation exists
    const { data: conv, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select('id, buyer_id, seller_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (convErr || !conv) {
      return jsonResponse({ success: false, error: 'Conversation not found.' }, 404);
    }

    // Access check: caller must be an admin OR a participant in the conversation
    const isParticipant = conv.buyer_id === caller.user.id || conv.seller_id === caller.user.id;
    if (!caller.isAdmin && !isParticipant) {
      return jsonResponse({ success: false, error: 'Forbidden: you cannot access this conversation.' }, 403);
    }

    const cleaned = sanitizePlainText(rawBody, MAX_MESSAGE_LENGTH);
    const hasImages = Array.isArray(metadata?.images) && metadata.images.length > 0;
    if (!cleaned && !hasImages) {
      return jsonResponse({ success: false, error: 'Message cannot be empty.' }, 400);
    }

    const msgPayload: Record<string, any> = {
      conversation_id: conversationId,
      sender_id: caller.user.id,
      body: cleaned || (hasImages ? 'Shared photo' : ''),
      message_type: 'user',
    };
    if (metadata && Object.keys(metadata).length > 0) {
      msgPayload.metadata = metadata;
    }

    const { data: msgData, error: msgErr } = await supabaseAdmin
      .from('hold_request_messages')
      .insert(msgPayload)
      .select()
      .single();

    if (msgErr || !msgData) {
      return jsonResponse({ success: false, error: msgErr?.message || 'Failed to send message.' }, 500);
    }

    return jsonResponse({ success: true, message: msgData });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Internal server error.' }, 500);
  }
};
