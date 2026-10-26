import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getSellerTier } from '../../../lib/badges';
import { OWNER_ID } from '../../../lib/constants';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

// ─── GET: Fetch Marketplace Trades ─────────────────────────────────────
export const GET: APIRoute = async ({ url }) => {
  try {
    const game = url.searchParams.get('game');
    const search = url.searchParams.get('search')?.trim().toLowerCase() || '';
    const traderId = url.searchParams.get('trader_id') || url.searchParams.get('seller_id') || '';
    const sellerQuery = url.searchParams.get('seller')?.trim().toLowerCase() || '';
    const statusParam = url.searchParams.get('status') || 'open';
    const sort = url.searchParams.get('sort') || 'recent';

    let query = supabaseAdmin
      .from('marketplace_trades')
      .select(`
        id,
        trader_id,
        offered_card_id,
        offered_condition,
        offered_is_foil,
        offered_quantity,
        offered_images,
        wanted_card_id,
        wanted_min_condition,
        wanted_is_foil,
        wanted_quantity,
        cash_difference_huf,
        handover_methods,
        description,
        status,
        likes_count,
        views,
        created_at,
        updated_at,
        offered_card:cards!marketplace_trades_offered_card_id_fkey (
          id, card_number, name, rarity, card_type, cost, image_path,
          subtype, text, game, energy, might, domain, tags, ability, artist,
          sets ( id, name, code )
        ),
        wanted_card:cards!marketplace_trades_wanted_card_id_fkey (
          id, card_number, name, rarity, card_type, cost, image_path,
          subtype, text, game, energy, might, domain, tags, ability, artist,
          sets ( id, name, code )
        )
      `);

    if (traderId) {
      query = query.eq('trader_id', traderId);
    } else if (statusParam && statusParam !== 'all') {
      if (statusParam === 'open') {
        query = query.in('status', ['open', 'on_hold']);
      } else {
        query = query.eq('status', statusParam);
      }
    }

    const { data: rawTrades, error: tradesErr } = await query;

    if (tradesErr) {
      // Table may not exist yet in schema cache
      const isMissingTable = tradesErr.code === 'PGRST205' || tradesErr.code === '42P01' || /schema cache/i.test(tradesErr.message || '');
      return new Response(JSON.stringify({
        success: true,
        data: [],
        count: 0,
        setup_needed: isMissingTable,
      }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    let tradeRows = (rawTrades || []).filter((r: any) => !r.deleted_at);

    // Filter by game if specified
    if (game && game !== 'all') {
      tradeRows = tradeRows.filter((r: any) => {
        const offGame = r.offered_card?.game;
        const wantGame = r.wanted_card?.game;
        return offGame === game || wantGame === game;
      });
    }

    // Filter by search query (matches offered card or wanted card name / number / trader)
    if (search) {
      tradeRows = tradeRows.filter((r: any) => {
        const offName = (r.offered_card?.name || '').toLowerCase();
        const offNum = (r.offered_card?.card_number || '').toLowerCase();
        const wantName = (r.wanted_card?.name || '').toLowerCase();
        const wantNum = (r.wanted_card?.card_number || '').toLowerCase();
        return offName.includes(search) || offNum.includes(search) || wantName.includes(search) || wantNum.includes(search);
      });
    }

    // Batch fetch trader profiles
    const traderIds = Array.from(new Set(tradeRows.map((r: any) => r.trader_id).filter(Boolean)));
    const { data: profiles } = traderIds.length > 0
      ? await supabaseAdmin.from('profiles').select('id, display_name, avatar_url, country, role').in('id', traderIds)
      : { data: [] };

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    let formattedTrades = tradeRows.map((row: any) => {
      const prof = profileMap.get(row.trader_id);
      const traderName = prof?.display_name || (row.trader_id === OWNER_ID ? 'Noel :3' : 'Community Trader');
      const traderCountry = (prof?.country || 'HU').toUpperCase();
      const isOwner = row.trader_id === OWNER_ID || prof?.role === 'owner';
      const tier = getSellerTier(0, null, isOwner);

      return {
        id: row.id,
        trader_id: row.trader_id,
        trader_name: traderName,
        trader_avatar: prof?.avatar_url || null,
        trader_country: traderCountry,
        trader_tier: tier.tier,
        trader_badge: tier.nameEn,

        offered_card_id: row.offered_card_id,
        offered_card: row.offered_card,
        offered_condition: row.offered_condition || 'Near Mint',
        offered_is_foil: Boolean(row.offered_is_foil),
        offered_quantity: row.offered_quantity || 1,
        offered_images: Array.isArray(row.offered_images) ? row.offered_images : [],

        wanted_card_id: row.wanted_card_id,
        wanted_card: row.wanted_card,
        wanted_min_condition: row.wanted_min_condition || 'Near Mint',
        wanted_is_foil: row.wanted_is_foil,
        wanted_quantity: row.wanted_quantity || 1,

        cash_difference_huf: row.cash_difference_huf || 0,
        handover_methods: Array.isArray(row.handover_methods) ? row.handover_methods : ['personal', 'foxpost', 'packeta', 'other'],
        description: row.description || null,
        status: row.status || 'open',
        likes_count: typeof row.likes_count === 'number' ? row.likes_count : 0,
        views: typeof row.views === 'number' ? row.views : 0,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    if (sellerQuery) {
      formattedTrades = formattedTrades.filter((t: any) =>
        (t.trader_name || '').toLowerCase().includes(sellerQuery)
      );
    }

    // Sort
    if (sort === 'likes') {
      formattedTrades.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
    } else {
      formattedTrades.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return new Response(JSON.stringify({
      success: true,
      data: formattedTrades,
      count: formattedTrades.length,
    }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Marketplace trades GET error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

// ─── POST: Create a Trade Listing ───────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: please sign in.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: invalid session.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const body = await request.json().catch(() => ({}));
    const {
      offered_card_id,
      offered_condition = 'Near Mint',
      offered_is_foil = false,
      offered_quantity = 1,
      offered_images = [],
      wanted_card_id,
      wanted_min_condition = 'Near Mint',
      wanted_is_foil = null,
      wanted_quantity = 1,
      cash_difference_huf = 0,
      handover_methods = ['personal', 'foxpost', 'packeta', 'other'],
      description = '',
    } = body;

    if (!offered_card_id || !wanted_card_id) {
      return new Response(JSON.stringify({ success: false, error: 'Both offered card and wanted card are required.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // Ensure profile exists
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!existingProfile) {
      const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Trader';
      await supabaseAdmin.from('profiles').insert({
        id: user.id,
        email: user.email,
        display_name: displayName,
        avatar_url: user.user_metadata?.avatar_url || null,
        role: user.email === 'vnoel05@gmail.com' ? 'owner' : 'user',
      });
    }

    const photoList = Array.isArray(offered_images)
      ? offered_images.filter((u: any) => typeof u === 'string' && u.trim().length > 0)
      : [];

    const { data: createdTrade, error: insertErr } = await supabaseAdmin
      .from('marketplace_trades')
      .insert({
        trader_id: user.id,
        offered_card_id,
        offered_condition,
        offered_is_foil: Boolean(offered_is_foil),
        offered_quantity: Math.max(1, parseInt(String(offered_quantity), 10) || 1),
        offered_images: photoList,
        wanted_card_id,
        wanted_min_condition,
        wanted_is_foil: wanted_is_foil === null ? null : Boolean(wanted_is_foil),
        wanted_quantity: Math.max(1, parseInt(String(wanted_quantity), 10) || 1),
        cash_difference_huf: parseInt(String(cash_difference_huf), 10) || 0,
        handover_methods: Array.isArray(handover_methods) && handover_methods.length > 0 ? handover_methods : ['personal', 'foxpost', 'packeta', 'other'],
        description: description?.trim() || null,
        status: 'open',
      })
      .select('*')
      .single();

    if (insertErr) {
      console.error('Failed to create trade:', insertErr);
      const isMissingTable = insertErr.code === 'PGRST205' || insertErr.code === '42P01' || /schema cache/i.test(insertErr.message || '');
      return new Response(JSON.stringify({
        success: false,
        error: isMissingTable
          ? 'Trade storage is being initialized. Run supabase/migrations/20261026000000_marketplace_trades_and_likes.sql in Supabase SQL editor.'
          : insertErr.message,
      }), {
        status: isMissingTable ? 503 : 500,
        headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      trade: createdTrade,
    }), {
      status: 201,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Trade POST error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

// ─── DELETE: Remove a Trade Listing ─────────────────────────────────────
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
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const tradeId = url.searchParams.get('id') || (await request.json().catch(() => ({})))?.id;
    if (!tradeId) {
      return new Response(JSON.stringify({ success: false, error: 'Missing trade id.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const { data: trade } = await supabaseAdmin
      .from('marketplace_trades')
      .select('id, trader_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (!trade) {
      return new Response(JSON.stringify({ success: false, error: 'Trade not found.' }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }

    if (trade.trader_id !== user.id && user.id !== OWNER_ID) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden: not your trade.' }), {
        status: 403,
        headers: JSON_HEADERS,
      });
    }

    await supabaseAdmin.from('marketplace_trades').delete().eq('id', tradeId);

    return new Response(JSON.stringify({ success: true, trade_id: tradeId }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Trade DELETE error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

// ─── PATCH: Update Trade Status (e.g. Completed or Cancelled) ───────────
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
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const body = await request.json().catch(() => ({}));
    const { id, status } = body;

    if (!id || !status) {
      return new Response(JSON.stringify({ success: false, error: 'Missing id or status.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const { data: trade } = await supabaseAdmin
      .from('marketplace_trades')
      .select('id, trader_id')
      .eq('id', id)
      .maybeSingle();

    if (!trade || (trade.trader_id !== user.id && user.id !== OWNER_ID)) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden.' }), {
        status: 403,
        headers: JSON_HEADERS,
      });
    }

    const nowIso = new Date().toISOString();
    await supabaseAdmin
      .from('marketplace_trades')
      .update({ status, updated_at: nowIso })
      .eq('id', id);

    // Sync any open hold request for this trade
    if (status === 'open') {
      await supabaseAdmin
        .from('hold_requests')
        .update({ status: 'cancelled', updated_at: nowIso })
        .eq('inventory_id', id)
        .in('status', ['pending', 'held']);
    } else if (status === 'completed') {
      await supabaseAdmin
        .from('hold_requests')
        .update({ status: 'completed', updated_at: nowIso })
        .eq('inventory_id', id)
        .in('status', ['pending', 'held', 'handed_over', 'buyer_received']);
    }

    return new Response(JSON.stringify({ success: true, id, status }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Trade PATCH error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
