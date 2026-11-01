import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../lib/requestAuth';
import { sanitizePlainText } from '../../lib/sanitize';
import { loadTradeOrders, tradeStatsFor } from '../../lib/tradeOrders';
import { categoriesFor, overallOf, validScores, type ReviewDirection } from '../../lib/reviewCategories';
import { broadcastToUsersServer } from '../../lib/realtimeServer';

export const prerender = false;

const isId = (v: string | null): v is string => Boolean(v && /^[0-9a-f-]{32,40}$/i.test(v));

export interface TradeReviewRow {
  id: string;
  order_number: string;
  reviewer_id: string;
  reviewee_id: string;
  direction: ReviewDirection;
  rating: number;
  scores: Record<string, number> | null;
  comment: string | null;
  reviewer_name: string | null;
  reviewer_avatar: string | null;
  created_at: string;
}

const tableMissing = (error: any) => Boolean(error && (error.code === '42P01' || error.code === 'PGRST205'));

/** Reviews matching a filter, from user_reviews - or, before its migration has been run, the old
 *  seller-only table, mapped to the same shape. */
async function readReviews(column: 'reviewee_id' | 'reviewer_id', id: string): Promise<TradeReviewRow[]> {
  const { data, error } = await supabaseAdmin
    .from('user_reviews')
    .select('*')
    .eq(column, id)
    .order('created_at', { ascending: false });
  if (!error) return (data || []).map((r: any) => ({ ...r, rating: Number(r.rating) }));
  if (!tableMissing(error)) throw error;

  // The old reviews lived in a table and in a settings copy (the migration merges both).
  const oldColumn = column === 'reviewee_id' ? 'seller_id' : 'buyer_id';
  const [{ data: old }, { data: blob }] = await Promise.all([
    supabaseAdmin.from('seller_reviews').select('*').eq(oldColumn, id),
    supabaseAdmin.from('settings').select('value').eq('key', 'seller_reviews').maybeSingle(),
  ]);
  const byId = new Map<string, any>();
  try {
    const parsed = blob?.value ? (typeof blob.value === 'string' ? JSON.parse(blob.value) : blob.value) : [];
    if (Array.isArray(parsed)) parsed.forEach((r: any) => { if (r?.id && r[oldColumn] === id) byId.set(r.id, r); });
  } catch {
    // a malformed copy just adds nothing
  }
  (old || []).forEach((r: any) => byId.set(r.id, r));
  return Array.from(byId.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((r: any) => ({
    id: r.id,
    order_number: r.order_number,
    reviewer_id: r.buyer_id,
    reviewee_id: r.seller_id,
    direction: 'buyer_to_seller' as const,
    rating: Number(r.rating),
    scores: null,
    comment: r.comment,
    reviewer_name: r.buyer_name,
    reviewer_avatar: r.buyer_avatar,
    created_at: r.created_at,
  }));
}

function summarize(reviews: TradeReviewRow[], direction: ReviewDirection) {
  const list = reviews.filter((r) => r.direction === direction);
  const avg = list.length ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10 : null;
  const categories: Record<string, { avg: number; count: number }> = {};
  for (const c of categoriesFor(direction)) {
    const scored = list.map((r) => r.scores?.[c.key]).filter((v): v is number => typeof v === 'number');
    if (scored.length) {
      categories[c.key] = { avg: Math.round((scored.reduce((s, v) => s + v, 0) / scored.length) * 10) / 10, count: scored.length };
    }
  }
  return { avg, count: list.length, categories };
}

// GET ?user_id=   reviews about that person (both directions), their two reputations and trade numbers
// GET ?reviewer_id=   reviews that person has written (so a page can show "you rated this")
export const GET: APIRoute = async ({ url }) => {
  try {
    const reviewerId = url.searchParams.get('reviewer_id');
    if (isId(reviewerId)) {
      return jsonResponse({ success: true, reviews: await readReviews('reviewer_id', reviewerId) });
    }
    const userId = url.searchParams.get('user_id');
    if (!isId(userId)) return jsonResponse({ success: false, error: 'user_id is required.' }, 400);

    const [reviews, orders] = await Promise.all([readReviews('reviewee_id', userId), loadTradeOrders()]);
    return jsonResponse({
      success: true,
      reviews,
      as_seller: summarize(reviews, 'buyer_to_seller'),
      as_buyer: summarize(reviews, 'seller_to_buyer'),
      stats: tradeStatsFor(orders, userId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};

// POST { order_number, direction, scores, comment } - rate the other side of a completed order
export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Sign in to leave a review.' }, 401);
    const me = caller.user.id;

    const body = await request.json().catch(() => null);
    const direction = body?.direction as ReviewDirection;
    if (direction !== 'buyer_to_seller' && direction !== 'seller_to_buyer') {
      return jsonResponse({ success: false, error: 'Unknown review type.' }, 400);
    }
    const scores = validScores(direction, body?.scores);
    if (!scores) return jsonResponse({ success: false, error: 'Rate every category from 1 to 5 stars.' }, 400);
    const comment = body?.comment ? sanitizePlainText(body.comment, 1000) : '';

    // The order has to exist, be completed, and have the caller on the side they're reviewing from.
    const order = (await loadTradeOrders()).find((o) => o.order_number === body?.order_number);
    if (!order) return jsonResponse({ success: false, error: 'Order not found.' }, 404);
    if (order.status !== 'Delivered') {
      return jsonResponse({ success: false, error: 'You can rate a trade once it has been completed.' }, 409);
    }
    const revieweeId = direction === 'buyer_to_seller' ? order.seller_id : order.user_id;
    const reviewerSide = direction === 'buyer_to_seller' ? order.user_id : order.seller_id;
    if (reviewerSide !== me) return jsonResponse({ success: false, error: 'You were not part of this trade.' }, 403);
    if (!revieweeId || revieweeId === me) {
      return jsonResponse({ success: false, error: 'There is no one to rate on this order.' }, 409);
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', me)
      .maybeSingle();

    const row = {
      order_number: order.order_number,
      reviewer_id: me,
      reviewee_id: revieweeId,
      direction,
      rating: overallOf(scores),
      scores,
      comment: comment || null,
      reviewer_name: profile?.display_name || null,
      reviewer_avatar: profile?.avatar_url || null,
    };
    const { data, error } = await supabaseAdmin.from('user_reviews').insert(row).select().single();
    if (error) {
      if (error.code === '23505') return jsonResponse({ success: false, error: 'You have already rated this trade.' }, 409);
      if (tableMissing(error)) {
        return jsonResponse({ success: false, error: 'Reviews are being upgraded - the database update has not been run yet.' }, 503);
      }
      throw error;
    }

    await broadcastToUsersServer([revieweeId, me], {
      event_id: data.id || crypto.randomUUID(),
      type: 'review_created',
      sender_id: me,
      sender_name: profile?.display_name || null,
      sender_avatar: profile?.avatar_url || null,
      order_number: order.order_number,
      rating: Number(data.rating),
      created_at: data.created_at || new Date().toISOString(),
    });

    return jsonResponse({ success: true, review: { ...data, rating: Number(data.rating) } }, 201);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};

// DELETE ?id=<review_id> - admins can delete any review; users can delete their own review
export const DELETE: APIRoute = async ({ url, request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ success: false, error: 'Review id is required.' }, 400);

    if (!caller.isAdmin) {
      const { data: existing } = await supabaseAdmin
        .from('user_reviews')
        .select('reviewer_id')
        .eq('id', id)
        .maybeSingle();
      if (!existing || existing.reviewer_id !== caller.user.id) {
        return jsonResponse({ success: false, error: 'Forbidden' }, 403);
      }
    }

    await Promise.allSettled([
      supabaseAdmin.from('user_reviews').delete().eq('id', id),
      supabaseAdmin.from('seller_reviews').delete().eq('id', id),
    ]);

    const { data: blob } = await supabaseAdmin.from('settings').select('value').eq('key', 'seller_reviews').maybeSingle();
    if (blob?.value) {
      try {
        const parsed = typeof blob.value === 'string' ? JSON.parse(blob.value) : blob.value;
        if (Array.isArray(parsed)) {
          const next = parsed.filter((r: any) => r?.id !== id);
          if (next.length !== parsed.length) {
            await supabaseAdmin.from('settings').upsert({ key: 'seller_reviews', value: JSON.stringify(next) });
          }
        }
      } catch {
        // ignore
      }
    }

    return jsonResponse({ success: true, deletedId: id });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};
