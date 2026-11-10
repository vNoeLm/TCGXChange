import { OWNER_ID } from './constants';

/**
 * Checks whether an order is strictly an official retail store order.
 * P2P marketplace orders, hold requests, trades, auctions, and bulk deals
 * must NEVER be considered store orders.
 */
export function isStoreOrder(order: any): boolean {
  if (!order) return false;
  const num = String(order.order_number || order.id || '').trim();

  // 1. Explicitly reject any P2P, hold, trade, auction, or bulk order prefixes
  if (
    num.startsWith('P2P-') ||
    num.startsWith('HOLD-') ||
    num.startsWith('TEST-HOLD-') ||
    num.startsWith('TEST-TRADE-') ||
    num.startsWith('TEST-AUCT-') ||
    num.startsWith('TEST-BULK-')
  ) {
    return false;
  }

  // 2. Reject if tied to a peer-to-peer marketplace hold request
  if (order.hold_request_id) {
    return false;
  }

  // 3. Reject if sold by an individual community seller (not the platform owner)
  if (order.seller_id && order.seller_id !== 'platform-owner' && order.seller_id !== OWNER_ID) {
    return false;
  }

  // 4. Accept if order number starts with standard store order prefix ORD- or TEST-STORE- or explicit store_order flag
  if (num.startsWith('ORD-') || num.startsWith('TEST-STORE-') || order.store_order === true) {
    return true;
  }

  // 5. Default fallback: if no seller_id or seller is platform-owner, and no hold_request_id, it is a store order
  return !order.seller_id || order.seller_id === 'platform-owner' || order.seller_id === OWNER_ID;
}

/**
 * Checks whether an order is a peer-to-peer marketplace order
 * (buyer-seller hold request, trade swap, auction win, or bulk lot).
 */
export function isMarketplaceOrder(order: any): boolean {
  return !isStoreOrder(order);
}
