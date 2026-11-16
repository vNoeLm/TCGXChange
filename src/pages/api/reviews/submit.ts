import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import { overallOf, validScores, type ReviewDirection } from '../../../lib/reviewCategories';
import { isMissingSchemaError, isUuid, requireP2PUser } from '../../../lib/p2pServer';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request, { requireEmailConfirmed: false });
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    const holdRequestId = isUuid(body?.hold_request_id) ? body.hold_request_id.trim() : null;
    if (!holdRequestId) {
      return jsonResponse({ success: false, error: 'Invalid hold_request_id.' }, 400);
    }

    const { data: hold, error: holdErr } = await supabaseAdmin
      .from('hold_requests')
      .select('id, seller_id, buyer_id, status, order_number')
      .eq('id', holdRequestId)
      .maybeSingle();

    if (holdErr) throw holdErr;
    if (!hold) {
      return jsonResponse({ success: false, error: 'Hold transaction not found.' }, 404);
    }

    if (hold.status !== 'completed') {
      return jsonResponse({ success: false, error: 'Reviews can only be submitted after completion.' }, 400);
    }

    const callerId = auth.caller.user.id;
    let direction: ReviewDirection | null = null;
    let revieweeId: string | null = null;

    if (hold.buyer_id === callerId) {
      direction = 'buyer_to_seller';
      revieweeId = hold.seller_id;
    } else if (hold.seller_id === callerId) {
      direction = 'seller_to_buyer';
      revieweeId = hold.buyer_id;
    }

    if (!direction || !revieweeId || revieweeId === callerId) {
      return jsonResponse({ success: false, error: 'You are not a participant of this transaction.' }, 403);
    }

    const parsedScores = validScores(direction, body?.scores);
    if (!parsedScores) {
      return jsonResponse({ success: false, error: 'Please rate all categories (1 to 5 stars).' }, 400);
    }

    const rating = overallOf(parsedScores);
    const comment = sanitizePlainText(body?.comment || '', 800) || null;
    const orderNumber = hold.order_number || `P2P-${hold.id.slice(0, 8).toUpperCase()}`;

    const { data: existing } = await supabaseAdmin
      .from('user_reviews')
      .select('id')
      .eq('reviewer_id', callerId)
      .or(`hold_request_id.eq.${hold.id},order_number.eq.${orderNumber}`)
      .limit(1);

    if (existing && existing.length > 0) {
      return jsonResponse({ success: false, error: 'You have already reviewed this transaction.' }, 409);
    }

    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', callerId)
      .maybeSingle();

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('user_reviews')
      .insert({
        hold_request_id: hold.id,
        order_number: orderNumber,
        reviewer_id: callerId,
        reviewee_id: revieweeId,
        direction,
        rating,
        scores: parsedScores,
        comment,
        reviewer_name: prof?.display_name || 'Collector',
        reviewer_avatar: prof?.avatar_url || null,
      })
      .select('*')
      .single();

    if (insErr) {
      if (isMissingSchemaError(insErr)) {
        return jsonResponse({ success: false, error: 'Reviews schema migration required.' }, 503);
      }
      throw insErr;
    }

    return jsonResponse({ success: true, review: inserted }, 201);
  } catch (err: any) {
    console.error('Review submit error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to save review.' }, 500);
  }
};
