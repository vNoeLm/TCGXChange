import type { FilterState } from '../types';
import { matchesCardVariants } from './cardVariants';

type FilterableListing = { card_id?: string | null } & Record<string, any>;

/**
 * Whether one marketplace listing belongs in the card views under the current filters.
 *
 * The wishlist filter narrows the listings down to the cards a list wants. It lives here, next to
 * the variant filters, because it used to be applied inside only one of the two card views - so
 * "Show in marketplace" (the grouped card tiles) still showed every card.
 */
export function matchesMarketplaceCard(
  card: FilterableListing,
  filters: FilterState,
  wishlistCardIds: Set<string> | null
): boolean {
  if (wishlistCardIds && !(card.card_id && wishlistCardIds.has(card.card_id))) return false;
  return matchesCardVariants(card, filters);
}
