import { describe, expect, it } from 'vitest';
import { isRestrictedApiPath, isRestrictedPath } from '../src/lib/accountAccess';

describe('pages a suspended account cannot open', () => {
  it('covers the marketplace, the seller hub and messages', () => {
    expect(isRestrictedPath('/marketplace')).toBe(true);
    expect(isRestrictedPath('/seller')).toBe(true);
    expect(isRestrictedPath('/messages')).toBe(true);
  });

  it('covers their sub-pages and ignores query strings and trailing slashes', () => {
    expect(isRestrictedPath('/marketplace/')).toBe(true);
    expect(isRestrictedPath('/marketplace?wishlist=abc')).toBe(true);
    expect(isRestrictedPath('/seller/listings')).toBe(true);
    expect(isRestrictedPath('/messages/123')).toBe(true);
  });

  it('leaves the catalog, store and account pages alone', () => {
    expect(isRestrictedPath('/')).toBe(false);
    expect(isRestrictedPath('/store')).toBe(false);
    expect(isRestrictedPath('/store/product')).toBe(false);
    expect(isRestrictedPath('/profile')).toBe(false);
    expect(isRestrictedPath('/wishlists')).toBe(false);
    expect(isRestrictedPath('/marketplaces')).toBe(false);
  });
});

describe('APIs a suspended account cannot write to', () => {
  it('covers marketplace, review and report writes', () => {
    expect(isRestrictedApiPath('/api/marketplace/listings')).toBe(true);
    expect(isRestrictedApiPath('/api/marketplace/hold-request')).toBe(true);
    expect(isRestrictedApiPath('/api/marketplace/trades/propose')).toBe(true);
    expect(isRestrictedApiPath('/api/reviews')).toBe(true);
    expect(isRestrictedApiPath('/api/reports/submit')).toBe(true);
  });

  it('leaves the catalog, store and account APIs alone', () => {
    expect(isRestrictedApiPath('/api/store/products')).toBe(false);
    expect(isRestrictedApiPath('/api/profile/delete-account')).toBe(false);
    expect(isRestrictedApiPath('/api/collections')).toBe(false);
    expect(isRestrictedApiPath('/api/decks')).toBe(false);
    expect(isRestrictedApiPath('/api/orders')).toBe(false);
  });
});
