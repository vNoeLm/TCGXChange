import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { jsonResponse } from '../../../lib/requestAuth';
import { isMissingSchemaError, isUuid, requireP2PUser } from '../../../lib/p2pServer';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request, { requireEmailConfirmed: false });
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    const listingId = isUuid(body?.listing_id) ? body.listing_id.trim() : null;
    const postId = isUuid(body?.post_id) ? body.post_id.trim() : null;

    if (!listingId && !postId) {
      return jsonResponse({ success: false, error: 'Missing listing_id or post_id.' }, 400);
    }

    const table = listingId ? 'marketplace_listing_likes' : 'marketplace_post_likes';
    const targetCol = listingId ? 'listing_id' : 'post_id';
    const targetId = (listingId || postId)!;
    const parentTable = listingId ? 'marketplace_listings' : 'marketplace_posts';

    const { data: existing, error: selErr } = await supabaseAdmin
      .from(table)
      .select('id')
      .eq(targetCol, targetId)
      .eq('user_id', auth.caller.user.id)
      .maybeSingle();

    if (selErr) {
      if (isMissingSchemaError(selErr)) {
        return jsonResponse({ success: false, error: 'Likes table requires DB migration.' }, 503);
      }
      throw selErr;
    }

    let liked = false;
    if (existing?.id) {
      const { error: delErr } = await supabaseAdmin.from(table).delete().eq('id', existing.id);
      if (delErr) throw delErr;
      liked = false;
    } else {
      const { error: insErr } = await supabaseAdmin.from(table).insert({
        [targetCol]: targetId,
        user_id: auth.caller.user.id,
      });
      if (insErr) throw insErr;
      liked = true;
    }

    // Read updated count (DB trigger keeps likes_count synced; count query as fallback)
    const { data: parentRow } = await supabaseAdmin
      .from(parentTable)
      .select('likes_count')
      .eq('id', targetId)
      .maybeSingle();

    let likesCount = typeof parentRow?.likes_count === 'number' ? parentRow.likes_count : null;
    if (likesCount === null) {
      const { count } = await supabaseAdmin
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq(targetCol, targetId);
      likesCount = count || 0;
    }

    return jsonResponse({ success: true, liked, likes_count: likesCount }, 200);
  } catch (err: any) {
    console.error('Marketplace like toggle error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to update saved status.' }, 500);
  }
};
