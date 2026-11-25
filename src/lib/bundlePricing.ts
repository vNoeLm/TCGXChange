export type BundlePricingMode = 'none' | 'fixed' | 'adaptive';

export interface PostBundlePricingConfig {
  mode: 'fixed' | 'adaptive';
  discount_pct: number;
  bundle_only?: boolean;
}

export interface PostBundlePricingView {
  mode: BundlePricingMode;
  discount_pct: number;
  available_total_huf: number;
  bundle_only?: boolean;
}

export interface PriceableBundleCard {
  is_highlight_only?: boolean;
  price_huf?: number | null;
  quantity?: number;
  held_quantity?: number;
  available_quantity?: number;
  status?: string;
}

export const POST_BUNDLE_PRICING_SETTINGS_KEY = 'p2p_post_bundle_pricing';

export function clampBundleDiscountPct(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(90, n));
}

/**
 * Computes the adaptive bundle price from currently available (non-sold) priced tagged cards:
 *   availableTotalHuf = sum(price_huf * availableQty)
 *   bundlePriceHuf    = round(availableTotalHuf * (1 - discountPct / 100))
 */
export function computeAdaptiveBundlePrice(
  taggedCards: PriceableBundleCard[],
  discountPct: number
): {
  availableTotalHuf: number;
  bundlePriceHuf: number | null;
  discountPct: number;
  pricedAvailableCount: number;
} {
  const pct = clampBundleDiscountPct(discountPct);
  let availableTotalHuf = 0;
  let pricedAvailableCount = 0;

  for (const tc of taggedCards || []) {
    if (tc.is_highlight_only) continue;
    if (tc.status === 'sold') continue;
    const price = Number(tc.price_huf);
    if (!Number.isFinite(price) || price <= 0) continue;
    const availQty =
      tc.available_quantity !== undefined
        ? Math.max(0, Number(tc.available_quantity) || 0)
        : Math.max(0, (Number(tc.quantity) || 0) - (Number(tc.held_quantity) || 0));
    if (availQty <= 0) continue;
    availableTotalHuf += Math.round(price) * availQty;
    pricedAvailableCount += availQty;
  }

  if (availableTotalHuf <= 0 || pricedAvailableCount <= 1) {
    return {
      availableTotalHuf,
      bundlePriceHuf: null,
      discountPct: pct,
      pricedAvailableCount,
    };
  }

  const bundlePriceHuf = Math.max(1, Math.round(availableTotalHuf * (1 - pct / 100)));
  return {
    availableTotalHuf,
    bundlePriceHuf,
    discountPct: pct,
    pricedAvailableCount,
  };
}
