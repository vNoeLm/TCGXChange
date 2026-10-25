import type { APIRoute } from 'astro';
import { isUnreleasedSet } from '../../../lib/cardPreview';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getSellerTier } from '../../../lib/badges';
import {
  listingSignature,
  cleanListingDescription,
} from '../../../lib/sellerNotes';
import { normalizeShipping, sellerVisibleToCountry } from '../../../lib/shipping';
import { adjustSellerCollection } from '../../../lib/collectionServer';
import { findSearchableKeyword, keywordOrClauses, tagOrClauses } from '../../../lib/keywordSearch';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};


import { OWNER_ID } from '../../../lib/constants';
import { loadTradeOrders } from '../../../lib/tradeOrders';

// ─── GET: Query Marketplace Listings (with Seller Profiles, Ratings & Photos) ───
/** Ratings buyers gave these sellers, as { seller_id, rating } rows - from the two-way review table,
 *  or the old seller-only one until its migration has been run. */
async function sellerRatingRows(sellerIds: string[]): Promise<{ data: { seller_id: string; rating: number }[] }> {
  const { data, error } = await supabaseAdmin
    .from('user_reviews')
    .select('reviewee_id, rating')
    .eq('direction', 'buyer_to_seller')
    .in('reviewee_id', sellerIds);
  if (!error) return { data: (data || []).map((r: any) => ({ seller_id: r.reviewee_id, rating: Number(r.rating) })) };
  const { data: old } = await supabaseAdmin.from('seller_reviews').select('seller_id, rating').in('seller_id', sellerIds);
  return { data: (old || []) as { seller_id: string; rating: number }[] };
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const game = url.searchParams.get('game');
    const search = url.searchParams.get('search')?.trim().toLowerCase() || '';
    const set = url.searchParams.get('set') || '';
    const raritiesParam = url.searchParams.get('rarities') || '';
    const rarities = raritiesParam ? raritiesParam.split(',').filter(Boolean) : [];
    const type = url.searchParams.get('type') || '';
    const domainsParam = url.searchParams.get('domains') || '';
    const domains = domainsParam ? domainsParam.split(',').filter(Boolean) : [];
    const foil = url.searchParams.get('foil');
    const sellerId = url.searchParams.get('seller_id') || '';
    const sellerNameQuery = url.searchParams.get('seller')?.trim().toLowerCase() || '';
    // Which country's marketplace is being browsed. Sellers in that country, plus sellers who
    // listed it as an international destination, are visible; the rest are filtered out below.
    const viewerCountry = (url.searchParams.get('viewer_country') || 'HU').toUpperCase();
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    // The grouped "cards" marketplace view needs every active listing at once to compute
    // per-card lowest/average prices, hence the higher ceiling.
    const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10)));

    // 1. Fetch from native marketplace_listings table (primary) with fallback to legacy inventory
    const statusParam = url.searchParams.get('status');
    let mktQuery = supabaseAdmin
      .from('marketplace_listings')
      .select(`
        id,
        seller_id,
        card_id,
        condition,
        is_foil,
        price_huf,
        status,
        description,
        handover_methods,
        quantity,
        views,
        clicks,
        images,
        created_at,
        updated_at,
        cards!inner (
          id,
          card_number,
          name,
          rarity,
          card_type,
          cost,
          image_path,
          subtype,
          text,
          game,
          energy,
          might,
          domain,
          tags,
          ability,
          artist,
          market_price_eur,
          market_price_foil_eur,
          sets (
            id,
            name,
            code,
            release_date
          )
        )
      `);

    if (sellerId) {
      mktQuery = mktQuery.eq('seller_id', sellerId);
      if (statusParam && statusParam !== 'all') {
        if (statusParam === 'on_hold' || statusParam === 'On Hold' || statusParam === 'Reserved') {
          mktQuery = mktQuery.in('status', ['Reserved', 'On Hold']);
        } else if (statusParam === 'in_stock') {
          mktQuery = mktQuery.eq('status', 'In Stock').gt('quantity', 0);
        } else {
          mktQuery = mktQuery.eq('status', statusParam);
        }
      }
    } else {
      mktQuery = mktQuery.eq('status', 'In Stock').gt('quantity', 0);
    }

    if (game && game !== 'all') {
      mktQuery = mktQuery.eq('cards.game', game);
    }
    if (search) {
      const safeTerm = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); const like = '"%' + safeTerm + '%"';
      const clauses = [`name.ilike.${like}`, `card_number.ilike.${like}`, `artist.ilike.${like}`, ...tagOrClauses(search)];
      const searchedKeyword = findSearchableKeyword(search);
      if (searchedKeyword) clauses.push(...keywordOrClauses(searchedKeyword));
      mktQuery = mktQuery.or(clauses.join(','), { foreignTable: 'cards' });
    }
    const tagsParam = url.searchParams.get('tags') || '';
    const filterTags = tagsParam ? tagsParam.split(',').filter(Boolean) : [];
    if (filterTags.length > 0) {
      const tagQuery = filterTags.map(t => `tags.cs.["${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join(',');
      mktQuery = mktQuery.or(tagQuery, { foreignTable: 'cards' });
    }
    if (set) {
      mktQuery = mktQuery.eq('cards.sets.name', set);
    }
    if (rarities.length > 0) {
      mktQuery = mktQuery.in('cards.rarity', rarities);
    }
    if (type) {
      if (type === 'Champion') {
        mktQuery = mktQuery.eq('cards.subtype', 'Champion');
      } else if (type === 'Signature Spell') {
        mktQuery = mktQuery.eq('cards.card_type', 'Spell').ilike('cards.subtype', '%Signature%');
      } else {
        mktQuery = mktQuery.eq('cards.card_type', type);
      }
    }
    if (domains.length > 0) {
      const orQuery = domains.map(d => `domain.ilike.%${d}%`).join(',');
      mktQuery = mktQuery.or(orQuery, { foreignTable: 'cards' });
    }
    if (foil === 'true') {
      mktQuery = mktQuery.eq('is_foil', true);
    }

    const { data: mktData, error: mktError } = await mktQuery;
    if (mktError) throw mktError;
    const rawSourceRows: any[] = mktData || [];

    const invRows = rawSourceRows.filter((r: any) => !isUnreleasedSet(r.cards?.sets?.release_date));

    // Collect all seller IDs to batch fetch user profiles
    const sellerIds = new Set<string>();

    invRows.forEach((r: any) => {
      const sId = r.seller_id;
      if (sId) sellerIds.add(sId);
    });

    // Also include platform owner ID as fallback
    sellerIds.add(OWNER_ID);

    // These queries run together concurrently
    const [{ data: profileData, error: profileError }, { data: reviewRows }, tradeOrders, { data: shippingRows }] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, display_name, avatar_url, role, is_admin, country')
        .in('id', Array.from(sellerIds)),
      sellerRatingRows(Array.from(sellerIds)),
      loadTradeOrders(),
      supabaseAdmin
        .from('seller_shipping')
        .select('seller_id, options')
        .in('seller_id', Array.from(sellerIds)),
    ]);

    // Before the country migration is applied the select above errors as a whole; fall back to
    // the profile fields that already existed so names and avatars keep working.
    let profileRows = profileData;
    if (profileError) {
      const fallback = await supabaseAdmin
        .from('profiles')
        .select('id, display_name, avatar_url, role, is_admin')
        .in('id', Array.from(sellerIds));
      profileRows = (fallback.data || []) as typeof profileRows;
    }

    const profileMap = new Map((profileRows || []).map(p => [p.id, p]));
    const shippingMap = new Map((shippingRows || []).map((r: any) => [r.seller_id, r.options || {}]));

    const ratingsMap = new Map<string, { total: number; count: number }>();
    (reviewRows || []).forEach((r: any) => {
      const cur = ratingsMap.get(r.seller_id) || { total: 0, count: 0 };
      cur.total += Number(r.rating);
      cur.count += 1;
      ratingsMap.set(r.seller_id, cur);
    });

    // Two distinct stats, deliberately kept separate: `distinctSalesMap` counts completed
    // transactions (orders) per seller — this is what should gate seller tier, so a single
    // buyer purchasing 100 cards in one order doesn't vault a seller to the top tier.
    // `itemsSoldMap` counts total units moved, purely informational ("Cards Sold").
    const distinctSalesMap = new Map<string, number>();
    const itemsSoldMap = new Map<string, number>();
    if (Array.isArray(tradeOrders)) {
      tradeOrders.forEach((ord) => {
        if (ord.status !== 'Cancelled' && ord.seller_id) {
          distinctSalesMap.set(ord.seller_id, (distinctSalesMap.get(ord.seller_id) || 0) + 1);
          const itemCount = Array.isArray(ord.items)
            ? ord.items.reduce((s: number, it: any) => s + (it.quantity || 1), 0)
            : 1;
          itemsSoldMap.set(ord.seller_id, (itemsSoldMap.get(ord.seller_id) || 0) + itemCount);
        }
      });
    }

    const EUR_TO_HUF = 400;
    const allFormatted: any[] = [];

    // Format native marketplace_listings rows
    invRows.forEach((row: any) => {
      const sId = row.seller_id || OWNER_ID;
      if (sellerId && sId !== sellerId) return;

      const prof = profileMap.get(sId);
      const resolvedSellerName = prof?.display_name || (prof?.role === 'owner' ? 'Noel :3' : 'Community Seller');
      if (sellerNameQuery && !resolvedSellerName.toLowerCase().includes(sellerNameQuery)) return;

      const ratingInfo = ratingsMap.get(sId);
      const avgRating = ratingInfo && ratingInfo.count > 0 ? ratingInfo.total / ratingInfo.count : null;
      const reviewCount = ratingInfo ? ratingInfo.count : 0;
      const salesCount = distinctSalesMap.get(sId) || 0;
      const itemsSold = itemsSoldMap.get(sId) || 0;
      const isOwner = sId === OWNER_ID || prof?.role === 'owner';
      const sellerTier = getSellerTier(salesCount, avgRating, isOwner);

      let views = typeof row.views === 'number' ? row.views : 0;
      let clicks = typeof row.clicks === 'number' ? row.clicks : 0;
      let handoverMethods = Array.isArray(row.handover_methods) && row.handover_methods.length > 0
        ? row.handover_methods
        : ['personal', 'foxpost', 'packeta', 'other'];

      const cardObj = row.cards;
      const photoUrls: string[] = Array.isArray(row.images) ? row.images : [];
      const invImgs: any[] = photoUrls.map((p: string, idx: number) => ({ id: `img_${row.id}_${idx}`, image_path: p, display_order: idx + 1 }));
      const firstCustomPhoto: string | null = photoUrls[0] || null;

      const displayStatus = (row.status === 'Reserved' || row.status === 'On Hold') ? 'On Hold' : row.status;

      allFormatted.push({
        inventory_id: row.id,
        condition: row.condition || 'Near Mint',
        is_foil: Boolean(row.is_foil),
        price_huf: row.price_huf,
        status: displayStatus,
        handover_methods: handoverMethods,
        notes: row.description,
        is_bulk: false,
        quantity: row.quantity,
        views,
        clicks,
        seller_badge: sellerTier.nameEn,
        seller_badge_icon: sellerTier.icon,
        seller_tier: sellerTier.tier,
        seller_sales_count: salesCount,
        seller_items_sold: itemsSold,
        card_id: cardObj.id,
        card_number: cardObj.card_number,
        name: cardObj.name,
        rarity: cardObj.rarity,
        card_type: cardObj.card_type,
        cost: cardObj.cost,
        image_path: firstCustomPhoto || cardObj.image_path,
        card_image_path: cardObj.image_path,
        inventory_image: firstCustomPhoto,
        inventory_images: invImgs,
        subtype: cardObj.subtype,
        text: cardObj.text,
        game: cardObj.game,
        energy: cardObj.energy,
        might: cardObj.might,
        domain: cardObj.domain,
        tags: cardObj.tags,
        ability: cardObj.ability,
        artist: cardObj.artist,
        market_price_eur: cardObj.market_price_eur,
        market_price_foil_eur: cardObj.market_price_foil_eur,
        set_id: cardObj.sets?.id,
        set_name: cardObj.sets?.name,
        set_code: cardObj.sets?.code,
        sets: cardObj.sets,
        seller_id: sId,
        seller_name: resolvedSellerName,
        seller_avatar: prof?.avatar_url || null,
        seller_country: ((prof as any)?.country || 'HU').toUpperCase(),
        seller_role: isOwner ? 'owner' : (prof?.role || (prof?.is_admin ? 'admin' : 'user')),
        seller_rating_avg: avgRating,
        seller_rating_count: reviewCount,
        is_marketplace_listing: true,
        created_at: row.created_at,
      });
    });

    // Sort by created_at descending
    allFormatted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Country-scoped marketplace: a seller is visible if they are in the viewer's country, or if
    // they listed that country as an international destination. Opening one seller directly
    // (?seller_id=) is never scoped, so a shared profile link still shows their listings.
    const scoped = sellerId
      ? allFormatted
      : allFormatted.filter((item) => {
          const settings = normalizeShipping(shippingMap.get(item.seller_id));
          return sellerVisibleToCountry(settings, item.seller_country || 'HU', viewerCountry);
        });

    // Apply pagination
    const totalCount = scoped.length;
    const startIndex = (page - 1) * pageSize;
    const paginated = scoped.slice(startIndex, startIndex + pageSize);

    return new Response(JSON.stringify({
      success: true,
      data: paginated,
      count: totalCount,
    }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Marketplace GET error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

// ─── POST: Create or Update a Marketplace Listing ───────────────────────
export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: missing bearer token.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: invalid token.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const body = await request.json();
    const { card_id, quantity, price_huf, condition, is_foil, images, handover_methods } = body;
    const description = cleanListingDescription(body.description);

    if (!card_id) {
      return new Response(JSON.stringify({ success: false, error: 'card_id is required.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const safeQty = Math.max(1, parseInt(String(quantity), 10) || 1);
    const safePriceHuf = Math.max(1, parseInt(String(price_huf), 10) || 500);

    // Condition photos are always optional - a seller can choose to add them for any listing,
    // but nothing requires it regardless of price.
    const photoList: string[] = Array.isArray(images)
      ? images.filter((u: any) => typeof u === 'string' && u.trim().length > 0)
      : [];

    // Ensure seller profile exists in profiles table
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .eq('id', user.id)
      .maybeSingle();

    if (!existingProfile) {
      const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Collector';
      await supabaseAdmin.from('profiles').insert({
        id: user.id,
        email: user.email,
        display_name: displayName,
        avatar_url: user.user_metadata?.avatar_url || null,
        role: (user.email === 'vnoel05@gmail.com' || user.email === 'support@tcgxchange.net') ? 'owner' : 'user',
        is_admin: user.email === 'vnoel05@gmail.com' || user.email === 'support@tcgxchange.net',
      });
    }

    const safeHandoverMethods = Array.isArray(handover_methods) && handover_methods.length > 0
      ? handover_methods
      : ['personal', 'foxpost', 'packeta', 'other'];

    // Merge into this seller's existing listing in marketplace_listings
    const { data: dupeCandidates } = await supabaseAdmin
      .from('marketplace_listings')
      .select('id, card_id, condition, is_foil, quantity, description, images')
      .eq('card_id', card_id)
      .eq('seller_id', user.id)
      .in('status', ['In Stock', 'Available']);

    const targetSignature = listingSignature(card_id, condition || 'Near Mint', Boolean(is_foil));
    const duplicate = (dupeCandidates || []).find(
      (row: any) => listingSignature(row.card_id, row.condition, row.is_foil) === targetSignature
    );

    const { data: mktRow, error: mktErr } = duplicate
      ? await supabaseAdmin
          .from('marketplace_listings')
          .update({
            quantity: (duplicate.quantity || 0) + safeQty,
            price_huf: safePriceHuf,
            condition: condition || 'Near Mint',
            is_foil: Boolean(is_foil),
            handover_methods: safeHandoverMethods,
            ...(description ? { description } : {}),
            ...(photoList.length > 0 ? { images: photoList } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', duplicate.id)
          .select('id, card_id, condition, is_foil, price_huf, quantity, status, description, images')
          .single()
      : await supabaseAdmin
          .from('marketplace_listings')
          .insert({
            seller_id: user.id,
            card_id,
            condition: condition || 'Near Mint',
            is_foil: Boolean(is_foil),
            price_huf: safePriceHuf,
            quantity: safeQty,
            status: 'In Stock',
            handover_methods: safeHandoverMethods,
            description: description || null,
            images: photoList,
          })
          .select('id, card_id, condition, is_foil, price_huf, quantity, status, description, images')
          .single();

    if (mktErr) {
      console.error('Failed to create marketplace listing:', mktErr);
      const missingTable = mktErr.code === 'PGRST205' || mktErr.code === '42P01' || /schema cache/i.test(mktErr.message || '');
      return new Response(JSON.stringify({
        success: false,
        error: missingTable
          ? 'Marketplace storage is not set up yet. Run supabase/migrations/20261024010000_marketplace_listings_setup.sql in the Supabase SQL editor, then try again.'
          : mktErr.message,
      }), {
        status: missingTable ? 503 : 500,
        headers: JSON_HEADERS,
      });
    }

    // Copies committed to a listing leave the seller's tracked collection immediately
    await adjustSellerCollection(user.id, card_id, Boolean(is_foil), -safeQty);

    return new Response(JSON.stringify({
      success: true,
      listing: {
        ...mktRow,
        inventory_id: mktRow.id,
        images: photoList,
      },
    }), {
      status: 201,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Marketplace POST error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

// ─── DELETE: Unlist / Remove a Marketplace Listing ──────────────────────
export const DELETE: APIRoute = async ({ request, url }) => {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const listingId = url.searchParams.get('id') || (await request.json().catch(() => ({})))?.id;
    if (!listingId) {
      return new Response(JSON.stringify({ success: false, error: 'Missing listing id.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // 1. Try deleting from marketplace_listings
    const { data: mktRow } = await supabaseAdmin
      .from('marketplace_listings')
      .select('id, seller_id, card_id, is_foil, quantity, collection_id')
      .eq('id', listingId)
      .maybeSingle();

    if (mktRow) {
      if (mktRow.seller_id !== user.id) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden: not your listing.' }), {
          status: 403,
          headers: JSON_HEADERS,
        });
      }
      await supabaseAdmin.from('marketplace_listings').delete().eq('id', listingId);
      return new Response(JSON.stringify({
        success: true,
        listing_id: listingId,
      }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Listing not found.' }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Marketplace DELETE error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

// ─── PATCH: Quick Edit Price / Quantity / Status (In Stock, On Hold, Sold) ───
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const body = await request.json().catch(() => null);
    const id = body?.id || body?.inventory_id;
    if (!body || !id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing listing id.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const { price_huf, quantity, status, condition } = body;

    // 1. Try marketplace_listings
    const { data: mktRow } = await supabaseAdmin
      .from('marketplace_listings')
      .select('id, seller_id, status, quantity, price_huf, card_id, is_foil, description, handover_methods, images')
      .eq('id', id)
      .maybeSingle();

    if (mktRow) {
      if (mktRow.seller_id !== user.id) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden: not your listing.' }), {
          status: 403,
          headers: JSON_HEADERS,
        });
      }
      const updates: any = { updated_at: new Date().toISOString() };
      if (typeof price_huf === 'number') updates.price_huf = price_huf;
      if (typeof quantity === 'number') updates.quantity = quantity;
      if (status) {
        const dbStatus = (status === 'On Hold' || status === 'Reserved') ? 'Reserved' : status;
        updates.status = dbStatus;
        if (dbStatus === 'Sold') updates.quantity = 0;
        else if (dbStatus === 'In Stock' && mktRow.quantity <= 0) updates.quantity = 1;
      }
      if (condition) updates.condition = condition;
      if (typeof body.description === 'string') updates.description = cleanListingDescription(body.description);
      if (Array.isArray(body.handover_methods)) updates.handover_methods = body.handover_methods;
      if (Array.isArray(body.images)) updates.images = body.images;

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('marketplace_listings')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return new Response(JSON.stringify({ success: false, error: updateErr.message }), {
          status: 500,
          headers: JSON_HEADERS,
        });
      }

      return new Response(JSON.stringify({
        success: true,
        listing: updated,
      }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Listing not found.' }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Marketplace PATCH error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
