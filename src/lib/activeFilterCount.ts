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
  const defaultMinCost = (filters.game === 'onepiece' || filters.game === 'lorcana') ? 0 : 1;
  const defaultMaxCost = filters.game === 'lorcana' ? 12 : 10;
  if (filters.costMin != null && filters.costMin > defaultMinCost) count++;
  if (filters.costMax != null && filters.costMax < defaultMaxCost) count++;
  if (filters.tags && filters.tags.length > 0) count += filters.tags.length;
  if (filters.keywords && filters.keywords.length > 0) count += filters.keywords.length;
  if (filters.attributes && filters.attributes.length > 0) count += filters.attributes.length;
  if (filters.counters && filters.counters.length > 0) count += filters.counters.length;
  if (filters.blockIcons && filters.blockIcons.length > 0) count += filters.blockIcons.length;
  if (filters.illustrationTypes && filters.illustrationTypes.length > 0) count += filters.illustrationTypes.length;
  if (filters.hideReprints) count++;
  if (filters.powerMin != null || filters.powerMax != null) count++;
  if (filters.inkable && filters.inkable !== 'all') count++;
  if (filters.abilities && filters.abilities.length > 0) count += filters.abilities.length;
  if (filters.loreMin != null || filters.loreMax != null) count++;
  if (filters.strengthMin != null || filters.strengthMax != null) count++;
  if (filters.willpowerMin != null || filters.willpowerMax != null) count++;
  if (filters.movementMin != null || filters.movementMax != null) count++;
  if (filters.legality && filters.legality.length > 0) count += filters.legality.length;
  return count;
}
