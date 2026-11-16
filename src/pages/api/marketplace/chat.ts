import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import { getOrCreateConversation, postUserMessage } from '../../../lib/conversationsServer';
import { isUuid, requireP2PUser } from '../../../lib/p2pServer';

export const prerender = false;

/** Opens or reuses a P2P buyer-seller thread and optionally delivers an initial inquiry message. */
export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    const sellerId = isUuid(body?.seller_id) ? body.seller_id.trim() : null;
    if (!sellerId) {
      return jsonResponse({ success: false, error: 'Missing seller_id.' }, 400);
    }
    if (sellerId === auth.caller.user.id) {
      return jsonResponse({ success: false, error: 'You cannot message yourself.' }, 400);
    }

    const conversationId = await getOrCreateConversation(auth.caller.user.id, sellerId, 'p2p');
    if (!conversationId) {
      return jsonResponse({ success: false, error: 'Could not initialize P2P chat.' }, 500);
    }
    const initialMessage = sanitizePlainText(body?.message || '', 800);
    if (initialMessage) {
      await postUserMessage(conversationId, auth.caller.user.id, initialMessage);
    }

    return jsonResponse({ success: true, conversation_id: conversationId }, 200);
  } catch (err: any) {
    console.error('Marketplace P2P chat start error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Could not start P2P chat.' }, 500);
  }
};
