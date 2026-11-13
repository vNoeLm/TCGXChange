import type { StoreCartItem } from './storeCart';

/**
 * Universal cart item representation usable across the official Store.
 */
export interface GenericCartItem {
  id: string;
  name: string;
  priceHuf: number;
  quantity: number;
  maxQuantity: number;
  image?: string | null;
  imagePath?: string | null;
  subtitle?: string | null;
  badge?: string | null;
  url?: string | null;

  sellerId?: string;
  sellerName?: string;
  sellerCountry?: string;
  condition?: string;
  isFoil?: boolean;
  cardNumber?: string;

  // Official Store attributes
  slug?: string;
  brand?: string;
  variantLabel?: string | null;
  stockQuantity?: number;
  maxPerOrder?: number | null;
}

/** Converts an official Store cart item into the generic cart item format. */
export function storeToGenericItem(item: StoreCartItem): GenericCartItem {
  const stock = Math.max(0, Math.floor(Number(item.stockQuantity) || 0));
  const limit = Number(item.maxPerOrder);
  const maxAllowed = Number.isFinite(limit) && limit > 0 ? Math.min(stock, Math.floor(limit)) : stock;

  return {
    id: item.productId,
    name: item.name,
    priceHuf: item.priceHuf,
    quantity: item.quantity,
    maxQuantity: Math.max(1, maxAllowed),
    image: item.image,
    subtitle: item.variantLabel || item.brand || null,
    badge: item.maxPerOrder ? `Limit ${item.maxPerOrder}` : null,
    url: `/store/product?slug=${encodeURIComponent(item.slug)}`,
    slug: item.slug,
    brand: item.brand,
    variantLabel: item.variantLabel,
    stockQuantity: item.stockQuantity,
    maxPerOrder: item.maxPerOrder,
    sellerId: 'store',
    sellerName: 'TCG XChange Store',
  };
}

export function genericCartTotalHuf(items: { priceHuf: number; quantity: number }[]): number {
  return items.reduce((sum, item) => sum + (Number(item.priceHuf) || 0) * (Number(item.quantity) || 0), 0);
}

export function genericCartItemCount(items: { quantity: number }[]): number {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}
