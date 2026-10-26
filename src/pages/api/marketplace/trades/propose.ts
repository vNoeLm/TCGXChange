import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabaseServer';
import { getOrCreateConversation, postUserMessage } from '../../../../lib/conversationsServer';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: please sign in to propose a trade.' }), {
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
    const { trade_id, message } = body;

    if (!trade_id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing trade_id.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // Fetch trade details
    const { data: trade, error: tradeErr } = await supabaseAdmin
      .from('marketplace_trades')
      .select(`
        id, trader_id, offered_condition, offered_is_foil, handover_methods, cash_difference_huf,
        offered_card:cards!marketplace_trades_offered_card_id_fkey(name, card_number),
        wanted_card:cards!marketplace_trades_wanted_card_id_fkey(name, card_number)
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

    // Prepare proposal message (concise card-to-card summary, no robotic boilerplate)
    const offName = (trade.offered_card as any)?.name || 'Offered Card';
    const wantName = (trade.wanted_card as any)?.name || 'Wanted Card';
    const userNote = message?.trim() ? `\n\n"${message.trim()}"` : '';

    const proposalText = `[Trade Proposal] ${offName} to ${wantName}${userNote}`;

    await postUserMessage(conversationId, user.id, proposalText);

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
      price_huf: (trade as any).cash_difference_huf || 0,
      quantity: 1,
      conversation_id: conversationId,
      message: proposalText,
      items: [{
        inventory_id: trade_id,
        card_name: `[Trade] ${tradeTitle}`,
        quantity: 1,
        price_huf: (trade as any).cash_difference_huf || 0,
        is_trade: true,
      }],
      updated_at: nowIso,
    };

    if (existingHold) {
      await supabaseAdmin
        .from('hold_requests')
        .update(holdPayload)
        .eq('id', existingHold.id);
    } else {
      await supabaseAdmin
        .from('hold_requests')
        .insert({
          ...holdPayload,
          created_at: nowIso,
        });
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
