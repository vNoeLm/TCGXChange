import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=30, s-maxage=60',
};

const isId = (v: string) => /^[0-9a-f-]{32,40}$/i.test(v);

/**
 * The data behind the price graph for one card:
 *  - `market`: the market reference price each time it was set or changed (in euros).
 *  - `sales`: what copies of this card actually sold for in the official store.
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

    // Find store products linked to this card_id so completed store sales show up on the graph
    const { data: storeSingleRows } = await supabaseAdmin
      .from('store_products')
      .select('id, attributes')
      .eq('category', 'singles')
      .contains('attributes', { card_id: cardId });

    const productIds = new Set((storeSingleRows || []).map((r: any) => r.id));
    const foilByProductId = new Map<string, boolean>();
    (storeSingleRows || []).forEach((r: any) => {
      foilByProductId.set(r.id, Boolean(r.attributes?.is_foil));
    });

    const sales: { at: string; price_huf: number; quantity: number; is_foil: boolean }[] = [];
    if (productIds.size > 0) {
      const { data: storeRow } = await supabaseAdmin.from('settings').select('value').eq('key', 'store_orders').maybeSingle();
      let orders: any[] = [];
      try {
        const parsed = storeRow?.value ? JSON.parse(storeRow.value) : [];
        if (Array.isArray(parsed)) orders = parsed;
      } catch {
        // ignore parse failure
      }

      for (const order of orders) {
        if (order?.status === 'Cancelled' || !Array.isArray(order?.items)) continue;
        for (const item of order.items) {
          const prodId = item?.product_id || item?.id;
          const matchesCard = (prodId && productIds.has(prodId)) || item?.card_id === cardId;
          const price = Number(item?.price_huf ?? item?.unit_price_huf);
          if (!matchesCard || !(price > 0)) continue;
          sales.push({
            at: order.created_at,
            price_huf: price,
            quantity: Math.max(1, Number(item.quantity) || 1),
            is_foil: item?.is_foil !== undefined ? Boolean(item.is_foil) : (prodId ? Boolean(foilByProductId.get(prodId)) : false),
          });
        }
      }

      sales.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    }

    return new Response(
      JSON.stringify({
        success: true,
        current: card
          ? { price_eur: card.market_price_eur, price_foil_eur: card.market_price_foil_eur, updated_at: card.last_price_updated_at }
          : null,
        market: (history || []).map((h: any) => ({ at: h.recorded_at, eur: h.price_eur, foil_eur: h.price_foil_eur })),
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
