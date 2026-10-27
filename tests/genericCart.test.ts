import { describe, it, expect } from 'vitest';
import {
  storeToGenericItem,
  marketplaceToGenericItem,
  genericCartTotalHuf,
  genericCartItemCount,
} from '../src/lib/genericCart';
import { STORE_PUBLIC_LAUNCH } from '../src/lib/storeConstants';
import type { StoreCartItem } from '../src/lib/storeCart';
import type { MarketplaceCartItem } from '../src/lib/marketplaceCart';

describe('genericCart utilities', () => {
  it('converts StoreCartItem to GenericCartItem with correct limits and badges', () => {
    const storeItem: StoreCartItem = {
      productId: 'prod-123',
      slug: 'booster-box-riftbound',
      name: 'Riftbound Origins Booster Box',
      brand: 'Riftbound',
      variantLabel: 'English Display',
      image: '/images/booster.png',
      priceHuf: 45000,
      quantity: 2,
      stockQuantity: 10,
      maxPerOrder: 2,
    };

    const generic = storeToGenericItem(storeItem);
    expect(generic.id).toBe('prod-123');
    expect(generic.name).toBe('Riftbound Origins Booster Box');
    expect(generic.priceHuf).toBe(45000);
    expect(generic.quantity).toBe(2);
    expect(generic.maxQuantity).toBe(2); // Capped by the product's basket limit
    expect(generic.badge).toBe('Limit 2');
    expect(generic.subtitle).toBe('English Display');
    expect(generic.url).toBe('/store/product?slug=booster-box-riftbound');
    expect(generic.sellerId).toBe('store');
    expect(generic.sellerName).toBe('TCG XChange Store');
  });

  it('converts MarketplaceCartItem to GenericCartItem with condition, foil, and seller details', () => {
    const marketItem: MarketplaceCartItem = {
      inventoryId: 'inv-456',
      sellerId: 'user-789',
      sellerName: 'ProTrader',
      cardName: 'Dark Magician',
      cardNumber: 'SDY-006',
      imagePath: '/images/dark_magician.jpg',
      priceHuf: 3500,
      quantity: 1,
      maxQuantity: 3,
      isFoil: true,
      condition: 'Near Mint',
      sellerCountry: 'HU',
      handoverMethods: ['foxpost', 'personal'],
    };

    const generic = marketplaceToGenericItem(marketItem);
    expect(generic.id).toBe('inv-456');
    expect(generic.name).toBe('Dark Magician');
    expect(generic.priceHuf).toBe(3500);
    expect(generic.quantity).toBe(1);
    expect(generic.maxQuantity).toBe(3);
    expect(generic.subtitle).toBe('Near Mint · Foil · #SDY-006');
    expect(generic.badge).toBe('Max 3');
    expect(generic.sellerId).toBe('user-789');
    expect(generic.sellerName).toBe('ProTrader');
  });

  it('calculates totals and counts correctly', () => {
    const items = [
      { priceHuf: 1000, quantity: 2 },
      { priceHuf: 2500, quantity: 1 },
      { priceHuf: 500, quantity: 4 },
    ];
    expect(genericCartTotalHuf(items)).toBe(1000 * 2 + 2500 * 1 + 500 * 4); // 2000 + 2500 + 2000 = 6500
    expect(genericCartItemCount(items)).toBe(2 + 1 + 4); // 7
  });

  it('admin locks /store route by keeping STORE_PUBLIC_LAUNCH false', () => {
    expect(STORE_PUBLIC_LAUNCH).toBe(false);
  });
});
