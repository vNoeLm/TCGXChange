import { supabaseAdmin } from './supabaseServer';
import { normalizeCards, normalizeListDefaults, type NamedCollection } from './collectionDefaults';

/** Server side of named collections (see lib/collectionDefaults.ts). */

export function rowToCollection(row: any): NamedCollection {
  const defaults = normalizeListDefaults(row.list_defaults);
  const isPublic = Boolean(row.is_public ?? row.list_defaults?.is_public ?? false);
  const description = typeof row.description === 'string' ? row.description : typeof row.list_defaults?.description === 'string' ? row.list_defaults.description : undefined;
  return {
    id: row.id,
    name: row.name,
    cards: normalizeCards(row.cards),
    always_list: false,
    is_public: isPublic,
    description,
    list_defaults: { ...defaults, is_public: isPublic, description },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function loadCollection(userId: string, id: string): Promise<NamedCollection | null> {
  const { data } = await supabaseAdmin.from('card_collections').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  return data ? rowToCollection(data) : null;
}

export async function saveCollectionCards(userId: string, id: string, cards: Record<string, number>): Promise<string> {
  const updatedAt = new Date().toISOString();
  await supabaseAdmin.from('card_collections').update({ cards, updated_at: updatedAt }).eq('id', id).eq('user_id', userId);
  return updatedAt;
}

/** Changes one card's count in a named collection by `delta` (never below 0). Returns the change made. */
export async function adjustNamedCollectionCard(userId: string, collectionId: string, key: string, delta: number): Promise<number> {
  if (!delta) return 0;
  const coll = await loadCollection(userId, collectionId);
  if (!coll) return 0;
  const before = coll.cards[key] || 0;
  const after = Math.max(0, Math.min(9999, before + delta));
  if (after === before) return 0;
  const cards = { ...coll.cards };
  if (after === 0) delete cards[key];
  else cards[key] = after;
  await saveCollectionCards(userId, collectionId, cards);
  return after - before;
}
