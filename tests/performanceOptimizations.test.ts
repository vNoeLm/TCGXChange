import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { supabase } from '../src/lib/supabase';
import { loadTradeOrders, invalidateTradeOrdersCache } from '../src/lib/tradeOrders';
import { invalidateOrdersCache } from '../src/pages/api/orders';
import { invalidateCardDataVersionCache } from '../src/pages/api/card-data-version';
import { invalidateProfileCollectionsCache } from '../src/pages/api/profile/collections';
import { syncUserLikesWithServer, clearUserLikes } from '../src/lib/marketplaceInteractions';

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
  if (typeof (globalThis as any).CustomEvent === 'undefined') {
    (globalThis as any).CustomEvent = class CustomEvent {
      type: string;
      detail: any;
      constructor(type: string, params?: { detail: any }) {
        this.type = type;
        this.detail = params?.detail;
      }
    };
  }
});

describe('Performance optimizations: in-memory caching and deduplication', () => {
  beforeEach(() => {
    invalidateTradeOrdersCache();
    invalidateOrdersCache();
    invalidateCardDataVersionCache();
    invalidateProfileCollectionsCache();
    clearUserLikes();
    vi.restoreAllMocks();
  });

  it('exports invalidation helpers properly without crashing', () => {
    expect(typeof invalidateTradeOrdersCache).toBe('function');
    expect(typeof invalidateOrdersCache).toBe('function');
    expect(typeof invalidateCardDataVersionCache).toBe('function');
    expect(typeof invalidateProfileCollectionsCache).toBe('function');

    expect(() => invalidateTradeOrdersCache()).not.toThrow();
    expect(() => invalidateOrdersCache()).not.toThrow();
    expect(() => invalidateCardDataVersionCache()).not.toThrow();
    expect(() => invalidateProfileCollectionsCache('test-user-id')).not.toThrow();
    expect(() => invalidateProfileCollectionsCache()).not.toThrow();
  });

  it('deduplicates concurrent syncUserLikesWithServer calls in flight', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: {
          access_token: 'test-token',
        } as any,
      },
      error: null,
    });

    const fetchMock = vi.fn().mockImplementation(async () => {
      // Simulate network delay
      await new Promise(r => setTimeout(r, 20));
      return {
        ok: true,
        json: async () => ({
          success: true,
          liked_listing_ids: ['listing-1', 'listing-2'],
          liked_trade_ids: ['trade-1'],
        }),
      };
    });

    global.fetch = fetchMock;

    // Fire two calls concurrently
    const [res1, res2] = await Promise.all([
      syncUserLikesWithServer(true),
      syncUserLikesWithServer(),
    ]);

    // Should only have fetched once due to in-flight deduplication
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res1.likedListingIds).toEqual(['listing-1', 'listing-2']);
    expect(res2.likedListingIds).toEqual(['listing-1', 'listing-2']);
  });
});
