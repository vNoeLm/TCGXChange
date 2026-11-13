import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { supabase } from '../src/lib/supabase';
import { invalidateOrdersCache } from '../src/pages/api/orders';
import { invalidateCardDataVersionCache } from '../src/pages/api/card-data-version';
import { invalidateProfileCollectionsCache } from '../src/pages/api/profile/collections';

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
    invalidateOrdersCache();
    invalidateCardDataVersionCache();
    invalidateProfileCollectionsCache();
    vi.restoreAllMocks();
  });

  it('exports invalidation helpers properly without crashing', () => {
    expect(typeof invalidateOrdersCache).toBe('function');
    expect(typeof invalidateCardDataVersionCache).toBe('function');
    expect(typeof invalidateProfileCollectionsCache).toBe('function');

    expect(() => invalidateOrdersCache()).not.toThrow();
    expect(() => invalidateCardDataVersionCache()).not.toThrow();
    expect(() => invalidateProfileCollectionsCache('test-user-id')).not.toThrow();
    expect(() => invalidateProfileCollectionsCache()).not.toThrow();
  });

});
