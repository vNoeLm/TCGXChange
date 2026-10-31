import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

async function attachDeckMeta(rows: any[]) {
  const userIds = new Set<string>();
  const cardIds = new Set<string>();
  rows.forEach(r => {
    userIds.add(r.user_id);
    if (r.legend_card_id) cardIds.add(r.legend_card_id);
    if (r.champion_card_id) cardIds.add(r.champion_card_id);
  });

  const [{ data: profileRows }, { data: cardRows }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, display_name, avatar_url, role').in('id', Array.from(userIds)),
    cardIds.size > 0
      ? supabaseAdmin.from('cards').select('id, name, image_path, domain, card_type').in('id', Array.from(cardIds))
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const profileMap = new Map((profileRows || []).map((p: any) => [p.id, p]));
  const cardMap = new Map((cardRows || []).map((c: any) => [c.id, c]));

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    game: r.game,
    is_public: r.is_public,
    created_at: r.created_at,
    updated_at: r.updated_at,
    user_id: r.user_id,
    owner_name: profileMap.get(r.user_id)?.display_name || 'Collector',
    owner_avatar: profileMap.get(r.user_id)?.avatar_url || null,
    legend_card: r.legend_card_id ? cardMap.get(r.legend_card_id) || null : null,
    champion_card: r.champion_card_id ? cardMap.get(r.champion_card_id) || null : null,
    deck: r.deck,
  }));
}

// GET: Browse public decks, or list a specific user's decks (their own private +
// public ones when authenticated as that user, otherwise only their public ones).
export const GET: APIRoute = async ({ url, request }) => {
  try {
    const userIdParam = url.searchParams.get('user_id');
    const game = url.searchParams.get('game') || '';
    const search = url.searchParams.get('search')?.trim().toLowerCase() || '';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '24', 10)));

    let query = supabaseAdmin.from('public_decks').select('*', { count: 'exact' });

    if (userIdParam) {
      const caller = await getRequestUser(request);
      if (caller && (caller.user.id === userIdParam || caller.isAdmin)) {
        query = query.eq('user_id', userIdParam);
      } else {
        query = query.eq('user_id', userIdParam).eq('is_public', true);
      }
    } else {
      query = query.eq('is_public', true);
    }

    if (game && game !== 'all') {
      query = query.eq('game', game);
    }
    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    query = query.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;
    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: JSON_HEADERS });
    }

    const decks = await attachDeckMeta(data || []);
    return new Response(JSON.stringify({ success: true, data: decks, count: count || 0 }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    console.error('Decks GET error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), { status: 500, headers: JSON_HEADERS });
  }
};

// POST: Publish a deck (copies the current deck state into a new public_decks row).
export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), { status: 401, headers: JSON_HEADERS });
    }

    const body = await request.json().catch(() => null);
    const name = sanitizePlainText(body?.name, 100);
    const game = (typeof body?.game === 'string' && body.game.trim()) ? body.game.toLowerCase().trim() : 'riftbound';
    const deck = body?.deck;

    if (!name || !deck || typeof deck !== 'object') {
      return new Response(JSON.stringify({ success: false, error: 'name and deck are required.' }), { status: 400, headers: JSON_HEADERS });
    }

    const isPublic = body?.is_public !== false;

    const { data, error } = await supabaseAdmin
      .from('public_decks')
      .insert({
        user_id: caller.user.id,
        name,
        game,
        deck,
        legend_card_id: deck.legend || null,
        champion_card_id: deck.champion || null,
        is_public: isPublic,
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify({ success: true, deck: data }), { status: 201, headers: JSON_HEADERS });
  } catch (err: any) {
    console.error('Decks POST error:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), { status: 500, headers: JSON_HEADERS });
  }
};
