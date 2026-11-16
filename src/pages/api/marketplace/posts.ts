import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import { LISTING_CONDITIONS, normalizeCardCondition } from '../../../lib/collectionDefaults';
import { P2P_MAX_POST_IMAGES, P2P_MAX_POST_TAGS } from '../../../lib/p2pConstants';
import {
  fetchProfilesMap,
  fetchUserRatingMap,
  isMissingSchemaError,
  isUuid,
  requireP2PUser,
  resolveP2PViewer,
  sanitizeImageUrls,
} from '../../../lib/p2pServer';

export const prerender = false;

function sanitizeMultilineBody(value: unknown, maxLength = 3000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const viewer = await resolveP2PViewer(request);
    if (!viewer.allowed) {
      return jsonResponse({ success: false, error: 'P2P Marketplace is not available yet.' }, 403);
    }

    const postType = url.searchParams.get('type') || 'all';
    const id = (url.searchParams.get('id') || '').trim();
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const game = (url.searchParams.get('game') || '').trim().toLowerCase();
    const cardId = (url.searchParams.get('card_id') || '').trim();
    const sellerId = (url.searchParams.get('seller_id') || '').trim();
    const country = (url.searchParams.get('country') || '').trim().toUpperCase();
    const likedOnly = url.searchParams.get('liked_only') === 'true';
    const mine = url.searchParams.get('mine') === 'true';
    const sort = url.searchParams.get('sort') || 'newest';

    if (mine && !viewer.caller) {
      return jsonResponse({ success: false, error: 'Authentication required.' }, 401);
    }
    if (likedOnly && !viewer.caller) {
      return jsonResponse({ success: true, posts: [], schemaReady: true }, 200);
    }

    let query = supabaseAdmin
      .from('marketplace_posts')
      .select(`
        id,
        seller_id,
        post_type,
        title,
        body,
        lot_price_huf,
        images,
        status,
        likes_count,
        views,
        created_at,
        updated_at,
        marketplace_post_cards (
          id,
          post_id,
          card_id,
          is_highlight_only,
          condition,
          is_foil,
          price_huf,
          quantity,
          held_quantity,
          status,
          cards (
            id,
            name,
            card_number,
            rarity,
            card_type,
            domain,
            cost,
            artist,
            tags,
            text,
            ability,
            subtype,
            game,
            image_path,
            market_price_eur,
            market_price_foil_eur,
            sets (
              id,
              code,
              name
            )
          )
        )
      `)
      .is('deleted_at', null);

    if (isUuid(id)) {
      query = query.eq('id', id);
    } else if (mine) {
      query = query.eq('seller_id', viewer.caller!.user.id);
    } else {
      query = query.in('status', ['open', 'held']);
    }

    if (postType === 'photo_post' || postType === 'bulk') {
      query = query.eq('post_type', postType);
    }
    if (isUuid(sellerId)) {
      query = query.eq('seller_id', sellerId);
    }

    const { data: rows, error } = await query
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      if (isMissingSchemaError(error)) {
        return jsonResponse({ success: true, posts: [], schemaReady: false }, 200);
      }
      throw error;
    }

    const rawPosts = (rows || []) as any[];
    const sellerIds = Array.from(new Set(rawPosts.map((r) => r.seller_id).filter(Boolean)));
    const postIds = rawPosts.map((r) => r.id).filter(Boolean);

    const [profilesMap, ratingsMap, likedSet] = await Promise.all([
      fetchProfilesMap(sellerIds),
      fetchUserRatingMap(sellerIds, 'buyer_to_seller'),
      (async () => {
        const set = new Set<string>();
        if (!viewer.caller || postIds.length === 0) return set;
        try {
          const { data: likeRows } = await supabaseAdmin
            .from('marketplace_post_likes')
            .select('post_id')
            .eq('user_id', viewer.caller.user.id)
            .in('post_id', postIds);
          for (const lr of likeRows || []) set.add(lr.post_id);
        } catch {}
        return set;
      })(),
    ]);

    let enriched = rawPosts.map((post) => {
      const profile = profilesMap.get(post.seller_id) || {
        id: post.seller_id,
        display_name: 'Collector',
        avatar_url: null,
        country: 'HU',
      };
      const rating = ratingsMap.get(post.seller_id) || { avg: 0, count: 0 };
      const taggedCards = Array.isArray(post.marketplace_post_cards)
        ? post.marketplace_post_cards.map((tc: any) => ({
            id: tc.id,
            post_id: tc.post_id,
            card_id: tc.card_id,
            is_highlight_only: Boolean(tc.is_highlight_only),
            condition: normalizeCardCondition(tc.condition),
            is_foil: Boolean(tc.is_foil),
            price_huf: tc.price_huf !== null && tc.price_huf !== undefined ? Number(tc.price_huf) : null,
            quantity: Number(tc.quantity) || 0,
            held_quantity: Number(tc.held_quantity) || 0,
            available_quantity: Math.max(0, (Number(tc.quantity) || 0) - (Number(tc.held_quantity) || 0)),
            status: tc.status,
            card: Array.isArray(tc.cards) ? tc.cards[0] : tc.cards,
          }))
        : [];

      return {
        id: post.id,
        seller_id: post.seller_id,
        post_type: post.post_type,
        title: post.title || null,
        body: post.body || '',
        lot_price_huf: post.lot_price_huf !== null && post.lot_price_huf !== undefined ? Number(post.lot_price_huf) : null,
        images: Array.isArray(post.images) ? post.images : [],
        status: post.status,
        likes_count: Number(post.likes_count) || 0,
        liked_by_me: likedSet.has(post.id),
        created_at: post.created_at,
        updated_at: post.updated_at,
        tagged_cards: taggedCards,
        seller: {
          ...profile,
          rating_avg: rating.avg,
          rating_count: rating.count,
        },
      };
    });

    enriched = enriched.filter((p) => {
      if (likedOnly && !p.liked_by_me) return false;
      if (country && String(p.seller.country || '').toUpperCase() !== country) return false;
      if (isUuid(cardId)) {
        if (!p.tagged_cards.some((tc: any) => tc.card_id === cardId)) return false;
      }
      if (game && p.tagged_cards.length > 0) {
        if (!p.tagged_cards.some((tc: any) => String(tc.card?.game || '').toLowerCase() === game)) {
          return false;
        }
      }
      if (q) {
        const hayParts = [
          p.title,
          p.body,
          p.seller.display_name,
          ...p.tagged_cards.map((tc: any) => `${tc.card?.name || ''} ${tc.card?.card_number || ''} ${tc.card?.sets?.name || ''}`),
        ];
        if (!hayParts.filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (sort === 'likes') {
      enriched.sort((a, b) => b.likes_count - a.likes_count || b.created_at.localeCompare(a.created_at));
    } else if (sort === 'price_asc') {
      enriched.sort((a, b) => (a.lot_price_huf ?? Number.MAX_SAFE_INTEGER) - (b.lot_price_huf ?? Number.MAX_SAFE_INTEGER));
    } else if (sort === 'price_desc') {
      enriched.sort((a, b) => (b.lot_price_huf ?? -1) - (a.lot_price_huf ?? -1));
    }

    return jsonResponse({ success: true, schemaReady: true, posts: enriched });
  } catch (err: any) {
    console.error('Marketplace posts GET error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to load marketplace posts.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    const payload = await request.json().catch(() => null);
    if (!payload) {
      return jsonResponse({ success: false, error: 'Invalid request body.' }, 400);
    }

    const postType = payload.post_type === 'bulk' ? 'bulk' : 'photo_post';
    const title = sanitizePlainText(payload.title || '', 180) || null;
    const bodyText = sanitizeMultilineBody(payload.body || '', 3000);
    const images = sanitizeImageUrls(payload.images, P2P_MAX_POST_IMAGES);

    if (images.length === 0) {
      return jsonResponse({ success: false, error: 'Please upload at least 1 photo for your post.' }, 400);
    }

    let lotPriceHuf: number | null = null;
    if (postType === 'bulk') {
      const p = Math.round(Number(payload.lot_price_huf));
      if (!Number.isFinite(p) || p < 1 || p > 50_000_000) {
        return jsonResponse({ success: false, error: 'Bulk lots require one valid lot price (1–50,000,000 HUF).' }, 400);
      }
      lotPriceHuf = p;
    }

    const rawTags = Array.isArray(payload.tagged_cards) ? payload.tagged_cards.slice(0, P2P_MAX_POST_TAGS) : [];
    const candidateIds = Array.from(new Set(rawTags.map((t: any) => t?.card_id).filter((id: unknown): id is string => isUuid(id))));

    const validCardIds = new Set<string>();
    if (candidateIds.length > 0) {
      const { data: foundCards } = await supabaseAdmin
        .from('cards')
        .select('id')
        .in('id', candidateIds);
      for (const c of foundCards || []) validCardIds.add(c.id);
    }

    if (postType === 'photo_post' && !bodyText && validCardIds.size === 0) {
      return jsonResponse(
        { success: false, error: 'Add a description or tag at least one card in your photo post.' },
        400
      );
    }

    const { data: postRow, error: postErr } = await supabaseAdmin
      .from('marketplace_posts')
      .insert({
        seller_id: auth.caller.user.id,
        post_type: postType,
        title,
        body: bodyText,
        lot_price_huf: lotPriceHuf,
        images,
        status: 'open',
      })
      .select('*')
      .single();

    if (postErr) {
      if (isMissingSchemaError(postErr)) {
        return jsonResponse({ success: false, error: 'Marketplace posts table requires DB migration.' }, 503);
      }
      throw postErr;
    }

    const preparedTags: any[] = [];
    for (const tag of rawTags) {
      if (!isUuid(tag?.card_id) || !validCardIds.has(tag.card_id)) continue;
      const cond = normalizeCardCondition(tag.condition || 'Near Mint');
      const validCond = (LISTING_CONDITIONS as readonly string[]).includes(cond) ? cond : 'Near Mint';
      const parsedPrice =
        tag.price_huf !== null && tag.price_huf !== undefined && tag.price_huf !== ''
          ? Math.round(Number(tag.price_huf))
          : null;

      if (postType === 'photo_post' && parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 50_000_000)) {
        await supabaseAdmin.from('marketplace_posts').delete().eq('id', postRow.id);
        return jsonResponse({ success: false, error: 'Invalid tagged card price.' }, 400);
      }

      const isHighlightOnly = postType === 'bulk' ? true : Boolean(tag.is_highlight_only) || parsedPrice === null;
      const qty = isHighlightOnly ? 1 : Math.max(1, Math.min(99, Math.round(Number(tag.quantity ?? 1))));

      preparedTags.push({
        post_id: postRow.id,
        card_id: tag.card_id,
        is_highlight_only: isHighlightOnly,
        condition: validCond,
        is_foil: Boolean(tag.is_foil),
        price_huf: postType === 'bulk' ? null : parsedPrice,
        quantity: qty,
        held_quantity: 0,
        status: 'available',
      });
    }

    if (preparedTags.length > 0) {
      const { error: tagErr } = await supabaseAdmin.from('marketplace_post_cards').insert(preparedTags);
      if (tagErr) {
        await supabaseAdmin.from('marketplace_posts').delete().eq('id', postRow.id);
        throw tagErr;
      }
    }

    return jsonResponse({ success: true, post: postRow }, 201);
  } catch (err: any) {
    console.error('Marketplace post POST error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to publish post.' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    const payload = await request.json().catch(() => null);
    const id = isUuid(payload?.id) ? payload.id.trim() : null;
    if (!id) {
      return jsonResponse({ success: false, error: 'Missing post id.' }, 400);
    }

    const { data: existing, error: selErr } = await supabaseAdmin
      .from('marketplace_posts')
      .select('id, seller_id, post_type')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (selErr) throw selErr;
    if (!existing) {
      return jsonResponse({ success: false, error: 'Post not found.' }, 404);
    }
    if (existing.seller_id !== auth.caller.user.id && !auth.caller.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden.' }, 403);
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (payload.title !== undefined) updates.title = sanitizePlainText(payload.title || '', 180) || null;
    if (payload.body !== undefined) updates.body = sanitizeMultilineBody(payload.body || '', 3000);
    if (payload.status === 'open' || payload.status === 'closed' || payload.status === 'sold_out') {
      updates.status = payload.status;
    }
    if (payload.lot_price_huf !== undefined && existing.post_type === 'bulk') {
      const p = Math.round(Number(payload.lot_price_huf));
      if (!Number.isFinite(p) || p < 1 || p > 50_000_000) {
        return jsonResponse({ success: false, error: 'Invalid lot price.' }, 400);
      }
      updates.lot_price_huf = p;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('marketplace_posts')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (updErr) throw updErr;
    return jsonResponse({ success: true, post: updated }, 200);
  } catch (err: any) {
    console.error('Marketplace post PATCH error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to update post.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, url }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    let id = url.searchParams.get('id');
    if (!id) {
      const body = await request.json().catch(() => null);
      id = body?.id;
    }
    if (!isUuid(id)) {
      return jsonResponse({ success: false, error: 'Invalid post id.' }, 400);
    }

    const { data: existing } = await supabaseAdmin
      .from('marketplace_posts')
      .select('id, seller_id')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!existing) {
      return jsonResponse({ success: false, error: 'Post not found.' }, 404);
    }
    if (existing.seller_id !== auth.caller.user.id && !auth.caller.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden.' }, 403);
    }

    const { error: delErr } = await supabaseAdmin
      .from('marketplace_posts')
      .update({ deleted_at: new Date().toISOString(), status: 'closed' })
      .eq('id', id);

    if (delErr) throw delErr;
    return jsonResponse({ success: true }, 200);
  } catch (err: any) {
    console.error('Marketplace post DELETE error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to delete post.' }, 500);
  }
};
