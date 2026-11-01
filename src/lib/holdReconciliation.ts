export const ACTIVE_HOLD_STATUSES = [
  'pending',
  'held',
  'handed_over',
  'buyer_received',
] as const;

export interface OpenHoldReference {
  inventory_id?: string | null;
  items?: Array<{ inventory_id?: string | null }> | null;
}

/**
 * Collects every listing/trade/bulk/auction ID currently locked by an active hold request.
 * Inspects both the top-level `inventory_id` column and nested `items[].inventory_id` entries.
 */
export function collectActiveHeldIds(openHoldRows: OpenHoldReference[] | null | undefined): Set<string> {
  const activeIds = new Set<string>();
  if (!Array.isArray(openHoldRows)) return activeIds;

  for (const row of openHoldRows) {
    if (!row) continue;
    if (typeof row.inventory_id === 'string' && row.inventory_id.trim()) {
      activeIds.add(row.inventory_id.trim());
    }
    if (Array.isArray(row.items)) {
      for (const item of row.items) {
        if (item && typeof item.inventory_id === 'string' && item.inventory_id.trim()) {
          activeIds.add(item.inventory_id.trim());
        }
      }
    }
  }
  return activeIds;
}

/**
 * Finds items whose status is `'on_hold'` (case-insensitive) even though zero active hold
 * requests reference their ID ("ghost holds").
 */
export function findOrphanedOnHoldIds<T extends { id: string; status?: string | null }>(
  items: T[] | null | undefined,
  activeHeldIds: Set<string>
): string[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const orphaned: string[] = [];
  for (const item of items) {
    if (!item?.id) continue;
    const normStatus = String(item.status || '').trim().toLowerCase();
    if ((normStatus === 'on_hold' || normStatus === 'on hold') && !activeHeldIds.has(item.id)) {
      orphaned.push(item.id);
    }
  }
  return orphaned;
}
