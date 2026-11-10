import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { sanitizePlainText, sanitizePostgrestFilterTerm } from '../../../lib/sanitize';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const searchEventRateMap = new Map<string, number>();

// ─── POST: Log a catalog/marketplace search (fire-and-forget analytics beacon) ───
// Never surfaces an error to the caller — a failed log write should never block
// or visibly break the search the user actually came here to do.
export const POST: APIRoute = async ({ request }) => {
  try {
    const ip =
      request.headers.get('cf-connecting-ip')?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const now = Date.now();
    const lastEvent = searchEventRateMap.get(ip) || 0;
    if (now - lastEvent < 500) {
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: JSON_HEADERS });
    }
    searchEventRateMap.set(ip, now);
    if (searchEventRateMap.size > 3000) {
      for (const [k, v] of searchEventRateMap.entries()) {
        if (now - v > 30_000) searchEventRateMap.delete(k);
      }
    }

    const body = await request.json().catch(() => null);
    const rawQuery = (body?.query || '').toString().trim();
    const query = sanitizePlainText(rawQuery, 100);
    const game = body?.game ? sanitizePlainText(String(body.game), 50) : null;
    const context = body?.context === 'marketplace' ? 'marketplace' : 'catalog';

    if (!query || query.length < 2) {
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: JSON_HEADERS });
    }

    // Best-effort resolve to a specific card, so demand can be aggregated per card_id
    // rather than per raw query string (which fragments across typos/partial terms).
    let cardId: string | null = null;
    try {
      let cardQuery = supabaseAdmin.from('cards').select('id').limit(1);
      if (game) cardQuery = cardQuery.eq('game', game);
      const safeTerm = sanitizePostgrestFilterTerm(query, 80);
      if (safeTerm) {
        const { data } = await cardQuery.or(`name.ilike.%${safeTerm}%,card_number.ilike.%${safeTerm}%`);
        cardId = data?.[0]?.id || null;
      }
    } catch (e) {
      // Non-fatal — the event still gets logged without a card_id.
    }

    await supabaseAdmin.from('search_events').insert({ query, game, context, card_id: cardId });

    return new Response(JSON.stringify({ success: true }), { status: 201, headers: JSON_HEADERS });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false }), { status: 200, headers: JSON_HEADERS });
  }
};
