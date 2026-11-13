import type { APIRoute } from 'astro';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { normalizeCards } from '../../../lib/collectionDefaults';
import { loadCollection, saveCollectionCards } from '../../../lib/collectionsServer';

export const prerender = false;

/**
 * POST { id, deltas?: { key: +n/-n }, set?: { key: count } (whole collection) }
 *
 * Changes card counts in a named collection and returns the saved collection.
 */
export const POST: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Sign in to use collections.' }, 401);
  const body = await request.json().catch(() => null);
  const coll = body?.id ? await loadCollection(caller.user.id, String(body.id)) : null;
  if (!coll) return jsonResponse({ success: false, error: 'Collection not found.' }, 404);

  const cards = { ...coll.cards };
  const changed = new Set<string>();

  if (body.set && typeof body.set === 'object') {
    const next = normalizeCards(body.set);
    for (const key of new Set([...Object.keys(cards), ...Object.keys(next)])) {
      if ((cards[key] || 0) !== (next[key] || 0)) changed.add(key);
    }
    Object.keys(cards).forEach((k) => delete cards[k]);
    Object.assign(cards, next);
  }
  if (body.deltas && typeof body.deltas === 'object') {
    for (const [key, raw] of Object.entries(body.deltas as Record<string, unknown>)) {
      if (!/^[0-9a-f-]{36}(_foil)?$/i.test(key)) continue;
      const delta = Math.round(Number(raw));
      if (!Number.isFinite(delta) || delta === 0) continue;
      const after = Math.max(0, Math.min(9999, (cards[key] || 0) + delta));
      if (after === 0) delete cards[key];
      else cards[key] = after;
      changed.add(key);
    }
  }

  if (changed.size === 0) return jsonResponse({ success: true, collection: coll });

  const updatedAt = await saveCollectionCards(caller.user.id, coll.id, cards);
  return jsonResponse({ success: true, collection: { ...coll, cards, updated_at: updatedAt } });
};
