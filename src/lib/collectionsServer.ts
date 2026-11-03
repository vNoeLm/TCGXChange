import { supabaseAdmin } from './supabaseServer';
import { normalizeCards, normalizeListDefaults, type ListDefaults, type NamedCollection } from './collectionDefaults';
import { parseCollectionKey } from './sellerNotes';
import { OPEN_HOLD_STATUSES } from './holdFlow';

/**
 * Server side of named collections (see lib/collectionDefaults.ts).
 *
 * An "always list" collection is the seller's stock: for every card in it,
 *   copies in the collection = copies listed + copies reserved by open hold requests.
 * So adding a copy lists it (or raises the listing's stock), removing one takes it off sale, and a
 * completed sale takes it out of the collection (the listing already went down when the hold was
 * requested). Copies promised to a buyer can't be removed until that hold is resolved.
 */

export function rowToCollection(row: any): NamedCollection {
  const defaults = normalizeListDefaults(row.list_defaults);
  const isPublic = Boolean(row.is_public ?? row.list_defaults?.is_public ?? false);
  const description = typeof row.description === 'string' ? row.description : typeof row.list_defaults?.description === 'string' ? row.list_defaults.description : undefined;
  return {
    id: row.id,
    name: row.name,
    cards: normalizeCards(row.cards),
    always_list: Boolean(row.always_list),
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

interface ListingRow {
  id: string;
  card_id: string;
  is_foil: boolean;
  quantity: number;
  price_huf?: number;
  condition?: string;
  status: string;
  notes: string;
}

/** Every listing an always-list collection has made (any status), keyed by collection key. */
async function listingsOf(collectionId: string): Promise<Map<string, ListingRow>> {
  const map = new Map<string, ListingRow>();

  // 1. Check marketplace_listings first
  try {
    const { data: mktRows } = await supabaseAdmin
      .from('marketplace_listings')
      .select('id, card_id, is_foil, quantity, price_huf, condition, status, description, handover_methods')
      .eq('collection_id', collectionId);

    for (const row of (mktRows || []) as any[]) {
      const key = row.is_foil ? `${row.card_id}_foil` : row.card_id;
      const existing = map.get(key);
      if (!existing || (existing.status === 'Archived' && row.status !== 'Archived')) {
        map.set(key, {
          id: row.id,
          card_id: row.card_id,
          is_foil: row.is_foil,
          quantity: row.quantity,
          price_huf: row.price_huf,
          condition: row.condition,
          status: row.status,
          notes: JSON.stringify({
            source: 'collection',
            collection_id: collectionId,
            user_notes: row.description,
            handover_methods: row.handover_methods,
          }),
        });
      }
    }
  } catch {}

  // 2. The marketplace table is the only listing backend; legacy inventory rows are gone.
  return map;
}

/** Copies of these listings set aside by the seller's open hold requests, per listing id. */
async function reservedByListing(sellerId: string, listingIds: string[]): Promise<Map<string, number>> {
  const reserved = new Map<string, number>();
  if (listingIds.length === 0) return reserved;
  const wanted = new Set(listingIds);
  const { data } = await supabaseAdmin
    .from('hold_requests')
    .select('inventory_id, quantity, items, status')
    .eq('seller_id', sellerId)
    .in('status', OPEN_HOLD_STATUSES as string[]);
  for (const h of data || []) {
    const items = Array.isArray((h as any).items) && (h as any).items.length
      ? (h as any).items
      : [{ inventory_id: (h as any).inventory_id, quantity: (h as any).quantity }];
    for (const it of items) {
      if (it?.inventory_id && wanted.has(it.inventory_id)) {
        reserved.set(it.inventory_id, (reserved.get(it.inventory_id) || 0) + Math.max(1, Number(it.quantity) || 1));
      }
    }
  }
  return reserved;
}

/** Takes a listing off the marketplace for good. */
async function retireListing(id: string): Promise<void> {
  try {
    await supabaseAdmin.from('marketplace_listings').delete().eq('id', id);
  } catch {}
}

export interface SyncResult {
  /** Cards whose count was raised back to what open holds have reserved, with that minimum. */
  clamped: Record<string, number>;
  listed: number;
  cardsListed: number;
  skippedUnpriced: number;
}

/**
 * Brings an always-list collection's listings in line with its counts, for `keys` (or every card it
 * has or has listed). `prices` gives the price for a card (0 means unpriced & skip_unpriced active).
 * When `recalculatePrices` is true, existing listings also have their price_huf, condition, and
 * handover_methods updated to match the collection's defaults and current market prices.
 */
export async function syncAlwaysList(
  sellerId: string,
  coll: NamedCollection,
  keys: string[] | null,
  prices: Record<string, number> = {},
  recalculatePrices = false
): Promise<SyncResult> {
  const listings = await listingsOf(coll.id);
  const allKeys = keys ?? [...new Set([...Object.keys(coll.cards), ...listings.keys()])];
  const reserved = await reservedByListing(sellerId, [...listings.values()].map((l) => l.id));
  const defaults: ListDefaults = coll.list_defaults;
  const keepCopies = Math.max(0, Math.round(defaults.keep_copies || 0));

  const cards = { ...coll.cards };
  const clamped: Record<string, number> = {};
  const toInsert: any[] = [];
  let listed = 0;
  let cardsListed = 0;
  let skippedUnpriced = 0;

  for (const key of allKeys) {
    const { cardId, isFoil } = parseCollectionKey(key);
    const listing = listings.get(key);
    const held = listing ? reserved.get(listing.id) || 0 : 0;
    let count = cards[key] || 0;
    if (count < held) {
      count = held;
      cards[key] = held;
      clamped[key] = held;
    }

    const rawPrice = key in prices ? prices[key] : (cardId in prices ? prices[cardId] : undefined);
    const isSkippedUnpriced = defaults.price_mode !== 'fixed' && defaults.skip_unpriced && (rawPrice !== undefined ? rawPrice <= 0 : false);

    let available = Math.max(0, count - keepCopies - held);
    if (isSkippedUnpriced) {
      if (available > 0) skippedUnpriced += 1;
      available = 0;
    }

    const targetPrice = Math.max(1, Math.round(Number(rawPrice) || defaults.base_price_huf));

    if (listing) {
      if (available > 0) {
        if (recalculatePrices) {
          await supabaseAdmin
            .from('marketplace_listings')
            .update({
              quantity: available,
              status: 'In Stock',
              price_huf: targetPrice,
              condition: defaults.condition,
              handover_methods: defaults.handover_methods,
            })
            .eq('id', listing.id);
        } else if (listing.quantity !== available || listing.status !== 'In Stock') {
          await supabaseAdmin.from('marketplace_listings').update({ quantity: available, status: 'In Stock' }).eq('id', listing.id);
        }
        listed += available;
        cardsListed += 1;
      } else if (held > 0) {
        if (listing.quantity !== 0) await supabaseAdmin.from('marketplace_listings').update({ quantity: 0, status: 'Reserved' }).eq('id', listing.id);
      } else if (listing.status !== 'Archived' || listing.quantity !== 0) {
        await retireListing(listing.id);
      }
    } else if (available > 0) {
      toInsert.push({
        seller_id: sellerId,
        card_id: cardId,
        condition: defaults.condition,
        is_foil: isFoil,
        price_huf: targetPrice,
        quantity: available,
        status: 'In Stock',
        handover_methods: defaults.handover_methods,
        collection_id: coll.id,
      });
      listed += available;
      cardsListed += 1;
    }
  }

  if (toInsert.length) {
    for (let i = 0; i < toInsert.length; i += 200) {
      await supabaseAdmin.from('marketplace_listings').insert(toInsert.slice(i, i + 200));
    }
  }
  if (Object.keys(clamped).length) await saveCollectionCards(sellerId, coll.id, cards);
  return { clamped, listed, cardsListed, skippedUnpriced };
}

/** Turning "always list" off: take down what the collection listed, apart from copies buyers are holding. */
export async function unlistCollection(sellerId: string, collectionId: string): Promise<void> {
  const listings = await listingsOf(collectionId);
  const reserved = await reservedByListing(sellerId, [...listings.values()].map((l) => l.id));
  for (const listing of listings.values()) {
    const held = reserved.get(listing.id) || 0;
    if (held > 0) {
      // Nothing more goes on sale; the copies buyers hold stay linked, so a completed sale still
      // takes them out of the collection.
      if (listing.quantity !== 0) await supabaseAdmin.from('marketplace_listings').update({ quantity: 0, status: 'Reserved' }).eq('id', listing.id);
    } else if (listing.status !== 'Archived') {
      await retireListing(listing.id);
    }
  }
}
