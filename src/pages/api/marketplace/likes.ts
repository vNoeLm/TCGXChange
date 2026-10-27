import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import {
  loadAllBulkListings,
  saveBulkListing,
  loadAllAuctions,
  saveAuction,
} from '../../../lib/bulkAndAuctionsServer';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

// In-memory fallback cache when database column/table migration is pending
const memoryLikes = new Map<string, number>();

export const GET: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    const userId = caller?.user.id || null;

    if (!userId) {
      return new Response(JSON.stringify({
        success: true,
        liked_listing_ids: [],
        liked_trade_ids: [],
      }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    const [listingLikesRes, tradeLikesRes] = await Promise.all([
      supabaseAdmin
        .from('marketplace_listing_likes')
        .select('listing_id')
        .eq('user_id', userId),
      supabaseAdmin
        .from('marketplace_trade_likes')
        .select('trade_id')
        .eq('user_id', userId),
    ]);

    const rawListingIds = (listingLikesRes.data || []).map((r: any) => r.listing_id).filter(Boolean);
    const rawTradeIds = (tradeLikesRes.data || []).map((r: any) => r.trade_id).filter(Boolean);

    let validListingIds: string[] = [];
    const deadListingIds: string[] = [];

    if (rawListingIds.length > 0) {
      const [listingsRes, allBulk, allAuctions] = await Promise.all([
        supabaseAdmin
          .from('marketplace_listings')
          .select('id, status, quantity')
          .in('id', rawListingIds),
        loadAllBulkListings(),
        loadAllAuctions(),
      ]);

      const listingMap = new Map((listingsRes.data || []).map((l: any) => [l.id, l]));
      const bulkMap = new Map((allBulk || []).map((b) => [b.id, b]));
      const auctionMap = new Map((allAuctions || []).map((a) => [a.id, a]));

      for (const id of rawListingIds) {
        const item = listingMap.get(id);
        const bulk = bulkMap.get(id);
        const auction = auctionMap.get(id);

        if (item) {
          // A listing is ONLY dead when completed/sold.
          // When status is 'Reserved' or 'On Hold', quantity may be 0, but it MUST be kept!
          if (item.status === 'Sold') {
            deadListingIds.push(id);
          } else {
            validListingIds.push(id);
          }
        } else if (bulk) {
          // Bulk lot is only dead when completed/sold
          if (bulk.status === 'sold') {
            deadListingIds.push(id);
          } else {
            validListingIds.push(id);
          }
        } else if (auction) {
          // Auction is only dead when completed or cancelled
          if (auction.status === 'completed' || auction.status === 'cancelled') {
            deadListingIds.push(id);
          } else {
            validListingIds.push(id);
          }
        } else {
          // Fallback check legacy inventory table before treating as dead
          const { data: legacyRow } = await supabaseAdmin
            .from('inventory')
            .select('id, status, quantity')
            .eq('id', id)
            .maybeSingle();

          if (!legacyRow || legacyRow.status === 'Sold') {
            deadListingIds.push(id);
          } else {
            validListingIds.push(id);
          }
        }
      }

      if (deadListingIds.length > 0) {
        await Promise.all([
          supabaseAdmin
            .from('marketplace_listing_likes')
            .delete()
            .eq('user_id', userId)
            .in('listing_id', deadListingIds),
          supabaseAdmin
            .from('marketplace_saves')
            .delete()
            .eq('user_id', userId)
            .in('item_id', deadListingIds),
        ]).catch(() => {});
      }
    }

    let validTradeIds: string[] = [];
    const deadTradeIds: string[] = [];

    if (rawTradeIds.length > 0) {
      const { data: trades } = await supabaseAdmin
        .from('marketplace_trades')
        .select('id, status, deleted_at')
        .in('id', rawTradeIds);

      const tradeMap = new Map((trades || []).map((t: any) => [t.id, t]));

      for (const id of rawTradeIds) {
        const item = tradeMap.get(id);
        // Only dead if trade was deleted, completed or cancelled.
        // If on_hold or open, KEEP IT!
        if (!item || item.status === 'completed' || item.status === 'cancelled' || item.deleted_at) {
          deadTradeIds.push(id);
        } else {
          validTradeIds.push(id);
        }
      }

      if (deadTradeIds.length > 0) {
        await Promise.all([
          supabaseAdmin
            .from('marketplace_trade_likes')
            .delete()
            .eq('user_id', userId)
            .in('trade_id', deadTradeIds),
          supabaseAdmin
            .from('marketplace_saves')
            .delete()
            .eq('user_id', userId)
            .in('item_id', deadTradeIds),
        ]).catch(() => {});
      }
    }

    return new Response(JSON.stringify({
      success: true,
      liked_listing_ids: validListingIds,
      liked_trade_ids: validTradeIds,
    }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.warn('Marketplace likes GET error:', err);
    return new Response(JSON.stringify({
      success: true,
      liked_listing_ids: [],
      liked_trade_ids: [],
    }), {
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
    const mainTable = isListing ? 'marketplace_listings' : 'marketplace_trades';
    const likesTable = isListing ? 'marketplace_listing_likes' : 'marketplace_trade_likes';
    const idColumn = isListing ? 'listing_id' : 'trade_id';

    // 1. Fetch current item with graceful schema fallback
    let currentLikes = memoryLikes.get(id) || 0;
    let itemFound = false;

    const { data: currentItem, error: fetchErr } = await supabaseAdmin
      .from(mainTable)
      .select('id, likes_count')
      .eq('id', id)
      .maybeSingle();

    if (currentItem) {
      itemFound = true;
      if (typeof currentItem.likes_count === 'number') {
        currentLikes = currentItem.likes_count;
      }
    } else if (fetchErr && fetchErr.message?.includes('likes_count')) {
      const { data: fallbackItem } = await supabaseAdmin
        .from(mainTable)
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (fallbackItem) itemFound = true;
    }

    let shouldLike: boolean;
    if (action === 'like') {
      shouldLike = true;
    } else if (action === 'unlike') {
      shouldLike = false;
    } else if (userId) {
      const { data: existing } = await supabaseAdmin
        .from(likesTable)
        .select('id')
        .eq(idColumn, id)
        .eq('user_id', userId)
        .maybeSingle();
      shouldLike = !existing;
    } else {
      shouldLike = true;
    }

    // 2. Perform DB insert/delete if user is authenticated
    if (userId) {
      if (shouldLike) {
        try {
          await supabaseAdmin
            .from(likesTable)
            .upsert(
              { [idColumn]: id, user_id: userId },
              { onConflict: `${idColumn},user_id`, ignoreDuplicates: false }
            );
        } catch (e) {
          console.warn(`Failed to upsert into ${likesTable}:`, e);
        }
      } else {
        try {
          await supabaseAdmin
            .from(likesTable)
            .delete()
            .eq(idColumn, id)
            .eq('user_id', userId);
        } catch (e) {
          console.warn(`Failed to delete from ${likesTable}:`, e);
        }
      }
    }

    // 3. Compute authoritative new likes count
    let newLikesCount = Math.max(0, currentLikes + (shouldLike ? 1 : -1));

    if (itemFound) {
      if (userId) {
        // Query exact row count directly from likesTable for 100% database accuracy
        try {
          const { count: exactCount } = await supabaseAdmin
            .from(likesTable)
            .select('*', { count: 'exact', head: true })
            .eq(idColumn, id);

          if (typeof exactCount === 'number') {
            newLikesCount = exactCount;
            await supabaseAdmin
              .from(mainTable)
              .update({ likes_count: exactCount })
              .eq('id', id);
          } else {
            // Fallback if likesTable count query fails
            const { data: refreshed } = await supabaseAdmin
              .from(mainTable)
              .select('likes_count')
              .eq('id', id)
              .maybeSingle();
            if (refreshed && typeof refreshed.likes_count === 'number') {
              newLikesCount = refreshed.likes_count;
            }
          }
        } catch (e) {
          console.warn(`Failed to update exact count on ${mainTable}:`, e);
        }
      } else {
        // Guest like: increment/decrement mainTable directly
        try {
          await supabaseAdmin
            .from(mainTable)
            .update({ likes_count: newLikesCount })
            .eq('id', id);
        } catch (e) {
          console.warn(`Failed to update guest likes on ${mainTable}:`, e);
        }
      }
    } else if (isListing) {
      // Check bulk listings or auctions
      const allBulk = await loadAllBulkListings();
      const bulkTarget = allBulk.find((b) => b.id === id);
      if (bulkTarget) {
        if (userId) {
          try {
            const { count: exactCount } = await supabaseAdmin
              .from('marketplace_listing_likes')
              .select('*', { count: 'exact', head: true })
              .eq('listing_id', id);
            if (typeof exactCount === 'number') newLikesCount = exactCount;
          } catch {}
        }
        bulkTarget.likes_count = newLikesCount;
        await saveBulkListing(bulkTarget);
      } else {
        const allAuctions = await loadAllAuctions();
        const auctionTarget = allAuctions.find((a) => a.id === id);
        if (auctionTarget) {
          if (userId) {
            try {
              const { count: exactCount } = await supabaseAdmin
                .from('marketplace_listing_likes')
                .select('*', { count: 'exact', head: true })
                .eq('listing_id', id);
              if (typeof exactCount === 'number') newLikesCount = exactCount;
            } catch {}
          }
          auctionTarget.likes_count = newLikesCount;
          await saveAuction(auctionTarget);
        }
      }
    }

    memoryLikes.set(id, newLikesCount);

    return new Response(JSON.stringify({
      success: true,
      liked: shouldLike,
      likes_count: newLikesCount,
    }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.warn('Marketplace like endpoint error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
