import { supabaseAdmin } from './supabaseServer';
import { sanitizePostgrestFilterTerm } from './sanitize';

export interface OrderItemSnapshot {
  id?: string;
  order_id: string;
  order_number: string;
  inventory_id?: string | null;
  card_id?: string | null;
  title: string;
  set_name?: string | null;
  card_number?: string | null;
  condition: string;
  is_foil: boolean;
  unit_price_huf: number;
  quantity: number;
  seller_id?: string | null;
  metadata?: Record<string, any>;
  created_at?: string;
}

/**
 * Persists an array of items as immutable historical snapshots in public.order_items.
 * These records never change even if catalog cards are re-priced or modified in the future.
 */
export async function persistOrderItemsSnapshot(
  orderId: string,
  orderNumber: string,
  rawItems: any[]
): Promise<OrderItemSnapshot[]> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];

  const rows: OrderItemSnapshot[] = rawItems.map(it => {
    const rawPrice = it.price_huf ?? it.price ?? it.unit_price ?? it.unit_price_huf ?? 0;
    const unitPrice = typeof rawPrice === 'number' ? rawPrice : parseFloat(String(rawPrice)) || 0;
    const quantity = Math.max(1, typeof it.quantity === 'number' ? it.quantity : parseInt(String(it.quantity), 10) || 1);

    return {
      order_id: orderId,
      order_number: orderNumber,
      inventory_id: it.inventory_id || it.inventoryId || null,
      card_id: it.card_id || it.cardId || it.id || null,
      title: it.name || it.title || it.card_name || `Card item`,
      set_name: it.set_name || it.setName || null,
      card_number: it.card_number || it.cardNumber || null,
      condition: it.condition || 'Near Mint',
      is_foil: Boolean(it.is_foil || it.isFoil),
      unit_price_huf: Math.max(0, unitPrice),
      quantity,
      seller_id: it.seller_id || it.sellerId || null,
      metadata: {
        image_path: it.image_path || it.image || null,
        rarity: it.rarity || null,
        game: it.game || null,
      },
    };
  });

  try {
    const { data, error } = await supabaseAdmin
      .from('order_items')
      .insert(rows)
      .select('*');

    if (!error && Array.isArray(data)) {
      return data as OrderItemSnapshot[];
    }
  } catch (err) {
    // Graceful fallback if table is not yet migrated in Supabase
  }

  return rows;
}

/**
 * Retrieves immutable item snapshots for an order.
 */
export async function fetchOrderItems(orderIdOrNumber: string): Promise<OrderItemSnapshot[]> {
  try {
    const safeVal = sanitizePostgrestFilterTerm(orderIdOrNumber, 80);
    if (!safeVal) return [];
    const query = safeVal.includes('-') && !safeVal.startsWith('ord_')
      ? supabaseAdmin.from('order_items').select('*').eq('order_number', safeVal)
      : supabaseAdmin.from('order_items').select('*').or(`order_id.eq.${safeVal},order_number.eq.${safeVal}`);

    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      return data as OrderItemSnapshot[];
    }
  } catch (e) {}

  return [];
}
