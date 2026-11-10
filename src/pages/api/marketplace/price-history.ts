import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  // A price graph does not need to be live to the second.
  'Cache-Control': 'public, max-age=30, s-maxage=60',
};

const isId = (v: string) => /^[0-9a-f-]{32,40}$/i.test(v);

/**
 * The data behind the price graph for one card:
 *  - `market`: the market reference price each time it was set or changed (in euros).
 *  - `sales`: what copies of this card actually sold for on the site, from completed sales.
 * Current listings are deliberately not part of it.
 *
 * Sales are read on the server because they live in the store's order records, which also hold
 * buyers' contact details; only the card, price, amount and date leave this route.
 */
export const GET: APIRoute = async ({ url }) => {
  const cardId = url.searchParams.get('card_id') || '';
  if (!isId(cardId)) {
    return new Response(JSON.stringify({ success: false, error: 'card_id is required.' }), { status: 400, headers: JSON_HEADERS });
  }

  try {
    const { data: card } = await supabaseAdmin
      .from('cards')
      .select('market_price_eur, market_price_foil_eur, last_price_updated_at')
      .eq('id', cardId)
      .maybeSingle();

    const { data: history, error: historyError } = await supabaseAdmin
      .from('card_price_history')
      .select('recorded_at, price_eur, price_foil_eur')
      .eq('card_id', cardId)
      .order('recorded_at', { ascending: true })
      .limit(500);

    // Every marketplace listing this card has ever had, so a sale can be traced back to it.
    const { data: rows } = await supabaseAdmin.from('marketplace_listings').select('id').eq('card_id', cardId);
    const listingIds = new Set((rows || []).map((r: any) => r.id));

    const sales: { at: string; price_huf: number; quantity: number; is_foil: boolean }[] = [];
    if (listingIds.size > 0) {
      const { data: mktRow } = await supabaseAdmin.from('settings').select('value').eq('key', 'marketplace_orders').maybeSingle();
      let orders: any[] = [];
      try {
        const parsed = mktRow?.value ? JSON.parse(mktRow.value) : [];
        if (Array.isArray(parsed)) orders = parsed;
      } catch {
        // no usable orders
      }
      for (const order of orders) {
        if (order?.status === 'Cancelled' || !Array.isArray(order?.items)) continue;
        for (const item of order.items) {
          const price = Number(item?.price_huf);
          if (!listingIds.has(item?.inventory_id) || !(price > 0)) continue;
          sales.push({
            at: order.created_at,
            price_huf: price,
            quantity: Math.max(1, Number(item.quantity) || 1),
            is_foil: Boolean(item.is_foil),
          });
        }
      }

      // Also check completed hold_requests directly
      try {
        const { data: completedHolds } = await supabaseAdmin
          .from('hold_requests')
          .select('inventory_id, price_huf, quantity, is_foil, updated_at, created_at, status')
          .in('status', ['completed', 'Delivered']);

        for (const h of completedHolds || []) {
          if (!listingIds.has(h.inventory_id)) continue;
          const price = Number(h.price_huf);
          if (!(price > 0)) continue;
          sales.push({
            at: h.updated_at || h.created_at,
            price_huf: price,
            quantity: Math.max(1, Number(h.quantity) || 1),
            is_foil: Boolean(h.is_foil),
          });
        }
      } catch {}

      sales.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    }

    return new Response(
      JSON.stringify({
        success: true,
        current: card
          ? { price_eur: card.market_price_eur, price_foil_eur: card.market_price_foil_eur, updated_at: card.last_price_updated_at }
          : null,
        market: (history || []).map((h: any) => ({ at: h.recorded_at, eur: h.price_eur, foil_eur: h.price_foil_eur })),
        // False when the price history table has not been created yet; the graph then explains it.
        history_available: !historyError,
        sales,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (err: any) {
    console.error('Price history error:', err);
    return new Response(JSON.stringify({ success: false, error: 'Could not load the price history.' }), { status: 500, headers: JSON_HEADERS });
  }
};
