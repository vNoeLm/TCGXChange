import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export const GET: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: true, saved_listing_ids: [], saved_trade_ids: [] });
    }

    const user = caller.user;

    let listingSaves: any[] = [];
    let tradeSaves: any[] = [];
    try {
      const res = await supabaseAdmin.from('marketplace_listing_saves').select('listing_id').eq('user_id', user.id);
      if (res.data) listingSaves = res.data;
    } catch {}
    try {
      const res = await supabaseAdmin.from('marketplace_trade_saves').select('trade_id').eq('user_id', user.id);
      if (res.data) tradeSaves = res.data;
    } catch {}

    const rawListingIds = (listingSaves || []).map((r: any) => r.listing_id).filter(Boolean);
    const rawTradeIds = (tradeSaves || []).map((r: any) => r.trade_id).filter(Boolean);

    let validListingIds: string[] = [];
    if (rawListingIds.length > 0) {
      const { data: listings } = await supabaseAdmin
        .from('marketplace_listings')
        .select('id, status, quantity')
        .in('id', rawListingIds);

      const listingMap = new Map((listings || []).map((l: any) => [l.id, l]));
      for (const id of rawListingIds) {
        const item = listingMap.get(id);
        if (!item || item.status === 'Sold' || (typeof item.quantity === 'number' && item.quantity <= 0)) {
          // sold or deleted
        } else {
          validListingIds.push(id);
        }
      }
    }

    let validTradeIds: string[] = [];
    if (rawTradeIds.length > 0) {
      const { data: trades } = await supabaseAdmin
        .from('marketplace_trades')
        .select('id, status, deleted_at')
        .in('id', rawTradeIds);

      const tradeMap = new Map((trades || []).map((t: any) => [t.id, t]));
      for (const id of rawTradeIds) {
        const item = tradeMap.get(id);
        if (!item || item.status === 'completed' || item.status === 'cancelled' || item.deleted_at) {
          // completed or deleted
        } else {
          validTradeIds.push(id);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      saved_listing_ids: validListingIds,
      saved_trade_ids: validTradeIds,
    }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.warn('Marketplace saves GET error:', err);
    return new Response(JSON.stringify({ success: true, saved_listing_ids: [], saved_trade_ids: [] }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    const userId = caller?.user.id || null;

    const body = await request.json().catch(() => ({}));
    const { id, type = 'listing', action } = body;

    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing target id.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const isListing = type === 'listing';
    const savesTable = isListing ? 'marketplace_listing_saves' : 'marketplace_trade_saves';
    const idColumn = isListing ? 'listing_id' : 'trade_id';

    let shouldSave: boolean;
    if (action === 'save') {
      shouldSave = true;
    } else if (action === 'unsave') {
      shouldSave = false;
    } else {
      shouldSave = true;
    }

    if (userId) {
      try {
        if (shouldSave) {
          await supabaseAdmin
            .from(savesTable)
            .insert({ [idColumn]: id, user_id: userId });
        } else {
          await supabaseAdmin
            .from(savesTable)
            .delete()
            .eq(idColumn, id)
            .eq('user_id', userId);
        }
      } catch {}
    }

    return new Response(JSON.stringify({
      success: true,
      saved: shouldSave,
    }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.warn('Marketplace save POST error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
