import { supabaseAdmin } from './supabaseServer';

/**
 * Server-only: completed P2P marketplace trade orders and per-person numbers drawn from them.
 * Note: Official retail store sales (ORD-...) belong to the Store and must NEVER count towards
 * community seller tiers, sales stats, or seller hub.
 */

export interface TradeOrder {
  order_number: string;
  /** The buyer's account (null for old guest checkouts). */
  user_id: string | null;
  seller_id: string;
  status: string;
  items?: { quantity?: number; card_name?: string }[];
}

export async function loadTradeOrders(): Promise<TradeOrder[]> {
  const result: TradeOrder[] = [];
  const seenOrderNumbers = new Set<string>();

  // 1. Read completed P2P orders from settings.store_orders
  try {
    const { data } = await supabaseAdmin.from('settings').select('value').eq('key', 'store_orders').maybeSingle();
    if (data?.value) {
      const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (Array.isArray(parsed)) {
        for (const o of parsed) {
          if (!o || !o.order_number) continue;
          const orderNum = String(o.order_number);
          // Strictly exclude store retail orders (ORD-... or missing seller or platform-owner)
          const isStoreOrder = orderNum.startsWith('ORD-') || !o.seller_id || o.seller_id === 'platform-owner';
          if (isStoreOrder) continue;

          seenOrderNumbers.add(orderNum);
          result.push({
            order_number: orderNum,
            user_id: o.user_id || null,
            seller_id: o.seller_id,
            status: o.status || '',
            items: Array.isArray(o.items) ? o.items : [],
          });
        }
      }
    }
  } catch (e) {
    console.warn('loadTradeOrders settings error:', e);
  }

  // 2. Also read completed hold_requests from database
  try {
    const { data: holds } = await supabaseAdmin
      .from('hold_requests')
      .select('id, order_number, buyer_id, seller_id, status, items, quantity')
      .in('status', ['completed', 'Delivered']);

    if (Array.isArray(holds)) {
      for (const h of holds) {
        if (!h.seller_id) continue;
        const orderNum = h.order_number || `P2P-${String(h.id).slice(0, 8).toUpperCase()}`;
        if (seenOrderNumbers.has(orderNum)) continue;
        seenOrderNumbers.add(orderNum);

        result.push({
          order_number: orderNum,
          user_id: h.buyer_id || null,
          seller_id: h.seller_id,
          status: 'Delivered',
          items: Array.isArray(h.items) && h.items.length ? h.items : [{ quantity: Number(h.quantity) || 1 }],
        });
      }
    }
  } catch (e) {
    console.warn('loadTradeOrders hold_requests error:', e);
  }

  return result;
}

const units = (o: TradeOrder) => (o.items && o.items.length ? o.items.reduce((s, it) => s + (it.quantity || 1), 0) : 1);

export interface TradeStats {
  salesCount: number;
  itemsSold: number;
  purchasesCount: number;
  itemsBought: number;
}

export function tradeStatsFor(orders: TradeOrder[], userId: string): TradeStats {
  const stats: TradeStats = { salesCount: 0, itemsSold: 0, purchasesCount: 0, itemsBought: 0 };
  for (const o of orders) {
    if (o.status === 'Cancelled') continue;
    if (o.seller_id === userId) {
      stats.salesCount += 1;
      stats.itemsSold += units(o);
    }
    if (o.user_id === userId) {
      stats.purchasesCount += 1;
      stats.itemsBought += units(o);
    }
  }
  return stats;
}
