import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabaseServer';
import { getOrCreateConversation, postSystemMessage, postUserMessage } from '../../../../lib/conversationsServer';
import { getRequestUser, jsonResponse } from '../../../../lib/requestAuth';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: false, error: 'Unauthorized: please sign in to propose a trade.' }, 401);
    }
    const user = caller.user;

    const body = await request.json().catch(() => ({}));
    const { trade_id, message } = body;

    if (!trade_id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing trade_id.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // Fetch trade details including card images
    const { data: trade, error: tradeErr } = await supabaseAdmin
      .from('marketplace_trades')
      .select(`
        id, trader_id, offered_condition, offered_is_foil, handover_methods, cash_difference_huf,
        offered_card:cards!marketplace_trades_offered_card_id_fkey(name, card_number, image_path),
        wanted_card:cards!marketplace_trades_wanted_card_id_fkey(name, card_number, image_path)
      `)
      .eq('id', trade_id)
      .maybeSingle();

    if (tradeErr || !trade) {
      return new Response(JSON.stringify({ success: false, error: 'Trade listing not found.' }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }

    if (trade.trader_id === user.id) {
      return new Response(JSON.stringify({ success: false, error: 'You cannot propose a trade on your own listing.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // Ensure conversation exists between proposer and trader
    const conversationId = await getOrCreateConversation(user.id, trade.trader_id);
    if (!conversationId) {
      return new Response(JSON.stringify({ success: false, error: 'Failed to open message conversation.' }), {
        status: 500,
        headers: JSON_HEADERS,
      });
    }

    // Fetch proposer display name
    const { data: proposerProfile } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();
    const proposerName = proposerProfile?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Trader';

    const offName = (trade.offered_card as any)?.name || 'Offered Card';
    const offImg = (trade.offered_card as any)?.image_path || null;
    const wantName = (trade.wanted_card as any)?.name || 'Wanted Card';
    const wantImg = (trade.wanted_card as any)?.image_path || null;
    const cashDiff = Number((trade as any).cash_difference_huf) || 0;
    const userNote = typeof message === 'string' ? message.trim() : '';

    const nowIso = new Date().toISOString();

    // Place trade on hold in marketplace_trades while negotiation is active
    await supabaseAdmin
      .from('marketplace_trades')
      .update({ status: 'on_hold', updated_at: nowIso })
      .eq('id', trade_id);

    // Create / update hold request in hold_requests so HoldPanel banner in /messages displays Accept / Reject
    const tradeTitle = `${offName} ⇄ ${wantName}`;
    const handover = Array.isArray((trade as any).handover_methods) && (trade as any).handover_methods[0]
      ? (trade as any).handover_methods[0]
      : 'personal';
    const primaryImage = offImg || wantImg || null;

    const { data: existingHold } = await supabaseAdmin
      .from('hold_requests')
      .select('id, status')
      .eq('conversation_id', conversationId)
      .eq('inventory_id', trade_id)
      .in('status', ['pending', 'held', 'handed_over', 'buyer_received'])
      .maybeSingle();

    const holdPayload = {
      inventory_id: trade_id,
      seller_id: trade.trader_id,
      buyer_id: user.id,
      buyer_name: proposerName,
      buyer_email: user.email || '',
      preferred_handover: handover,
      status: 'pending',
      card_name: `[Trade] ${tradeTitle}`,
      card_number: 'TRADE',
      image_path: primaryImage,
      price_huf: cashDiff,
      quantity: 1,
      conversation_id: conversationId,
      message: userNote || undefined,
      items: [{
        inventory_id: trade_id,
        card_name: `[Trade] ${tradeTitle}`,
        image_path: primaryImage,
        offered_name: offName,
        offered_image: offImg,
        wanted_name: wantName,
        wanted_image: wantImg,
        condition: (trade as any).offered_condition || 'Near Mint',
        is_foil: Boolean((trade as any).offered_is_foil),
        quantity: 1,
        price_huf: cashDiff,
        is_trade: true,
      }],
      updated_at: nowIso,
    };

    let holdId: string | null = null;
    if (existingHold) {
      holdId = existingHold.id;
      await supabaseAdmin
        .from('hold_requests')
        .update(holdPayload)
        .eq('id', existingHold.id);
    } else {
      const { data: insertedHold } = await supabaseAdmin
        .from('hold_requests')
        .insert({
          ...holdPayload,
          created_at: nowIso,
        })
        .select('id')
        .maybeSingle();
      holdId = insertedHold?.id || null;
    }

    await postSystemMessage(
      conversationId,
      user.id,
      `Proposed a trade: ${offName} for ${wantName}`,
      {
        holdRequestId: holdId,
        metadata: {
          action: 'trade_proposed',
          kind: 'trade',
          hold_request_id: holdId,
          seller_id: trade.trader_id,
          buyer_id: user.id,
          card_name: `[Trade] ${tradeTitle}`,
          image_path: primaryImage,
          offered_name: offName,
          offered_image: offImg,
          offered_condition: (trade as any).offered_condition || 'Near Mint',
          offered_is_foil: Boolean((trade as any).offered_is_foil),
          wanted_name: wantName,
          wanted_image: wantImg,
          price_huf: cashDiff,
          handover,
        },
      }
    );

    if (userNote) {
      await postUserMessage(conversationId, user.id, userNote);
    }

    return new Response(JSON.stringify({
      success: true,
      conversation_id: conversationId,
    }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Trade propose error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
