import type { APIRoute } from 'astro';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { isMissingSchemaError, isUuid } from '../../../lib/p2pServer';
import { supabaseAdmin } from '../../../lib/supabaseServer';

export const prerender = false;

const VISIBILITY_SETTINGS_KEY = 'wishlist_visibility_map';

function safeParseMap(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function readWishlistVisibilityMap(): Promise<Record<string, boolean>> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', VISIBILITY_SETTINGS_KEY)
    .maybeSingle();
  return safeParseMap(data?.value);
}

/**
 * GET /api/profile/wishlists?user_id=<uuid>
 * Returns a user's public wishlists (or all wishlists when the caller is the owner),
 * plus hydrated card metadata for every card referenced in those wishlists.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const userId = String(url.searchParams.get('user_id') || '').trim();
  if (!isUuid(userId)) {
    return jsonResponse({ success: false, error: 'Invalid user_id.' }, 400);
  }

  const caller = await getRequestUser(request).catch(() => null);
  const isOwner = Boolean(caller && caller.user.id === userId);

  const [listsRes, visibilityMap] = await Promise.all([
    supabaseAdmin
      .from('wishlists')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    readWishlistVisibilityMap(),
  ]);

  if (listsRes.error) {
    return jsonResponse({ success: false, error: listsRes.error.message }, 500);
  }

  const allLists = (listsRes.data || []).map((row: any) => ({
    ...row,
    is_public: Boolean(
      typeof row.is_public === 'boolean' ? row.is_public : visibilityMap[row.id] ?? false
    ),
  }));

  const visibleLists = isOwner ? allLists : allLists.filter((l: any) => l.is_public);

  const cardIdSet = new Set<string>();
  for (const list of visibleLists) {
    const items = list.items && typeof list.items === 'object' ? list.items : {};
    for (const [key, qty] of Object.entries(items)) {
      if ((Number(qty) || 0) <= 0) continue;
      cardIdSet.add(key.replace(/_foil$/, ''));
    }
  }

  const cardIds = Array.from(cardIdSet);
  const cards: any[] = [];
  if (cardIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < cardIds.length; i += 400) {
      chunks.push(cardIds.slice(i, i + 400));
    }
    const results = await Promise.all(
      chunks.map((chunk) =>
        supabaseAdmin
          .from('cards')
          .select(
            'id, name, card_number, set_id, rarity, card_type, subtype, domain, cost, image_path, market_price_eur, market_price_foil_eur, metadata, game, sets(id, name, code)'
          )
          .in('id', chunk)
      )
    );
    for (const res of results) {
      for (const row of (res.data || []) as any[]) {
        const s = Array.isArray(row.sets) ? row.sets[0] : row.sets;
        cards.push({
          ...row,
          set_name: s?.name || null,
          set_code: s?.code || null,
        });
      }
    }
  }

  return jsonResponse({
    success: true,
    wishlists: visibleLists,
    cards,
  });
};

async function handleTogglePublic(request: Request) {
  const caller = await getRequestUser(request);
  if (!caller) {
    return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
  }
  if (caller.isBanned) {
    return jsonResponse({ success: false, error: 'Account suspended.' }, 403);
  }

  const body = await request.json().catch(() => null);
  const wishlistId = isUuid(body?.wishlist_id) ? body.wishlist_id.trim() : null;
  if (!wishlistId || typeof body?.is_public !== 'boolean') {
    return jsonResponse({ success: false, error: 'wishlist_id and is_public boolean are required.' }, 400);
  }

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('wishlists')
    .select('id, user_id')
    .eq('id', wishlistId)
    .maybeSingle();

  if (fetchErr || !existing) {
    return jsonResponse({ success: false, error: 'Wishlist not found.' }, 404);
  }
  if (existing.user_id !== caller.user.id) {
    return jsonResponse({ success: false, error: 'Forbidden.' }, 403);
  }

  const isPublic = Boolean(body.is_public);
  const currentMap = await readWishlistVisibilityMap();
  currentMap[wishlistId] = isPublic;

  await supabaseAdmin
    .from('settings')
    .upsert({ key: VISIBILITY_SETTINGS_KEY, value: JSON.stringify(currentMap) }, { onConflict: 'key' });

  const { error: updateErr } = await supabaseAdmin
    .from('wishlists')
    .update({ is_public: isPublic, updated_at: new Date().toISOString() })
    .eq('id', wishlistId)
    .eq('user_id', caller.user.id);

  if (updateErr && !isMissingSchemaError(updateErr)) {
    return jsonResponse({ success: false, error: updateErr.message }, 500);
  }

  return jsonResponse({ success: true, wishlist_id: wishlistId, is_public: isPublic });
}

export const POST: APIRoute = async ({ request }) => handleTogglePublic(request);
export const PATCH: APIRoute = async ({ request }) => handleTogglePublic(request);
