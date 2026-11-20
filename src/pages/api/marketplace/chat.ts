import type { APIRoute } from 'astro';
import { bannedResponse, getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import { getOrCreateConversation, postUserMessage } from '../../../lib/conversationsServer';
import { isUuid, requireP2PUser } from '../../../lib/p2pServer';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { readWishlistVisibilityMap } from '../profile/wishlists';

export const prerender = false;

/** Opens or reuses a P2P / direct wishlist inquiry thread and delivers an initial message. */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null);
    const wishlistId = isUuid(body?.wishlist_id) ? body.wishlist_id.trim() : null;
    const sellerId = isUuid(body?.seller_id) ? body.seller_id.trim() : null;
    if (!sellerId) {
      return jsonResponse({ success: false, error: 'Missing seller_id.' }, 400);
    }

    let callerUserId: string;
    if (wishlistId) {
      const caller = await getRequestUser(request);
      if (!caller) {
        return jsonResponse({ success: false, error: 'Authentication required.' }, 401);
      }
      if (caller.isBanned) {
        return bannedResponse();
      }
      if (sellerId === caller.user.id) {
        return jsonResponse({ success: false, error: 'You cannot message yourself.' }, 400);
      }
      const [{ data: wl }, visibilityMap] = await Promise.all([
        supabaseAdmin.from('wishlists').select('*').eq('id', wishlistId).eq('user_id', sellerId).maybeSingle(),
        readWishlistVisibilityMap(),
      ]);
      const isPublic = Boolean(wl && (typeof (wl as any).is_public === 'boolean' ? (wl as any).is_public : visibilityMap[wishlistId] ?? false));
      if (!wl || !isPublic) {
        return jsonResponse({ success: false, error: 'This wishlist is private or no longer available.' }, 403);
      }
      callerUserId = caller.user.id;
    } else {
      const auth = await requireP2PUser(request);
      if (auth.response) return auth.response;
      if (sellerId === auth.caller.user.id) {
        return jsonResponse({ success: false, error: 'You cannot message yourself.' }, 400);
      }
      callerUserId = auth.caller.user.id;
    }

    const conversationId = await getOrCreateConversation(callerUserId, sellerId, 'p2p');
    if (!conversationId) {
      return jsonResponse({ success: false, error: 'Could not initialize conversation.' }, 500);
    }
    const initialMessage = sanitizePlainText(body?.message || '', 800);
    if (initialMessage) {
      await postUserMessage(conversationId, callerUserId, initialMessage);
    }

    return jsonResponse({ success: true, conversation_id: conversationId }, 200);
  } catch (err: any) {
    console.error('Marketplace P2P chat start error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Could not start P2P chat.' }, 500);
  }
};
