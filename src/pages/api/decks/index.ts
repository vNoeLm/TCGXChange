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

const deckContainsCard = (deck: any, legendId: string | null, championId: string | null, cardId: string): boolean => {
  if (!cardId) return false;
  if (legendId === cardId || championId === cardId) return true;
  if (!deck || typeof deck !== 'object') return false;
  if (deck.legend === cardId || deck.champion === cardId) return true;
  if (Array.isArray(deck.extraLegends) && deck.extraLegends.includes(cardId)) return true;
  for (const mapKey of ['mainDeck', 'runeDeck', 'battlefields', 'sideboard']) {
    const m = deck[mapKey];
    if (m && typeof m === 'object' && Number(m[cardId]) > 0) return true;
  }
  return false;
};

// GET: Browse public decks, or list a specific user's decks (their own private +
// public ones when authenticated as that user, otherwise only their public ones).
export const GET: APIRoute = async ({ url, request }) => {
  try {
    const userIdParam = url.searchParams.get('user_id');
    const game = url.searchParams.get('game') || '';
    const search = url.searchParams.get('search')?.trim().toLowerCase() || '';
    const legendFilter = url.searchParams.get('legend')?.trim() || '';
    const championFilter = url.searchParams.get('champion')?.trim() || '';
    const containsParam = url.searchParams.get('contains')?.trim() || '';
    const containsIds = containsParam ? containsParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const domainsParam = url.searchParams.get('domains')?.trim() || '';
    const domainFilters = domainsParam ? domainsParam.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
    const sort = url.searchParams.get('sort') || 'newest';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') || '24', 10)));

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

    const needsInMemoryFilter = Boolean(search || legendFilter || championFilter || containsIds.length > 0 || domainFilters.length > 0 || sort !== 'newest');

    if (!needsInMemoryFilter) {
      query = query.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
      const { data, error, count } = await query;
      if (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: JSON_HEADERS });
      }
      const decks = await attachDeckMeta(data || []);
      return new Response(JSON.stringify({ success: true, data: decks, count: count || 0 }), { status: 200, headers: JSON_HEADERS });
    }

    query = query.order('created_at', { ascending: false }).limit(500);
    const { data, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: JSON_HEADERS });
    }

    let decks = await attachDeckMeta(data || []);

    let searchCardIds: string[] = [];
    if (search) {
      const { data: matchedCards } = await supabaseAdmin
        .from('cards')
        .select('id')
        .ilike('name', `%${search}%`)
        .limit(80);
      searchCardIds = (matchedCards || []).map((c: any) => c.id);
    }

    decks = decks.filter((d) => {
      if (legendFilter) {
        const hasLegend = d.legend_card?.id === legendFilter || d.deck?.legend === legendFilter || (Array.isArray(d.deck?.extraLegends) && d.deck.extraLegends.includes(legendFilter));
        if (!hasLegend) return false;
      }
      if (championFilter) {
        const hasChamp = d.champion_card?.id === championFilter || d.deck?.champion === championFilter;
        if (!hasChamp) return false;
      }
      if (containsIds.length > 0) {
        for (const cid of containsIds) {
          if (!deckContainsCard(d.deck, d.legend_card?.id || null, d.champion_card?.id || null, cid)) return false;
        }
      }
      if (domainFilters.length > 0) {
        const deckDomains = new Set<string>();
        for (const src of [d.legend_card?.domain, d.champion_card?.domain]) {
          if (src) {
            String(src).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((dom) => deckDomains.add(dom));
          }
        }
        if (!domainFilters.every((dom) => deckDomains.has(dom))) return false;
      }
      if (search) {
        const matchesMeta =
          (d.name || '').toLowerCase().includes(search) ||
          (d.owner_name || '').toLowerCase().includes(search) ||
          (d.legend_card?.name || '').toLowerCase().includes(search) ||
          (d.champion_card?.name || '').toLowerCase().includes(search);
        const matchesCard = searchCardIds.some((cid) => deckContainsCard(d.deck, d.legend_card?.id || null, d.champion_card?.id || null, cid));
        if (!matchesMeta && !matchesCard) return false;
      }
      return true;
    });

    if (sort === 'updated') {
      decks.sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
    } else if (sort === 'name') {
      decks.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    const totalCount = decks.length;
    const paged = decks.slice((page - 1) * pageSize, page * pageSize);
    return new Response(JSON.stringify({ success: true, data: paged, count: totalCount }), { status: 200, headers: JSON_HEADERS });
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
