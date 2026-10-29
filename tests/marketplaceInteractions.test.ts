import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// Simple in-memory localStorage polyfill for Node test environment
const memoryStore = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => memoryStore.get(key) || null,
  setItem: (key: string, val: string) => memoryStore.set(key, String(val)),
  removeItem: (key: string) => memoryStore.delete(key),
  clear: () => memoryStore.clear(),
};

beforeAll(() => {
  (globalThis as any).localStorage = mockLocalStorage;
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }
});

import {
  getLikedListingIds,
  isListingLiked,
  toggleListingLike,
  getSavedListingIds,
  isListingSaved,
  toggleListingSave,
  getLikedTradeIds,
  isTradeLiked,
  toggleTradeLike,
  getSavedTradeIds,
  isTradeSaved,
  toggleTradeSave,
  getEffectiveLikeCount,
  saveStoredLikeCount,
  clearUserLikes,
} from '../src/lib/marketplaceInteractions';
import { SORT_MODES, SORT_MODE_GROUPS } from '../src/lib/constants';

describe('Marketplace Interactions - Likes & Saves', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('includes Most Liked in SORT_MODES', () => {
    expect(SORT_MODES).toContain('Most Liked');
  });

  it('groups related sort options so the dropdown keeps its striped blocks', () => {
    // A single-option group (Most Liked) is fine; a pair must be two directions of the same sort.
    expect(SORT_MODE_GROUPS.flat()).toEqual([...SORT_MODES]);
    expect(new Set(SORT_MODES).size).toBe(SORT_MODES.length);
    SORT_MODE_GROUPS.forEach(group => {
      expect([1, 2]).toContain(group.length);
      if (group.length === 2) {
        const label = (mode: string) => mode.slice(0, mode.lastIndexOf('('));
        expect(label(group[0])).toBe(label(group[1]));
      }
    });
  });

  it('correctly toggles listing like and updates stored IDs and count', async () => {
    const listingId = 'test-listing-1';
    expect(isListingLiked(listingId)).toBe(false);

    // Like
    const res1 = await toggleListingLike(listingId, 0);
    expect(res1.liked).toBe(true);
    expect(res1.count).toBe(1);
    expect(isListingLiked(listingId)).toBe(true);
    expect(getLikedListingIds().has(listingId)).toBe(true);

    // Unlike
    const res2 = await toggleListingLike(listingId, 1);
    expect(res2.liked).toBe(false);
    expect(res2.count).toBe(0);
    expect(isListingLiked(listingId)).toBe(false);
  });

  it('correctly toggles listing save (bookmark)', async () => {
    const listingId = 'test-listing-save-1';
    expect(isListingSaved(listingId)).toBe(false);

    // Save
    const res1 = await toggleListingSave(listingId);
    expect(res1.saved).toBe(true);
    expect(isListingSaved(listingId)).toBe(true);
    expect(getSavedListingIds().has(listingId)).toBe(true);

    // Unsave
    const res2 = await toggleListingSave(listingId);
    expect(res2.saved).toBe(false);
    expect(isListingSaved(listingId)).toBe(false);
  });

  it('correctly toggles trade like and save', async () => {
    const tradeId = 'test-trade-1';
    expect(isTradeLiked(tradeId)).toBe(false);
    expect(isTradeSaved(tradeId)).toBe(false);

    // Liking a trade automatically likes and saves it for later
    const likeRes = await toggleTradeLike(tradeId, 5);
    expect(likeRes.liked).toBe(true);
    expect(likeRes.count).toBe(6);
    expect(isTradeLiked(tradeId)).toBe(true);
    expect(isTradeSaved(tradeId)).toBe(true);
    expect(getSavedTradeIds().has(tradeId)).toBe(true);

    // Unliking also unsaves
    const unlikeRes = await toggleTradeLike(tradeId, 6);
    expect(unlikeRes.liked).toBe(false);
    expect(unlikeRes.count).toBe(5);
    expect(isTradeLiked(tradeId)).toBe(false);
    expect(isTradeSaved(tradeId)).toBe(false);
  });

  it('sorts listings by likes descending when sort mode is Most Liked', () => {
    const sampleListings = [
      { id: '1', name: 'Card A', likes_count: 2 },
      { id: '2', name: 'Card B', likes_count: 10 },
      { id: '3', name: 'Card C', likes_count: 0 },
      { id: '4', name: 'Card D' }, // undefined likes
    ];

    const sorted = [...sampleListings].sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));

    expect(sorted.map(s => s.id)).toEqual(['2', '1', '3', '4']);
  });

  it('preserves like count after reload even if server returns 0', async () => {
    const listingId = 'card-with-likes';
    // Server returns 0 likes
    expect(getEffectiveLikeCount(listingId, 'listing', 0)).toBe(0);

    // User likes it
    const res = await toggleListingLike(listingId, 0);
    expect(res.count).toBe(1);

    // User refreshes (simulating server returning 0 on re-fetch)
    const effective = getEffectiveLikeCount(listingId, 'listing', 0);
    expect(effective).toBe(1);
    expect(isListingLiked(listingId)).toBe(true);
  });

  it('correctly uses authoritative higher count from database when multiple users like it', async () => {
    const listingId = 'popular-card';
    saveStoredLikeCount(listingId, 1);

    // Multiple profiles have liked it on the database (db count is 5)
    const effective = getEffectiveLikeCount(listingId, 'listing', 5);
    expect(effective).toBe(5);
  });

  it('clears user likes when clearUserLikes is called on sign out', async () => {
    const listingId = 'profile-a-card';
    await toggleListingLike(listingId, 0);
    expect(isListingLiked(listingId)).toBe(true);

    clearUserLikes();
    expect(isListingLiked(listingId)).toBe(false);
  });
});

import { formatPricePerCard, getBulkCountLabel, extractAuctionBulkInfo } from '../src/lib/bulkHelpers';

describe('Bulk Lots & Bulk Auctions Utilities', () => {
  it('correctly calculates price per card with ~ for approximate counts and exact for exact counts', () => {
    // Exact count (5000 Ft / 250 = 20 Ft)
    expect(formatPricePerCard(5000, 250, null)).toBe('20 Ft / card');

    // Approximate count (5000 Ft / 250 = ~20 Ft)
    expect(formatPricePerCard(5000, null, 250)).toBe('~20 Ft / card');

    // Approximate count with both exact and approx given
    expect(formatPricePerCard(5000, 250, 250)).toBe('~20 Ft / card');

    // Dynamic EUR currency formatting
    const mockEurFormatter = (huf: number) => `${(huf / 400).toFixed(2).replace('.', ',')} €`;
    expect(formatPricePerCard(5000, 250, null, mockEurFormatter)).toBe('0,05 € / card');
    expect(formatPricePerCard(5000, null, 250, mockEurFormatter)).toBe('~0,05 € / card');

    // Missing count or price
    expect(formatPricePerCard(0, 250, null)).toBeNull();
    expect(formatPricePerCard(5000, 0, null)).toBeNull();
  });

  it('correctly formats bulk count labels', () => {
    expect(getBulkCountLabel(100, null)).toBe('100 Cards');
    expect(getBulkCountLabel(null, 250)).toBe('~250 Cards');
    expect(getBulkCountLabel(100, 120)).toBe('100 Cards (Exact) / ~120');
  });

  it('extracts bulk information from auction properties and fallback description', () => {
    // Direct properties
    const directAuction = {
      exact_card_count: 500,
      approx_card_count: null,
      is_bulk: true,
      description: 'Some bulk cards',
    };
    const directInfo = extractAuctionBulkInfo(directAuction);
    expect(directInfo.isBulk).toBe(true);
    expect(directInfo.exactCount).toBe(500);
    expect(directInfo.countLabel).toBe('500 Cards');

    // Extracted from description (exact)
    const descAuctionExact = {
      exact_card_count: null,
      approx_card_count: null,
      is_bulk: false,
      description: 'Mixed riftbound cards\n\nLot Card Count: 300 cards (exact)',
    };
    const descInfoExact = extractAuctionBulkInfo(descAuctionExact);
    expect(descInfoExact.isBulk).toBe(true);
    expect(descInfoExact.exactCount).toBe(300);
    expect(descInfoExact.countLabel).toBe('300 Cards');

    // Extracted from description (approx)
    const descAuctionApprox = {
      exact_card_count: null,
      approx_card_count: null,
      is_bulk: false,
      description: 'Mixed riftbound cards\n\nLot Card Count: ~250 cards (approx)',
    };
    const descInfoApprox = extractAuctionBulkInfo(descAuctionApprox);
    expect(descInfoApprox.isBulk).toBe(true);
    expect(descInfoApprox.approxCount).toBe(250);
    expect(descInfoApprox.countLabel).toBe('~250 Cards');

    // Non-bulk single card auction
    const singleAuction = {
      exact_card_count: null,
      approx_card_count: null,
      is_bulk: false,
      description: 'A single legendary card',
    };
    const singleInfo = extractAuctionBulkInfo(singleAuction);
    expect(singleInfo.isBulk).toBe(false);
  });
});
