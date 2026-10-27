import type { StoreCartItem } from './storeCart';
import type { MarketplaceCartItem } from './marketplaceCart';
import { getCardImageUrl } from './supabase';

/**
 * Universal cart item representation usable across the Store, Marketplace,
 * and any future sub-shops.
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

  // Multi-seller / Marketplace attributes
  sellerId?: string;
  sellerName?: string;
  sellerCountry?: string;
  handoverMethods?: string[];
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

/** Converts a peer-to-peer Marketplace cart item into the generic cart item format. */
export function marketplaceToGenericItem(item: MarketplaceCartItem): GenericCartItem {
  const metaParts: string[] = [];
  if (item.condition) metaParts.push(item.condition);
  if (item.isFoil) metaParts.push('Foil');
  if (item.cardNumber) metaParts.push(`#${item.cardNumber}`);

  return {
    id: item.inventoryId,
    name: item.cardName,
    priceHuf: item.priceHuf,
    quantity: item.quantity,
    maxQuantity: Math.max(1, item.maxQuantity || 1),
    image: item.imagePath ? getCardImageUrl(item.imagePath) : null,
    imagePath: item.imagePath || null,
    subtitle: metaParts.length > 0 ? metaParts.join(' · ') : null,
    badge: item.maxQuantity > 1 ? `Max ${item.maxQuantity}` : null,
    sellerId: item.sellerId,
    sellerName: item.sellerName,
    sellerCountry: item.sellerCountry,
    handoverMethods: item.handoverMethods,
    condition: item.condition,
    isFoil: item.isFoil,
    cardNumber: item.cardNumber,
  };
}

export function genericCartTotalHuf(items: { priceHuf: number; quantity: number }[]): number {
  return items.reduce((sum, item) => sum + (Number(item.priceHuf) || 0) * (Number(item.quantity) || 0), 0);
}

export function genericCartItemCount(items: { quantity: number }[]): number {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}
