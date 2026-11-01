import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabaseServer';
import { getOrCreateConversation, postSystemMessage, postUserMessage } from '../../../../lib/conversationsServer';
import { getRequestUser, jsonResponse } from '../../../../lib/requestAuth';
import { summarizeTradeSide } from '../../../../lib/tradeItems';
import { hydrateTradeRowsWithItems, isMissingColumnError } from '../../../../lib/tradeItemsServer';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const BASE_SELECT = `
  id, trader_id, offered_card_id, offered_condition, offered_is_foil, offered_quantity,
  wanted_card_id, wanted_min_condition, wanted_is_foil, wanted_quantity,
  handover_methods, cash_difference_huf,
  offered_card:cards!marketplace_trades_offered_card_id_fkey(id, name, card_number, image_path),
  wanted_card:cards!marketplace_trades_wanted_card_id_fkey(id, name, card_number, image_path)
`;

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

    const initialRes = await supabaseAdmin
      .from('marketplace_trades')
      .select(`offered_items, wanted_items, ${BASE_SELECT}`)
      .eq('id', trade_id)
      .maybeSingle();
    let rawTrade: any = initialRes.data;
    let tradeErr = initialRes.error;

    if (tradeErr && isMissingColumnError(tradeErr)) {
      const retry = await supabaseAdmin
        .from('marketplace_trades')
        .select(BASE_SELECT)
        .eq('id', trade_id)
        .maybeSingle();
      rawTrade = retry.data;
      tradeErr = retry.error;
    }

    if (tradeErr || !rawTrade) {
      return new Response(JSON.stringify({ success: false, error: 'Trade listing not found.' }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }

    const [trade] = await hydrateTradeRowsWithItems([rawTrade]);

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
    const proposerName =
      proposerProfile?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Trader';

    const offeredItems = Array.isArray(trade.offered_items) ? trade.offered_items : [];
    const wantedItems = Array.isArray(trade.wanted_items) ? trade.wanted_items : [];

    const offName = summarizeTradeSide(offeredItems, 'en');
    const offImg = offeredItems[0]?.card?.image_path || (trade.offered_card as any)?.image_path || null;
    const wantName = summarizeTradeSide(wantedItems, 'en');
    const wantImg = wantedItems[0]?.card?.image_path || (trade.wanted_card as any)?.image_path || null;
    const cashDiff = Number((trade as any).cash_difference_huf) || 0;
    const userNote = typeof message === 'string' ? message.trim() : '';

    const nowIso = new Date().toISOString();

    // Place trade on hold in marketplace_trades while negotiation is active
    await supabaseAdmin
      .from('marketplace_trades')
      .update({ status: 'on_hold', updated_at: nowIso })
      .eq('id', trade_id);

    const tradeTitle = `${offName} ⇄ ${wantName}`;
    const handover =
      Array.isArray((trade as any).handover_methods) && (trade as any).handover_methods[0]
        ? (trade as any).handover_methods[0]
        : 'personal';
    const primaryImage = offImg || wantImg || null;

    const serializedOffered = offeredItems.map((it: any) => ({
      card_id: it.card_id,
      name: it.card?.name || 'Card',
      card_number: it.card?.card_number || '',
      image_path: it.card?.image_path || null,
      condition: it.condition || 'Near Mint',
      is_foil: Boolean(it.is_foil),
      quantity: it.quantity || 1,
    }));
    const serializedWanted = wantedItems.map((it: any) => ({
      card_id: it.card_id,
      name: it.card?.name || 'Card',
      card_number: it.card?.card_number || '',
      image_path: it.card?.image_path || null,
      condition: it.condition || 'Near Mint',
      is_foil: it.is_foil,
      quantity: it.quantity || 1,
    }));

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
      items: [
        {
          inventory_id: trade_id,
          card_name: `[Trade] ${tradeTitle}`,
          image_path: primaryImage,
          offered_name: offName,
          offered_image: offImg,
          offered_items: serializedOffered,
          wanted_name: wantName,
          wanted_image: wantImg,
          wanted_items: serializedWanted,
          condition: (trade as any).offered_condition || 'Near Mint',
          is_foil: Boolean((trade as any).offered_is_foil),
          quantity: 1,
          price_huf: cashDiff,
          is_trade: true,
        },
      ],
      updated_at: nowIso,
    };

    let holdId: string | null = null;
    if (existingHold) {
      holdId = existingHold.id;
      await supabaseAdmin.from('hold_requests').update(holdPayload).eq('id', existingHold.id);
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
          offered_items: serializedOffered,
          wanted_name: wantName,
          wanted_image: wantImg,
          wanted_items: serializedWanted,
          price_huf: cashDiff,
          handover,
        },
      }
    );

    if (userNote) {
      await postUserMessage(conversationId, user.id, userNote);
    }

    return new Response(
      JSON.stringify({
        success: true,
        conversation_id: conversationId,
      }),
      {
        status: 200,
        headers: JSON_HEADERS,
      }
    );
  } catch (err: any) {
    console.error('Trade propose error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
