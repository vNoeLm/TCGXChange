import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

// ─── GET: Search-demand count per card over a recent window ───
// Powers the Seller Hub's "High Demand" signal — how often each of a seller's
// listed cards was searched for platform-wide, regardless of who has one listed.
export const GET: APIRoute = async ({ url }) => {
  try {
    const cardIds = (url.searchParams.get('card_ids') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => Boolean(s) && s.length <= 64)
      .slice(0, 200);
    const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') || '7', 10) || 7));

    if (cardIds.length === 0) {
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: JSON_HEADERS });
    }

    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('search_events')
      .select('card_id')
      .in('card_id', cardIds)
      .gte('created_at', since);

    if (error) throw error;

    const counts: Record<string, number> = {};
    (data || []).forEach((row: any) => {
      if (row.card_id) counts[row.card_id] = (counts[row.card_id] || 0) + 1;
    });

    return new Response(JSON.stringify({ success: true, data: counts }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
