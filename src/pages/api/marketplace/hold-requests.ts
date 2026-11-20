import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import {
  getOrCreateConversation,
  postSystemMessage,
  postUserMessage,
} from '../../../lib/conversationsServer';
import { P2P_MAX_PENDING_HOLDS_PER_BUYER, P2P_PENDING_HOLD_HOURS } from '../../../lib/p2pConstants';
import {
  expireStalePendingHolds,
  generateHoldOrderNumber,
  isMissingSchemaError,
  isUuid,
  requireP2PUser,
} from '../../../lib/p2pServer';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const auth = await requireP2PUser(request, { requireEmailConfirmed: false });
    if (auth.response) return auth.response;

    await expireStalePendingHolds();

    const conversationId = url.searchParams.get('conversation_id');
    const role = url.searchParams.get('role') || 'all';
    const uid = auth.caller.user.id;

    let query = supabaseAdmin
      .from('hold_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (conversationId && isUuid(conversationId)) {
      query = query.eq('conversation_id', conversationId);
    }

    if (role === 'buyer') {
      query = query.eq('buyer_id', uid);
    } else if (role === 'seller') {
      query = query.eq('seller_id', uid);
    } else {
      query = query.or(`buyer_id.eq.${uid},seller_id.eq.${uid}`);
    }

    const { data: holds, error } = await query;
    if (error) {
      if (isMissingSchemaError(error)) {
        return jsonResponse({ success: true, holds: [] }, 200);
      }
      throw error;
    }

    const rows = holds || [];
    const holdIds = rows.map((r: any) => r.id).filter(Boolean);
    const reviewedSet = new Set<string>();

    if (holdIds.length > 0) {
      try {
        const { data: myReviews } = await supabaseAdmin
          .from('user_reviews')
          .select('hold_request_id')
          .eq('reviewer_id', uid)
          .in('hold_request_id', holdIds);
        for (const rev of myReviews || []) {
          if (rev.hold_request_id) reviewedSet.add(rev.hold_request_id);
        }
      } catch {}
    }

    const enriched = rows.map((h: any) => ({
      ...h,
      my_review_submitted: reviewedSet.has(h.id),
    }));

    return jsonResponse({ success: true, holds: enriched });
  } catch (err: any) {
    console.error('Marketplace hold-requests GET error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to load holds.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    await expireStalePendingHolds();

    const body = await request.json().catch(() => null);
    if (!body) {
      return jsonResponse({ success: false, error: 'Invalid request body.' }, 400);
    }

    const buyerId = auth.caller.user.id;
    const mode = String(body.mode || 'listing');
    const cleanNote = sanitizePlainText(body.note || body.message || '', 500) || null;

    // Limit concurrent pending hold requests per buyer
    const { count: pendingCount } = await supabaseAdmin
      .from('hold_requests')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', buyerId)
      .eq('status', 'pending');

    if ((pendingCount || 0) >= P2P_MAX_PENDING_HOLDS_PER_BUYER) {
      return jsonResponse(
        {
          success: false,
          error: `Maximum ${P2P_MAX_PENDING_HOLDS_PER_BUYER} pending holds allowed at a time. Wait for sellers to respond or cancel an older hold.`,
        },
        429
      );
    }

    let sellerId: string | null = null;
    let resolvedListingId: string | null = null;
    let resolvedPostId: string | null = null;
    let cardName = 'Marketplace Item';
    let cardNumber: string | null = null;
    let imagePath: string | null = null;
    let totalPriceHuf = 0;
    let firstCondition = 'Near Mint';
    let firstIsFoil = false;
    let totalQuantity = 1;
    let builtItems: any[] = [];

    if (mode === 'bulk_lot') {
      const postId = isUuid(body.post_id) ? body.post_id.trim() : null;
      if (!postId) {
        return jsonResponse({ success: false, error: 'Missing bulk lot post_id.' }, 400);
      }

      const { data: post, error: postErr } = await supabaseAdmin
        .from('marketplace_posts')
        .select('*')
        .eq('id', postId)
        .is('deleted_at', null)
        .maybeSingle();

      if (postErr) {
        if (isMissingSchemaError(postErr)) {
          return jsonResponse({ success: false, error: 'Marketplace posts migration required.' }, 503);
        }
        throw postErr;
      }
      if (!post || !post.lot_price_huf || Number(post.lot_price_huf) <= 0) {
        return jsonResponse({ success: false, error: 'Lot price not available for this post.' }, 404);
      }
      if (post.status !== 'open') {
        return jsonResponse({ success: false, error: 'This bulk lot is already held or sold.' }, 409);
      }
      if (post.seller_id === buyerId) {
        return jsonResponse({ success: false, error: 'You cannot hold your own bulk lot.' }, 400);
      }

      const { data: existingBulkHold } = await supabaseAdmin
        .from('hold_requests')
        .select('id')
        .eq('buyer_id', buyerId)
        .eq('post_id', postId)
        .in('status', ['pending', 'accepted'])
        .limit(1);

      if (existingBulkHold && existingBulkHold.length > 0) {
        return jsonResponse({ success: false, error: 'You already have an active hold on this bulk lot.' }, 409);
      }

      sellerId = post.seller_id;
      resolvedPostId = post.id;
      cardName = post.title || 'Bulk Card Lot';
      cardNumber = 'BULK';
      imagePath = Array.isArray(post.images) && post.images[0] ? post.images[0] : null;
      totalPriceHuf = Number(post.lot_price_huf) || 0;
      firstCondition = 'Mixed';
      totalQuantity = 1;
      builtItems = [];
    } else if (mode === 'post_card') {
      const postCardId = isUuid(body.post_card_id) ? body.post_card_id.trim() : null;
      const requestedList = Array.isArray(body.items) && body.items.length > 0
        ? body.items
        : postCardId
        ? [{ post_card_id: postCardId, quantity: Math.max(1, Math.round(Number(body.quantity ?? 1))) }]
        : [];

      const validReq = requestedList.filter((i: any) => isUuid(i?.post_card_id)).slice(0, 30);
      if (validReq.length === 0) {
        return jsonResponse({ success: false, error: 'Missing tagged card selection.' }, 400);
      }

      const tcIds = validReq.map((i: any) => i.post_card_id.trim());
      const { data: tcRows, error: tcErr } = await supabaseAdmin
        .from('marketplace_post_cards')
        .select(`
          id, post_id, card_id, is_highlight_only, condition, is_foil, price_huf, quantity, held_quantity, status,
          cards (id, name, card_number, image_path),
          marketplace_posts!inner (id, seller_id, post_type, status, deleted_at, images)
        `)
        .in('id', tcIds);

      if (tcErr) {
        if (isMissingSchemaError(tcErr)) {
          return jsonResponse({ success: false, error: 'Marketplace posts migration required.' }, 503);
        }
        throw tcErr;
      }

      const tcMap = new Map<string, any>();
      for (const r of tcRows || []) tcMap.set(r.id, r);

      for (const reqItem of validReq) {
        const tc = tcMap.get(reqItem.post_card_id.trim());
        const post = Array.isArray(tc?.marketplace_posts) ? tc.marketplace_posts[0] : tc?.marketplace_posts;
        const card = Array.isArray(tc?.cards) ? tc.cards[0] : tc?.cards;
        if (!tc || !post || post.deleted_at || post.status === 'closed' || post.status === 'sold_out') {
          return jsonResponse({ success: false, error: 'Selected post item is no longer available.' }, 409);
        }
        if (tc.is_highlight_only || tc.price_huf === null || tc.price_huf <= 0) {
          return jsonResponse(
            { success: false, error: 'This tagged card has no listed price — send a message to the seller instead.' },
            400
          );
        }
        if (post.seller_id === buyerId) {
          return jsonResponse({ success: false, error: 'You cannot hold your own card.' }, 400);
        }
        if (sellerId && sellerId !== post.seller_id) {
          return jsonResponse({ success: false, error: 'All cards in one hold request must be from the same seller.' }, 400);
        }
        sellerId = post.seller_id;
        resolvedPostId = post.id;

        const qty = Math.max(1, Math.min(99, Math.round(Number(reqItem.quantity ?? 1))));
        const avail = Math.max(0, (Number(tc.quantity) || 0) - (Number(tc.held_quantity) || 0));
        if (avail < qty) {
          return jsonResponse(
            { success: false, error: `Not enough available copies for ${card?.name || 'selected card'}.` },
            409
          );
        }

        const unitPrice = Number(tc.price_huf);
        totalPriceHuf += unitPrice * qty;
        builtItems.push({
          post_card_id: tc.id,
          post_id: post.id,
          card_id: tc.card_id,
          card_name: card?.name || 'Card',
          card_number: card?.card_number || null,
          image_path: card?.image_path || post.images?.[0] || null,
          condition: tc.condition,
          is_foil: Boolean(tc.is_foil),
          price_huf: unitPrice,
          quantity: qty,
        });
      }

      totalQuantity = builtItems.reduce((s, it) => s + it.quantity, 0);
      cardName =
        builtItems.length === 1
          ? builtItems[0].card_name
          : `${builtItems[0].card_name} (+${builtItems.length - 1} more)`;
      cardNumber = builtItems.length === 1 ? builtItems[0].card_number : `${builtItems.length} CARDS`;
      imagePath = builtItems[0].image_path;
      firstCondition = builtItems[0].condition;
      firstIsFoil = builtItems[0].is_foil;
    } else {
      // Single card listing or multi-listing batch from same seller
      const requestedList = Array.isArray(body.items) && body.items.length > 0
        ? body.items
        : isUuid(body.listing_id)
        ? [{ listing_id: body.listing_id.trim(), quantity: Math.max(1, Math.round(Number(body.quantity ?? 1))) }]
        : [];

      const validReq = requestedList.filter((i: any) => isUuid(i?.listing_id)).slice(0, 30);
      if (validReq.length === 0) {
        return jsonResponse({ success: false, error: 'Missing listing_id.' }, 400);
      }

      const listingIds = validReq.map((i: any) => i.listing_id.trim());
      const { data: rows, error: listErr } = await supabaseAdmin
        .from('marketplace_listings')
        .select('id, seller_id, card_id, condition, is_foil, price_huf, quantity, status, images, cards(id, name, card_number, image_path)')
        .in('id', listingIds)
        .is('deleted_at', null);

      if (listErr) throw listErr;
      const listingMap = new Map<string, any>();
      for (const r of rows || []) listingMap.set(r.id, r);

      for (const reqItem of validReq) {
        const listing = listingMap.get(reqItem.listing_id.trim());
        const card = Array.isArray(listing?.cards) ? listing.cards[0] : listing?.cards;
        if (!listing || listing.status !== 'In Stock' || listing.quantity <= 0) {
          return jsonResponse({ success: false, error: 'One or more listings are no longer in stock.' }, 409);
        }
        if (listing.seller_id === buyerId) {
          return jsonResponse({ success: false, error: 'You cannot hold your own listing.' }, 400);
        }
        if (sellerId && sellerId !== listing.seller_id) {
          return jsonResponse({ success: false, error: 'All items in a hold must belong to the same seller.' }, 400);
        }
        sellerId = listing.seller_id;

        const qty = Math.max(1, Math.min(99, Math.round(Number(reqItem.quantity ?? 1))));
        if (listing.quantity < qty) {
          return jsonResponse(
            { success: false, error: `Only ${listing.quantity} copy(ies) available for ${card?.name || 'card'}.` },
            409
          );
        }

        const unitPrice = Number(listing.price_huf) || 0;
        totalPriceHuf += unitPrice * qty;
        builtItems.push({
          listing_id: listing.id,
          card_id: listing.card_id,
          card_name: card?.name || 'Card',
          card_number: card?.card_number || null,
          image_path: card?.image_path || listing.images?.[0] || null,
          condition: listing.condition,
          is_foil: Boolean(listing.is_foil),
          price_huf: unitPrice,
          quantity: qty,
        });
      }

      if (builtItems.length === 1) {
        const { data: dupCheck } = await supabaseAdmin
          .from('hold_requests')
          .select('id')
          .eq('buyer_id', buyerId)
          .eq('listing_id', builtItems[0].listing_id)
          .eq('status', 'pending')
          .limit(1);
        if (dupCheck && dupCheck.length > 0) {
          return jsonResponse({ success: false, error: 'You already have a pending hold on this listing.' }, 409);
        }
      }

      resolvedListingId = builtItems[0].listing_id;
      totalQuantity = builtItems.reduce((s, it) => s + it.quantity, 0);
      cardName =
        builtItems.length === 1
          ? builtItems[0].card_name
          : `${builtItems[0].card_name} (+${builtItems.length - 1} more)`;
      cardNumber = builtItems.length === 1 ? builtItems[0].card_number : `${builtItems.length} CARDS`;
      imagePath = builtItems[0].image_path;
      firstCondition = builtItems[0].condition;
      firstIsFoil = builtItems[0].is_foil;
    }

    if (!sellerId) {
      return jsonResponse({ success: false, error: 'Seller could not be resolved.' }, 400);
    }

    const conversationId = await getOrCreateConversation(buyerId, sellerId, 'p2p');
    if (!conversationId) {
      return jsonResponse({ success: false, error: 'Could not initialize conversation.' }, 500);
    }
    const { data: buyerProf } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', buyerId)
      .maybeSingle();

    const buyerName = buyerProf?.display_name || auth.caller.user.user_metadata?.display_name || 'Collector';
    const buyerEmail = auth.caller.user.email || 'collector@tcgxchange.net';
    const orderNumber = generateHoldOrderNumber();
    const expiresAt = new Date(Date.now() + P2P_PENDING_HOLD_HOURS * 3600 * 1000).toISOString();

    const insertPayload: Record<string, any> = {
      seller_id: sellerId,
      buyer_id: buyerId,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      preferred_handover: 'chat',
      message: cleanNote,
      status: 'pending',
      listing_id: resolvedListingId,
      post_id: resolvedPostId,
      conversation_id: conversationId,
      order_number: orderNumber,
      card_name: cardName,
      card_number: cardNumber,
      image_path: imagePath,
      price_huf: totalPriceHuf,
      is_foil: firstIsFoil,
      condition: firstCondition,
      quantity: totalQuantity,
      items: builtItems.length > 0 ? builtItems : null,
      expires_at: expiresAt,
    };

    const { data: holdRow, error: insErr } = await supabaseAdmin
      .from('hold_requests')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insErr) {
      if (isMissingSchemaError(insErr)) {
        return jsonResponse({ success: false, error: 'Hold schema migration required.' }, 503);
      }
      throw insErr;
    }

    await postSystemMessage(
      conversationId,
      buyerId,
      `Requested a hold on ${cardName}`,
      {
        holdRequestId: holdRow.id,
        metadata: {
          action: 'requested',
          channel_type: 'p2p',
          hold_request_id: holdRow.id,
          order_number: orderNumber,
          buyer_id: buyerId,
          seller_id: sellerId,
          status: 'pending',
          card_name: cardName,
          card_number: cardNumber,
          image_path: imagePath,
          price_huf: totalPriceHuf,
          quantity: totalQuantity,
          is_foil: firstIsFoil,
          condition: firstCondition,
          post_id: resolvedPostId,
          listing_id: resolvedListingId,
          items: builtItems.length > 0 ? builtItems : null,
        },
      }
    );

    if (cleanNote) {
      await postUserMessage(conversationId, buyerId, cleanNote);
    }

    return jsonResponse(
      {
        success: true,
        hold: holdRow,
        conversation_id: conversationId,
      },
      201
    );
  } catch (err: any) {
    console.error('Marketplace hold POST error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to create hold request.' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    const holdId = isUuid(body?.hold_request_id) ? body.hold_request_id.trim() : null;
    const action = String(body?.action || '');

    if (!holdId) {
      return jsonResponse({ success: false, error: 'Missing hold_request_id.' }, 400);
    }

    const { data: hold, error: selErr } = await supabaseAdmin
      .from('hold_requests')
      .select('*')
      .eq('id', holdId)
      .maybeSingle();

    if (selErr) throw selErr;
    if (!hold) {
      return jsonResponse({ success: false, error: 'Hold request not found.' }, 404);
    }

    const actorId = auth.caller.user.id;
    const isSeller = hold.seller_id === actorId;
    const isBuyer = hold.buyer_id === actorId;
    if (!isSeller && !isBuyer) {
      return jsonResponse({ success: false, error: 'Forbidden.' }, 403);
    }

    const conversationId =
      hold.conversation_id ||
      (hold.buyer_id ? await getOrCreateConversation(hold.buyer_id, hold.seller_id, 'p2p') : null);

    let nextStatus = hold.status;
    let systemBody = '';
    let metaAction = '';

    if (action === 'accept') {
      if (!isSeller) return jsonResponse({ success: false, error: 'Only the seller can accept a hold.' }, 403);
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('rpc_accept_hold_request', {
        p_request_id: hold.id,
        p_actor_id: actorId,
      });
      if (rpcErr) {
        if (isMissingSchemaError(rpcErr)) {
          return jsonResponse({ success: false, error: 'Hold RPC migration required.' }, 503);
        }
        throw rpcErr;
      }
      if (!rpcRes?.ok) {
        return jsonResponse({ success: false, error: rpcRes?.error || 'Could not accept hold.' }, 409);
      }
      nextStatus = 'accepted';
      metaAction = 'hold';
      systemBody = 'Accepted the hold — this card is reserved.';
    } else if (action === 'decline' || action === 'release' || action === 'cancel') {
      const targetNext =
        action === 'decline' ? 'declined' : action === 'release' ? 'released' : 'cancelled';
      if ((action === 'decline' || action === 'release') && !isSeller) {
        return jsonResponse({ success: false, error: 'Only the seller can decline or release a hold.' }, 403);
      }
      if (action === 'cancel' && isBuyer && !isSeller && hold.status === 'handed_over') {
        return jsonResponse(
          { success: false, error: 'Cannot cancel after the seller has marked the items as handed over.' },
          403
        );
      }
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('rpc_release_hold_request', {
        p_request_id: hold.id,
        p_actor_id: actorId,
        p_next_status: targetNext,
      });
      if (rpcErr) {
        if (isMissingSchemaError(rpcErr)) {
          return jsonResponse({ success: false, error: 'Hold RPC migration required.' }, 503);
        }
        throw rpcErr;
      }
      if (!rpcRes?.ok) {
        return jsonResponse({ success: false, error: rpcRes?.error || 'Could not update hold.' }, 409);
      }
      nextStatus = targetNext;
      metaAction = action === 'decline' ? 'reject' : 'release';
      systemBody =
        action === 'decline'
          ? 'Declined the hold request.'
          : 'Hold released — the card is back in stock.';
    } else if (action === 'hand_over') {
      if (!isSeller) {
        return jsonResponse({ success: false, error: 'Only the seller can mark items handed over.' }, 403);
      }
      if (hold.status !== 'accepted') {
        return jsonResponse({ success: false, error: 'Accept the hold first before marking handed over.' }, 400);
      }
      const nowIso = new Date().toISOString();
      const { error: updErr } = await supabaseAdmin
        .from('hold_requests')
        .update({ status: 'handed_over', handed_over_at: nowIso, updated_at: nowIso })
        .eq('id', hold.id);
      if (updErr) throw updErr;
      nextStatus = 'handed_over';
      metaAction = 'mark_handed_over';
      systemBody = 'Marked as handed over / sent. The buyer has 3 days to confirm or deny before it auto-completes.';
    } else if (action === 'confirm_received') {
      if (isSeller) {
        if (hold.status !== 'handed_over') {
          return jsonResponse({ success: false, error: 'Items must be handed over first.' }, 400);
        }
        const refTime = Date.parse(hold.handed_over_at || hold.updated_at || hold.created_at);
        if (!Number.isNaN(refTime) && Date.now() - refTime < 72 * 3600 * 1000) {
          return jsonResponse(
            {
              success: false,
              error: 'The buyer has 72 hours after handover to confirm receipt before seller completion is allowed.',
            },
            403
          );
        }
      }

      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('rpc_complete_hold_request', {
        p_request_id: hold.id,
        p_actor_id: actorId,
      });
      if (rpcErr) {
        if (isMissingSchemaError(rpcErr)) {
          return jsonResponse({ success: false, error: 'Hold RPC migration required.' }, 503);
        }
        throw rpcErr;
      }
      if (!rpcRes?.ok) {
        return jsonResponse({ success: false, error: rpcRes?.error || 'Could not complete transaction.' }, 409);
      }
      nextStatus = 'completed';
      metaAction = 'confirm_received';
      systemBody = 'Received the card — sale completed!';
    } else {
      return jsonResponse({ success: false, error: 'Unsupported hold action.' }, 400);
    }

    if (conversationId) {
      await postSystemMessage(conversationId, actorId, systemBody, {
        holdRequestId: hold.id,
        metadata: {
          action: metaAction,
          channel_type: 'p2p',
          hold_request_id: hold.id,
          order_number: hold.order_number,
          buyer_id: hold.buyer_id,
          seller_id: hold.seller_id,
          status: nextStatus,
        },
      });
    }

    return jsonResponse({ success: true, status: nextStatus, hold_request_id: hold.id });
  } catch (err: any) {
    console.error('Marketplace hold PATCH error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to update hold.' }, 500);
  }
};
