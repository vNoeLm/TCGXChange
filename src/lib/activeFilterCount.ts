import type { FilterState } from '../types';

/** How many individual filter selections are active, for the badge on the Filters button. */
export function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.sets && filters.sets.length > 0) count += filters.sets.length;
  if (filters.wishlistId) count++;
  if (filters.rarities && filters.rarities.length > 0) count += filters.rarities.length;
  if (filters.type) count++;
  if (filters.domains && filters.domains.length > 0) count += filters.domains.length;
  if (filters.foilFilter) count++;
  if (filters.signedFilter && filters.signedFilter !== 'all') count++;
  if (filters.altArtFilter && filters.altArtFilter !== 'all') count++;
  if (filters.overnumberedFilter && filters.overnumberedFilter !== 'all') count++;
  if (filters.spFilter && filters.spFilter !== 'all') count++;
  if (filters.baseSetFilter && filters.baseSetFilter !== 'all') count++;
  if (filters.costMin && filters.costMin > 1) count++;
  if (filters.costMax && filters.costMax < 10) count++;
  if (filters.tags && filters.tags.length > 0) count += filters.tags.length;
  if (filters.keywords && filters.keywords.length > 0) count += filters.keywords.length;
  return count;
}
