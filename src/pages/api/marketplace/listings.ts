import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import { LISTING_CONDITIONS, normalizeCardCondition } from '../../../lib/collectionDefaults';
import { P2P_MAX_POST_IMAGES } from '../../../lib/p2pConstants';
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

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const viewer = await resolveP2PViewer(request);
    if (!viewer.allowed) {
      return jsonResponse({ success: false, error: 'P2P Marketplace is not available yet.' }, 403);
    }

    const view = url.searchParams.get('view') || 'by_card';
    const id = (url.searchParams.get('id') || '').trim();
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const game = (url.searchParams.get('game') || '').trim().toLowerCase();
    const setId = (url.searchParams.get('set_id') || '').trim();
    const rarity = (url.searchParams.get('rarity') || '').trim().toLowerCase();
    const condition = (url.searchParams.get('condition') || '').trim();
    const foil = url.searchParams.get('foil');
    const country = (url.searchParams.get('country') || '').trim().toUpperCase();
    const maxPriceRaw = url.searchParams.get('max_price');
    const maxPrice = maxPriceRaw ? Number(maxPriceRaw) : null;
    const cardId = (url.searchParams.get('card_id') || '').trim();
    const sellerId = (url.searchParams.get('seller_id') || '').trim();
    const likedOnly = url.searchParams.get('liked_only') === 'true';
    const sort = url.searchParams.get('sort') || 'newest';

    if (view === 'mine' && !viewer.caller) {
      return jsonResponse({ success: false, error: 'Authentication required.' }, 401);
    }

    let query = supabaseAdmin
      .from('marketplace_listings')
      .select(`
        id,
        seller_id,
        card_id,
        condition,
        is_foil,
        price_huf,
        quantity,
        status,
        description,
        images,
        likes_count,
        created_at,
        updated_at,
        cards!inner (
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
          set_id,
          sets (
            id,
            code,
            name
          )
        )
      `)
      .is('deleted_at', null);

    if (isUuid(id)) {
      query = query.eq('id', id);
    } else if (view === 'mine') {
      query = query.eq('seller_id', viewer.caller!.user.id);
    } else {
      query = query.eq('status', 'In Stock').gt('quantity', 0);
    }

    if (isUuid(cardId)) {
      query = query.eq('card_id', cardId);
    }
    if (isUuid(sellerId)) {
      query = query.eq('seller_id', sellerId);
    }

    const { data: rows, error } = await query
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      if (isMissingSchemaError(error)) {
        return jsonResponse({ success: true, listings: [], cards: [], schemaReady: false }, 200);
      }
      throw error;
    }

    const allRows = (rows || []) as any[];
    const sellerIds = Array.from(new Set(allRows.map((r) => r.seller_id).filter(Boolean)));
    const listingIds = allRows.map((r) => r.id).filter(Boolean);

    const [profilesMap, ratingsMap, likedSet] = await Promise.all([
      fetchProfilesMap(sellerIds),
      fetchUserRatingMap(sellerIds, 'buyer_to_seller'),
      (async () => {
        const set = new Set<string>();
        if (!viewer.caller || listingIds.length === 0) return set;
        try {
          const { data: likeRows } = await supabaseAdmin
            .from('marketplace_listing_likes')
            .select('listing_id')
            .eq('user_id', viewer.caller.user.id)
            .in('listing_id', listingIds);
          for (const lr of likeRows || []) set.add(lr.listing_id);
        } catch {}
        return set;
      })(),
    ]);

    if (likedOnly && !viewer.caller) {
      return jsonResponse({ success: true, listings: [], cards: [], schemaReady: true }, 200);
    }

    const normCondFilter = condition ? normalizeCardCondition(condition) : '';

    let enriched = allRows.map((row) => {
      const profile = profilesMap.get(row.seller_id) || {
        id: row.seller_id,
        display_name: 'Collector',
        avatar_url: null,
        country: 'HU',
      };
      const rating = ratingsMap.get(row.seller_id) || { avg: 0, count: 0 };
      const card = Array.isArray(row.cards) ? row.cards[0] : row.cards;
      return {
        id: row.id,
        seller_id: row.seller_id,
        card_id: row.card_id,
        condition: normalizeCardCondition(row.condition),
        is_foil: Boolean(row.is_foil),
        price_huf: Number(row.price_huf) || 0,
        quantity: Number(row.quantity) || 0,
        status: row.status,
        description: row.description || null,
        images: Array.isArray(row.images) ? row.images : [],
        likes_count: Number(row.likes_count) || 0,
        liked_by_me: likedSet.has(row.id),
        created_at: row.created_at,
        updated_at: row.updated_at,
        card,
        seller: {
          ...profile,
          rating_avg: rating.avg,
          rating_count: rating.count,
        },
      };
    });

    enriched = enriched.filter((item) => {
      const c = item.card;
      if (!c) return false;
      if (likedOnly && !item.liked_by_me) return false;
      if (game && String(c.game || '').toLowerCase() !== game) return false;
      if (setId && String(c.set_id || '') !== setId && String(c.sets?.code || '').toLowerCase() !== setId.toLowerCase()) return false;
      if (rarity && String(c.rarity || '').toLowerCase() !== rarity) return false;
      if (normCondFilter && item.condition !== normCondFilter) return false;
      if (foil === 'true' && !item.is_foil) return false;
      if (foil === 'false' && item.is_foil) return false;
      if (country && String(item.seller.country || '').toUpperCase() !== country) return false;
      if (maxPrice !== null && Number.isFinite(maxPrice) && maxPrice > 0 && item.price_huf > maxPrice) return false;
      if (q) {
        const hay = [
          c.name,
          c.card_number,
          c.sets?.name,
          c.sets?.code,
          item.seller.display_name,
          item.description,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sort === 'price_asc') {
      enriched.sort((a, b) => a.price_huf - b.price_huf);
    } else if (sort === 'price_desc') {
      enriched.sort((a, b) => b.price_huf - a.price_huf);
    } else if (sort === 'likes') {
      enriched.sort((a, b) => b.likes_count - a.likes_count || b.created_at.localeCompare(a.created_at));
    } else {
      enriched.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    // Group offers by (card_id, is_foil) for the "By Card" marketplace view
    const groupedMap = new Map<string, any>();
    for (const item of enriched) {
      const key = `${item.card_id}:${item.is_foil ? 'foil' : 'norm'}`;
      let group = groupedMap.get(key);
      if (!group) {
        group = {
          key,
          card_id: item.card_id,
          is_foil: item.is_foil,
          card: item.card,
          lowest_price_huf: item.price_huf,
          highest_price_huf: item.price_huf,
          total_quantity: 0,
          offer_count: 0,
          sellerIds: new Set<string>(),
          offers: [],
        };
        groupedMap.set(key, group);
      }
      group.lowest_price_huf = Math.min(group.lowest_price_huf, item.price_huf);
      group.highest_price_huf = Math.max(group.highest_price_huf, item.price_huf);
      group.total_quantity += item.quantity;
      group.offer_count += 1;
      group.sellerIds.add(item.seller_id);
      group.offers.push(item);
    }

    const cards = Array.from(groupedMap.values()).map((g) => {
      g.offers.sort((a: any, b: any) => a.price_huf - b.price_huf);
      return {
        key: g.key,
        card_id: g.card_id,
        is_foil: g.is_foil,
        card: g.card,
        lowest_price_huf: g.lowest_price_huf,
        highest_price_huf: g.highest_price_huf,
        total_quantity: g.total_quantity,
        offer_count: g.offer_count,
        sellers_count: g.sellerIds.size,
        offers: g.offers,
      };
    });

    if (sort === 'price_asc') {
      cards.sort((a, b) => a.lowest_price_huf - b.lowest_price_huf);
    } else if (sort === 'price_desc') {
      cards.sort((a, b) => b.lowest_price_huf - a.lowest_price_huf);
    }

    return jsonResponse({
      success: true,
      schemaReady: true,
      listings: enriched,
      cards,
    });
  } catch (err: any) {
    console.error('Marketplace listings GET error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to load marketplace listings.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body) {
      return jsonResponse({ success: false, error: 'Invalid request body.' }, 400);
    }

    const cardId = isUuid(body.card_id) ? body.card_id.trim() : null;
    if (!cardId) {
      return jsonResponse({ success: false, error: 'Please select a valid card.' }, 400);
    }

    const { data: cardRow } = await supabaseAdmin
      .from('cards')
      .select('id, name, card_number')
      .eq('id', cardId)
      .maybeSingle();

    if (!cardRow) {
      return jsonResponse({ success: false, error: 'Card not found in catalog.' }, 404);
    }

    const priceHuf = Math.round(Number(body.price_huf));
    if (!Number.isFinite(priceHuf) || priceHuf < 1 || priceHuf > 50_000_000) {
      return jsonResponse({ success: false, error: 'Price must be between 1 and 50,000,000 HUF.' }, 400);
    }

    const quantity = Math.round(Number(body.quantity ?? 1));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 500) {
      return jsonResponse({ success: false, error: 'Quantity must be between 1 and 500.' }, 400);
    }

    const condition = normalizeCardCondition(body.condition || 'Near Mint');
    if (!(LISTING_CONDITIONS as readonly string[]).includes(condition)) {
      return jsonResponse({ success: false, error: 'Invalid card condition.' }, 400);
    }

    const isFoil = Boolean(body.is_foil);
    const description = sanitizePlainText(body.description || '', 600) || null;
    const images = sanitizeImageUrls(body.images, P2P_MAX_POST_IMAGES);

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('marketplace_listings')
      .insert({
        seller_id: auth.caller.user.id,
        card_id: cardId,
        condition,
        is_foil: isFoil,
        price_huf: priceHuf,
        quantity,
        status: 'In Stock',
        handover_methods: ['chat'],
        description,
        images,
      })
      .select('*')
      .single();

    if (insErr) {
      if (isMissingSchemaError(insErr)) {
        return jsonResponse({ success: false, error: 'Marketplace tables require DB migration.' }, 503);
      }
      throw insErr;
    }

    return jsonResponse({ success: true, listing: inserted }, 201);
  } catch (err: any) {
    console.error('Marketplace listing POST error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to create listing.' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    const id = isUuid(body?.id) ? body.id.trim() : null;
    if (!id) {
      return jsonResponse({ success: false, error: 'Missing listing id.' }, 400);
    }

    const { data: existing, error: selErr } = await supabaseAdmin
      .from('marketplace_listings')
      .select('id, seller_id, status, quantity')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (selErr) throw selErr;
    if (!existing) {
      return jsonResponse({ success: false, error: 'Listing not found.' }, 404);
    }
    if (existing.seller_id !== auth.caller.user.id && !auth.caller.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden.' }, 403);
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    if (body.price_huf !== undefined) {
      const p = Math.round(Number(body.price_huf));
      if (!Number.isFinite(p) || p < 1 || p > 50_000_000) {
        return jsonResponse({ success: false, error: 'Invalid price.' }, 400);
      }
      updates.price_huf = p;
    }
    if (body.quantity !== undefined) {
      const q = Math.round(Number(body.quantity));
      if (!Number.isFinite(q) || q < 0 || q > 500) {
        return jsonResponse({ success: false, error: 'Invalid quantity.' }, 400);
      }
      updates.quantity = q;
      if (q === 0) updates.status = 'Sold Out';
      else if (existing.status === 'Sold Out') updates.status = 'In Stock';
    }
    if (body.condition !== undefined) {
      const c = normalizeCardCondition(body.condition);
      if (!(LISTING_CONDITIONS as readonly string[]).includes(c)) {
        return jsonResponse({ success: false, error: 'Invalid condition.' }, 400);
      }
      updates.condition = c;
    }
    if (body.is_foil !== undefined) {
      updates.is_foil = Boolean(body.is_foil);
    }
    if (body.description !== undefined) {
      updates.description = sanitizePlainText(body.description || '', 600) || null;
    }
    if (body.images !== undefined) {
      updates.images = sanitizeImageUrls(body.images, P2P_MAX_POST_IMAGES);
    }
    if (body.status === 'In Stock' || body.status === 'Paused') {
      const targetQty = updates.quantity ?? existing.quantity;
      updates.status = targetQty <= 0 ? 'Sold Out' : body.status;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('marketplace_listings')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (updErr) throw updErr;
    return jsonResponse({ success: true, listing: updated }, 200);
  } catch (err: any) {
    console.error('Marketplace listing PATCH error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to update listing.' }, 500);
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
      return jsonResponse({ success: false, error: 'Invalid listing id.' }, 400);
    }

    const { data: existing } = await supabaseAdmin
      .from('marketplace_listings')
      .select('id, seller_id')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!existing) {
      return jsonResponse({ success: false, error: 'Listing not found.' }, 404);
    }
    if (existing.seller_id !== auth.caller.user.id && !auth.caller.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden.' }, 403);
    }

    const { error: delErr } = await supabaseAdmin
      .from('marketplace_listings')
      .update({ deleted_at: new Date().toISOString(), status: 'Paused' })
      .eq('id', id);

    if (delErr) throw delErr;
    return jsonResponse({ success: true }, 200);
  } catch (err: any) {
    console.error('Marketplace listing DELETE error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to delete listing.' }, 500);
  }
};
