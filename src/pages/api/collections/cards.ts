import type { APIRoute } from 'astro';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { normalizeCards } from '../../../lib/collectionDefaults';
import { loadCollection, saveCollectionCards, syncAlwaysList } from '../../../lib/collectionsServer';

export const prerender = false;

/**
 * POST { id, deltas?: { key: +n/-n }, set?: { key: count } (whole collection), prices?: { cardId: huf } }
 *
 * Changes card counts in a named collection. For an always-list collection the listings follow in
 * the same request: new copies are listed (at `prices`, the browser's suggestion from the
 * collection's defaults), removed ones taken off sale. Returns the collection as saved, and any
 * cards that couldn't go lower because buyers are holding copies.
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

  if (changed.size === 0) return jsonResponse({ success: true, collection: coll, clamped: {} });

  const updatedAt = await saveCollectionCards(caller.user.id, coll.id, cards);
  let clamped: Record<string, number> = {};
  if (coll.always_list && !caller.isBanned) {
    const prices: Record<string, number> = {};
    if (body.prices && typeof body.prices === 'object') {
      for (const [k, v] of Object.entries(body.prices as Record<string, unknown>)) {
        const n = Math.round(Number(v));
        if (Number.isFinite(n) && n >= 0) prices[k] = n;
      }
    }
    const result = await syncAlwaysList(caller.user.id, { ...coll, cards }, [...changed], prices);
    clamped = result.clamped;
    for (const [key, min] of Object.entries(clamped)) cards[key] = min;
  }

  return jsonResponse({ success: true, collection: { ...coll, cards, updated_at: updatedAt }, clamped });
};
