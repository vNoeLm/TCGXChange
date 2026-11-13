import { supabaseAdmin } from './supabaseServer';
import { collectionKey } from './collectionDefaults';
import { adjustNamedCollectionCard } from './collectionsServer';

/**
 * Adjust how many copies of a card a seller has in their tracked collection.
 * Negative `delta` removes copies (listing them for sale); positive gives them
 * back (unlisting, or reducing a listing's quantity). A listing's quantity is
 * decremented from the collection at listing time, not at sale time, so the
 * lifecycle is: list -> collection down, unlist -> collection back up. Nothing
 * about a subsequent sale touches the collection again.
 *
 * No-ops if the seller has no collection document — some sellers don't track
 * a collection at all, so we never force one into existence.
 *
 * Returns the change actually made, which can be smaller than asked: taking copies out stops at
 * zero, and a seller with no collection gets 0. Callers use it to record how many copies of a
 * listing really came out of the collection.
 */
export async function adjustSellerCollection(
  sellerId: string | null | undefined,
  cardId: string | null | undefined,
  isFoil: boolean,
  delta: number,
  /** A named collection to change instead of Personal (copies listed from it by Quick List). */
  namedCollectionId?: string | null
): Promise<number> {
  if (!sellerId || !cardId || !delta) return 0;
  if (namedCollectionId) return adjustNamedCollectionCard(sellerId, namedCollectionId, collectionKey(cardId, isFoil), delta);
  try {
    const { data: row } = await supabaseAdmin
      .from('user_collections')
      .select('cards')
      .eq('user_id', sellerId)
      .maybeSingle();
    if (!row?.cards) return 0;

    const cards: Record<string, number> = { ...(row.cards as any) };
    const key = collectionKey(cardId, isFoil);
    const before = Number(cards[key]) || 0;
    const next = Math.max(0, before + delta);
    if (next === 0) delete cards[key];
    else cards[key] = next;

    await supabaseAdmin
      .from('user_collections')
      .update({ cards, updated_at: new Date().toISOString() })
      .eq('user_id', sellerId);
    return next - before;
  } catch (err) {
    console.warn('Failed to adjust seller collection:', err);
    return 0;
  }
}
