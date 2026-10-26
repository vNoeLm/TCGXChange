import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import {
  loadAllAuctions,
  saveAuction,
  deleteAuctionById,
  finalizeExpiredAuctions,
  applyAuctionSellerCancelPenalty,
  enrichSellerProfiles,
} from '../../../lib/bulkAndAuctionsServer';
import { OWNER_ID } from '../../../lib/constants';
import type { MarketplaceAuction, MarketplaceAuctionBid } from '../../../types';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export const GET: APIRoute = async ({ url }) => {
  try {
    await finalizeExpiredAuctions();

    const game = url.searchParams.get('game');
    const sellerId = url.searchParams.get('seller_id');
    const sellerQuery = url.searchParams.get('seller')?.trim().toLowerCase() || '';
    const statusParam = url.searchParams.get('status');
    const search = url.searchParams.get('search')?.trim().toLowerCase() || '';
    const sort = url.searchParams.get('sort') || 'ending_soon';

    let rows = await loadAllAuctions();

    if (sellerId) {
      rows = rows.filter((r) => r.seller_id === sellerId);
    } else if (statusParam && statusParam !== 'all') {
      rows = rows.filter((r) => r.status === statusParam);
    }

    if (game && game !== 'all') {
      rows = rows.filter((r) => r.game === game || r.card?.game === game);
    }

    if (search) {
      rows = rows.filter((r) => {
        const title = (r.title || '').toLowerCase();
        const cardName = (r.card?.name || '').toLowerCase();
        const cardNum = (r.card?.card_number || '').toLowerCase();
        const desc = (r.description || '').toLowerCase();
        return title.includes(search) || cardName.includes(search) || cardNum.includes(search) || desc.includes(search);
      });
    }

    let enriched = await enrichSellerProfiles(rows);

    if (sellerQuery) {
      enriched = enriched.filter((r) =>
        (r.seller_name || '').toLowerCase().includes(sellerQuery)
      );
    }

    if (sort === 'ending_soon') {
      enriched.sort((a, b) => new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime());
    } else if (sort === 'likes') {
      enriched.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
    } else if (sort === 'price_asc') {
      enriched.sort((a, b) => ((a.current_bid_huf || a.base_price_huf) - (b.current_bid_huf || b.base_price_huf)));
    } else if (sort === 'price_desc') {
      enriched.sort((a, b) => ((b.current_bid_huf || b.base_price_huf) - (a.current_bid_huf || a.base_price_huf)));
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: enriched,
        count: enriched.length,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (err: any) {
    console.error('Auctions GET error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};

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
      return new Response(JSON.stringify({ success: false, error: 'Invalid session.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const body = await request.json().catch(() => ({}));
    const action = body.action || 'create';

    // ─── Action: Place Bid ──────────────────────────────────────────────────
    if (action === 'bid') {
      await finalizeExpiredAuctions();

      const { auction_id, amount_huf } = body;
      if (!auction_id || !amount_huf) {
        return new Response(JSON.stringify({ success: false, error: 'Missing auction_id or bid amount.' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      const allAuctions = await loadAllAuctions();
      const auction = allAuctions.find((a) => a.id === auction_id);
      if (!auction) {
        return new Response(JSON.stringify({ success: false, error: 'Auction not found.' }), {
          status: 404,
          headers: JSON_HEADERS,
        });
      }

      if (auction.seller_id === user.id) {
        return new Response(JSON.stringify({ success: false, error: 'You cannot bid on your own auction.' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      if (auction.highest_bidder_id === user.id) {
        return new Response(JSON.stringify({ success: false, error: 'You are already the highest bidder.' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      const now = Date.now();
      const endsAtMs = new Date(auction.ends_at).getTime();
      if (auction.status !== 'active' || now >= endsAtMs) {
        return new Response(JSON.stringify({ success: false, error: 'This auction has already ended.' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      const bidAmount = Math.round(Number(amount_huf));
      const minRequiredBid = auction.bid_count === 0 || !auction.current_bid_huf
        ? auction.base_price_huf
        : auction.current_bid_huf + auction.bid_step_huf;

      if (isNaN(bidAmount) || bidAmount < minRequiredBid) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Minimum required bid is ${minRequiredBid.toLocaleString('hu-HU')} Ft (step: +${auction.bid_step_huf.toLocaleString('hu-HU')} Ft).`,
          }),
          { status: 400, headers: JSON_HEADERS }
        );
      }

      const { data: bidderProf } = await supabaseAdmin
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      const bidderName = bidderProf?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Bidder';

      const nowIso = new Date().toISOString();
      const newBid: MarketplaceAuctionBid = {
        id: crypto.randomUUID(),
        auction_id: auction.id,
        bidder_id: user.id,
        bidder_name: bidderName,
        bidder_avatar: bidderProf?.avatar_url || null,
        amount_huf: bidAmount,
        created_at: nowIso,
      };

      // Minute Rule / Anti-sniping: only extend if the remaining time until auction end is under the extension increment
      const extensionMins = Math.max(0, Number(auction.extension_minutes) || 0);
      const extensionMs = extensionMins * 60 * 1000;
      const remainingMs = endsAtMs - now;
      let extendedEndsAt = auction.ends_at;
      let timeExtended = false;

      if (extensionMins > 0 && remainingMs < extensionMs) {
        extendedEndsAt = new Date(endsAtMs + extensionMs).toISOString();
        timeExtended = true;
      }

      auction.current_bid_huf = bidAmount;
      auction.bid_count = (auction.bid_count || 0) + 1;
      auction.highest_bidder_id = user.id;
      auction.highest_bidder_name = bidderName;
      auction.ends_at = extendedEndsAt;
      auction.updated_at = nowIso;
      auction.bids = [newBid, ...(Array.isArray(auction.bids) ? auction.bids : [])];

      const saved = await saveAuction(auction);
      const [enriched] = await enrichSellerProfiles([saved]);

      return new Response(
        JSON.stringify({
          success: true,
          data: enriched || saved,
          extended_by_minutes: timeExtended ? extensionMins : 0,
          time_extended: timeExtended,
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }

    // ─── Action: Seller Cancels Auction (with 1-Star System Review if won/bid) ───
    if (action === 'cancel') {
      const { auction_id } = body;
      if (!auction_id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing auction_id.' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      const result = await applyAuctionSellerCancelPenalty(auction_id, user.id);
      if (!result.success) {
        return new Response(JSON.stringify({ success: false, error: result.error || 'Could not cancel auction.' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          penalty_applied: result.penaltyApplied,
          message: result.penaltyApplied
            ? 'Auction cancelled. A 1-star system review has been recorded on your profile for cancelling an auction with a winning bidder.'
            : 'Auction cancelled.',
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }

    // ─── Action: Finalize Expired Auctions ──────────────────────────────────
    if (action === 'finalize') {
      await finalizeExpiredAuctions();
      const allAuctions = await loadAllAuctions();
      const enriched = await enrichSellerProfiles(allAuctions);
      return new Response(JSON.stringify({ success: true, data: enriched }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    // ─── Default Action: Create New Auction ─────────────────────────────────
    const {
      card_id = null,
      title,
      game = 'riftbound',
      condition = 'Near Mint',
      is_foil = false,
      quantity = 1,
      exact_card_count,
      approx_card_count,
      is_bulk,
      images = [],
      base_price_huf,
      bid_step_huf = 50,
      extension_minutes = 5,
      duration_minutes = 1440, // default 24 hours
      ends_at: customEndsAt,
      handover_methods = ['personal', 'foxpost', 'packeta', 'other'],
      description = '',
    } = body;

    const basePrice = Math.round(Number(base_price_huf));
    const bidStep = Math.round(Number(bid_step_huf));
    const extMins = Math.max(0, Math.round(Number(extension_minutes ?? 5)));

    if (!basePrice || basePrice <= 0) {
      return new Response(JSON.stringify({ success: false, error: 'Base price must be greater than 0.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    if (!bidStep || bidStep <= 0) {
      return new Response(JSON.stringify({ success: false, error: 'Bid step must be greater than 0.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    let resolvedTitle = (title || '').trim();
    let resolvedGame = game;
    let cardObj = null;

    if (card_id) {
      const { data: cardRow } = await supabaseAdmin
        .from('cards')
        .select('*, sets(id, name, code)')
        .eq('id', card_id)
        .maybeSingle();
      if (cardRow) {
        cardObj = cardRow;
        if (!resolvedTitle) resolvedTitle = cardRow.name;
        if (cardRow.game) resolvedGame = cardRow.game;
      }
    }

    if (!resolvedTitle) {
      return new Response(JSON.stringify({ success: false, error: 'Please select a card or enter an auction title.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    let endsAtIso: string;

    if (customEndsAt && !isNaN(new Date(customEndsAt).getTime()) && new Date(customEndsAt).getTime() > now) {
      endsAtIso = new Date(customEndsAt).toISOString();
    } else {
      const durMins = Math.max(5, Number(duration_minutes) || 1440);
      endsAtIso = new Date(now + durMins * 60 * 1000).toISOString();
    }

    const newAuction: MarketplaceAuction = {
      id: crypto.randomUUID(),
      seller_id: user.id,
      seller_name: '',
      card_id: card_id || null,
      card: cardObj,
      title: resolvedTitle,
      game: resolvedGame,
      condition,
      is_foil: Boolean(is_foil),
      quantity: Math.max(1, Number(quantity) || 1),
      exact_card_count: exact_card_count ? Number(exact_card_count) : null,
      approx_card_count: approx_card_count ? Number(approx_card_count) : null,
      is_bulk: Boolean(is_bulk || exact_card_count || approx_card_count),
      images: Array.isArray(images) ? images.filter(Boolean) : [],
      base_price_huf: basePrice,
      bid_step_huf: bidStep,
      current_bid_huf: null,
      bid_count: 0,
      highest_bidder_id: null,
      highest_bidder_name: null,
      extension_minutes: extMins,
      starts_at: nowIso,
      ends_at: endsAtIso,
      handover_methods: Array.isArray(handover_methods) && handover_methods.length > 0
        ? handover_methods
        : ['personal', 'foxpost', 'packeta', 'other'],
      description: description?.trim() || null,
      status: 'active',
      conversation_id: null,
      hold_request_id: null,
      likes_count: 0,
      views: 0,
      bids: [],
      created_at: nowIso,
      updated_at: nowIso,
    };

    const saved = await saveAuction(newAuction);
    const [enriched] = await enrichSellerProfiles([saved]);

    return new Response(
      JSON.stringify({ success: true, data: enriched || saved }),
      { status: 201, headers: JSON_HEADERS }
    );
  } catch (err: any) {
    console.error('Auctions POST error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};

export const DELETE: APIRoute = async ({ url, request }) => {
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

    const id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing auction id.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const allAuctions = await loadAllAuctions();
    const target = allAuctions.find((a) => a.id === id);
    if (!target || (target.seller_id !== user.id && user.id !== OWNER_ID)) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden.' }), {
        status: 403,
        headers: JSON_HEADERS,
      });
    }

    // If the auction already has a bidder and is active or ended, deleting it triggers the cancellation penalty
    if (target.highest_bidder_id && (target.status === 'active' || target.status === 'ended')) {
      const res = await applyAuctionSellerCancelPenalty(id, user.id);
      return new Response(JSON.stringify({ success: true, id, penalty_applied: res.penaltyApplied }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    await deleteAuctionById(id);

    return new Response(JSON.stringify({ success: true, id }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Auctions DELETE error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
