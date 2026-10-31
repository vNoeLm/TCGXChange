import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

// GET: Fetch a single deck (public ones are visible to anyone; private ones only to their owner).
export const GET: APIRoute = async ({ params, request }) => {
  try {
    const { data: row, error } = await supabaseAdmin.from('public_decks').select('*').eq('id', params.id).maybeSingle();
    if (error || !row) {
      return new Response(JSON.stringify({ success: false, error: 'Deck not found.' }), { status: 404, headers: JSON_HEADERS });
    }

    if (!row.is_public) {
      const caller = await getRequestUser(request);
      if (!caller || (caller.user.id !== row.user_id && !caller.isAdmin)) {
        return new Response(JSON.stringify({ success: false, error: 'This deck is private.' }), { status: 403, headers: JSON_HEADERS });
      }
    }

    const [{ data: profile }, { data: legendCard }, { data: championCard }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, display_name, avatar_url').eq('id', row.user_id).maybeSingle(),
      row.legend_card_id ? supabaseAdmin.from('cards').select('*').eq('id', row.legend_card_id).maybeSingle() : Promise.resolve({ data: null }),
      row.champion_card_id ? supabaseAdmin.from('cards').select('*').eq('id', row.champion_card_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    // Deck views aren't counted or shown: popularity of decks is the kind of metagame data Riot's
    // Riftbound policy asks apps not to publish.
    const { views: _views, ...deckRow } = row as any;

    return new Response(JSON.stringify({
      success: true,
      deck: {
        ...deckRow,
        owner_name: profile?.display_name || 'Collector',
        owner_avatar: profile?.avatar_url || null,
        legend_card: legendCard || null,
        champion_card: championCard || null,
      },
    }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    console.error('Deck GET error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), { status: 500, headers: JSON_HEADERS });
  }
};

// PATCH: Update deck contents, rename, or toggle visibility of a deck you published.
export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), { status: 401, headers: JSON_HEADERS });
    }

    const { data: row } = await supabaseAdmin.from('public_decks').select('id, user_id').eq('id', params.id).maybeSingle();
    if (!row) {
      return new Response(JSON.stringify({ success: false, error: 'Deck not found.' }), { status: 404, headers: JSON_HEADERS });
    }
    if (row.user_id !== caller.user.id && !caller.isAdmin) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden: not your deck.' }), { status: 403, headers: JSON_HEADERS });
    }

    const body = await request.json().catch(() => ({}));
    const updates: any = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string') {
      const clean = sanitizePlainText(body.name, 100);
      if (clean) updates.name = clean;
    }
    if (typeof body.is_public === 'boolean') updates.is_public = body.is_public;
    if (body.deck && typeof body.deck === 'object') {
      updates.deck = body.deck;
      updates.legend_card_id = body.deck.legend || null;
      updates.champion_card_id = body.deck.champion || null;
    }
    if (typeof body.game === 'string' && body.game.trim()) {
      updates.game = body.game.toLowerCase().trim();
    }

    const { data, error } = await supabaseAdmin.from('public_decks').update(updates).eq('id', params.id).select().single();
    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify({ success: true, deck: data }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    console.error('Deck PATCH error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), { status: 500, headers: JSON_HEADERS });
  }
};

// DELETE: Remove a published deck.
export const DELETE: APIRoute = async ({ params, request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), { status: 401, headers: JSON_HEADERS });
    }

    const { data: row } = await supabaseAdmin.from('public_decks').select('id, user_id').eq('id', params.id).maybeSingle();
    if (!row) {
      return new Response(JSON.stringify({ success: false, error: 'Deck not found.' }), { status: 404, headers: JSON_HEADERS });
    }
    if (row.user_id !== caller.user.id && !caller.isAdmin) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden: not your deck.' }), { status: 403, headers: JSON_HEADERS });
    }

    await supabaseAdmin.from('public_decks').delete().eq('id', params.id);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    console.error('Deck DELETE error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), { status: 500, headers: JSON_HEADERS });
  }
};
