import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { bannedResponse, getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import { isMissingSchemaError, isUuid } from '../../../lib/p2pServer';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: false, error: 'Unauthorized — Sign in required.' }, 401);
    }
    if (caller.isBanned) {
      return bannedResponse();
    }
    if (!caller.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden — Admin access required.' }, 403);
    }

    const body = await request.json().catch(() => null);
    const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : '';
    const reviewId = isUuid(body?.review_id) ? body.review_id.trim() : null;

    if (!reviewId) {
      return jsonResponse({ success: false, error: 'Invalid review_id.' }, 400);
    }

    if (action === 'edit') {
      const comment = sanitizePlainText(body?.comment || '', 800) || null;
      const { data: updated, error } = await supabaseAdmin
        .from('user_reviews')
        .update({ comment })
        .eq('id', reviewId)
        .select('id, order_number, direction, rating, scores, comment, reviewer_name, reviewer_avatar, created_at')
        .maybeSingle();

      if (error) {
        if (isMissingSchemaError(error)) {
          return jsonResponse({ success: false, error: 'Reviews table unavailable.' }, 503);
        }
        throw error;
      }
      if (!updated) {
        return jsonResponse({ success: false, error: 'Review not found.' }, 404);
      }

      return jsonResponse({ success: true, review: updated });
    }

    if (action === 'delete') {
      const { data: deleted, error } = await supabaseAdmin
        .from('user_reviews')
        .delete()
        .eq('id', reviewId)
        .select('id')
        .maybeSingle();

      if (error) {
        if (isMissingSchemaError(error)) {
          return jsonResponse({ success: false, error: 'Reviews table unavailable.' }, 503);
        }
        throw error;
      }
      if (!deleted) {
        return jsonResponse({ success: false, error: 'Review not found.' }, 404);
      }

      return jsonResponse({ success: true, deleted_id: reviewId });
    }

    return jsonResponse({ success: false, error: 'Unsupported action. Use "edit" or "delete".' }, 400);
  } catch (err: any) {
    console.error('Review moderation error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to moderate review.' }, 500);
  }
};
