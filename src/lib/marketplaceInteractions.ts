import { supabase } from './supabase';
import { getCurrentUser } from './auth';

export const EVENTS = {
  LISTING_LIKED: 'tcg-listing-liked',
  LISTING_SAVED: 'tcg-listing-saved',
  TRADE_LIKED: 'tcg-trade-liked',
  TRADE_SAVED: 'tcg-trade-saved',
} as const;

const STORAGE_KEYS = {
  LIKED_LISTINGS: 'tcg_liked_listings',
  SAVED_LISTINGS: 'tcg_saved_listings',
  LIKED_TRADES: 'tcg_liked_trades',
  SAVED_TRADES: 'tcg_saved_trades',
  LIKE_COUNTS: 'tcg_like_counts',
};

// ─── Helpers ──────────────────────────────────────────────────────────

function getStoredSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveStoredSet(key: string, set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore storage quota errors
  }
}

export function getStoredLikeCounts(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LIKE_COUNTS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveStoredLikeCount(id: string, count: number): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    const map = getStoredLikeCounts();
    map[id] = count;
    localStorage.setItem(STORAGE_KEYS.LIKE_COUNTS, JSON.stringify(map));
  } catch {}
}

export function getEffectiveLikeCount(id: string, type: 'listing' | 'trade' = 'listing', fallbackCount: number = 0): number {
  if (!id) return Math.max(0, fallbackCount);
  const counts = getStoredLikeCounts();
  const stored = counts[id];
  // Authoritative server count takes priority if higher; stored count preserves optimistic updates
  const base = Math.max(fallbackCount || 0, typeof stored === 'number' ? stored : 0);
  const isLiked = type === 'trade' ? isTradeLiked(id) : isListingLiked(id);
  if (isLiked && base <= 0) return 1;
  return Math.max(0, base);
}

// ─── Listing Likes & Unified Saves ────────────────────────────────────

export function getLikedListingIds(): Set<string> {
  const liked = getStoredSet(STORAGE_KEYS.LIKED_LISTINGS);
  const saved = getStoredSet(STORAGE_KEYS.SAVED_LISTINGS);
  return new Set([...liked, ...saved]);
}

export function isListingLiked(listingId: string): boolean {
  if (!listingId) return false;
  return getLikedListingIds().has(listingId);
}

// Liking automatically saves; getSavedListingIds is synonymous with getLikedListingIds
export function getSavedListingIds(): Set<string> {
  return getLikedListingIds();
}

export function isListingSaved(listingId: string): boolean {
  return isListingLiked(listingId);
}

export async function toggleListingLike(listingId: string, currentCount: number = 0): Promise<{ liked: boolean; count: number }> {
  if (!listingId) return { liked: false, count: currentCount };

  const likedSet = getStoredSet(STORAGE_KEYS.LIKED_LISTINGS);
  const willBeLiked = !likedSet.has(listingId);

  if (willBeLiked) {
    likedSet.add(listingId);
  } else {
    likedSet.delete(listingId);
  }
  saveStoredSet(STORAGE_KEYS.LIKED_LISTINGS, likedSet);
  saveStoredSet(STORAGE_KEYS.SAVED_LISTINGS, likedSet);

  const newCount = Math.max(0, currentCount + (willBeLiked ? 1 : -1));
  saveStoredLikeCount(listingId, newCount);

  // Notify UI subscribers for both like and save events
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(EVENTS.LISTING_LIKED, {
        detail: { listingId, liked: willBeLiked, count: newCount },
      })
    );
    window.dispatchEvent(
      new CustomEvent(EVENTS.LISTING_SAVED, {
        detail: { listingId, saved: willBeLiked },
      })
    );
  }

  // Sync to database via API in background
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch('/api/marketplace/likes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: listingId, type: 'listing', action: willBeLiked ? 'like' : 'unlike' }),
    })
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          if (json.success && typeof json.likes_count === 'number') {
            saveStoredLikeCount(listingId, json.likes_count);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent(EVENTS.LISTING_LIKED, {
                  detail: { listingId, liked: json.liked ?? willBeLiked, count: json.likes_count },
                })
              );
            }
          }
        }
      })
      .catch(() => {});

    // Also sync to legacy saves table for safety
    fetch('/api/marketplace/saves', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: listingId, type: 'listing', action: willBeLiked ? 'save' : 'unsave' }),
    }).catch(() => {});
  } catch {
    // Local fallback
  }

  return { liked: willBeLiked, count: newCount };
}

// Legacy toggleListingSave alias delegating to toggleListingLike
export async function toggleListingSave(listingId: string): Promise<{ saved: boolean }> {
  const currentCount = getStoredLikeCounts()[listingId] || 0;
  const res = await toggleListingLike(listingId, currentCount);
  return { saved: res.liked };
}

// ─── Trade Likes & Unified Saves ──────────────────────────────────────

export function getLikedTradeIds(): Set<string> {
  const liked = getStoredSet(STORAGE_KEYS.LIKED_TRADES);
  const saved = getStoredSet(STORAGE_KEYS.SAVED_TRADES);
  return new Set([...liked, ...saved]);
}

export function isTradeLiked(tradeId: string): boolean {
  if (!tradeId) return false;
  return getLikedTradeIds().has(tradeId);
}

export function getSavedTradeIds(): Set<string> {
  return getLikedTradeIds();
}

export function isTradeSaved(tradeId: string): boolean {
  return isTradeLiked(tradeId);
}

export async function toggleTradeLike(tradeId: string, currentCount: number = 0): Promise<{ liked: boolean; count: number }> {
  if (!tradeId) return { liked: false, count: currentCount };

  const likedSet = getStoredSet(STORAGE_KEYS.LIKED_TRADES);
  const willBeLiked = !likedSet.has(tradeId);

  if (willBeLiked) {
    likedSet.add(tradeId);
  } else {
    likedSet.delete(tradeId);
  }
  saveStoredSet(STORAGE_KEYS.LIKED_TRADES, likedSet);
  saveStoredSet(STORAGE_KEYS.SAVED_TRADES, likedSet);

  const newCount = Math.max(0, currentCount + (willBeLiked ? 1 : -1));
  saveStoredLikeCount(tradeId, newCount);

  // Notify UI subscribers
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(EVENTS.TRADE_LIKED, {
        detail: { tradeId, liked: willBeLiked, count: newCount },
      })
    );
    window.dispatchEvent(
      new CustomEvent(EVENTS.TRADE_SAVED, {
        detail: { tradeId, saved: willBeLiked },
      })
    );
  }

  // Sync to database via API in background
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch('/api/marketplace/likes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: tradeId, type: 'trade', action: willBeLiked ? 'like' : 'unlike' }),
    })
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          if (json.success && typeof json.likes_count === 'number') {
            saveStoredLikeCount(tradeId, json.likes_count);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent(EVENTS.TRADE_LIKED, {
                  detail: { tradeId, liked: json.liked ?? willBeLiked, count: json.likes_count },
                })
              );
            }
          }
        }
      })
      .catch(() => {});

    // Also sync to legacy saves table
    fetch('/api/marketplace/saves', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: tradeId, type: 'trade', action: willBeLiked ? 'save' : 'unsave' }),
    }).catch(() => {});
  } catch {
    // Local fallback
  }

  return { liked: willBeLiked, count: newCount };
}

export async function toggleTradeSave(tradeId: string): Promise<{ saved: boolean }> {
  const currentCount = getStoredLikeCounts()[tradeId] || 0;
  const res = await toggleTradeLike(tradeId, currentCount);
  return { saved: res.liked };
}

// ─── Initial DB Sync for User Likes ───────────────────────────────────

export async function syncUserLikesWithServer(): Promise<{ likedListingIds: string[]; likedTradeIds: string[] }> {
  if (typeof window === 'undefined') return { likedListingIds: [], likedTradeIds: [] };

  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) {
      return { likedListingIds: [], likedTradeIds: [] };
    }

    const res = await fetch('/api/marketplace/likes', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!res.ok) return { likedListingIds: [], likedTradeIds: [] };

    const json = await res.json();
    if (json.success && Array.isArray(json.liked_listing_ids) && Array.isArray(json.liked_trade_ids)) {
      // Overwrite local sets with this user's authoritative likes from DB
      const freshListings = new Set<string>(json.liked_listing_ids);
      const freshTrades = new Set<string>(json.liked_trade_ids);

      saveStoredSet(STORAGE_KEYS.LIKED_LISTINGS, freshListings);
      saveStoredSet(STORAGE_KEYS.SAVED_LISTINGS, freshListings);
      saveStoredSet(STORAGE_KEYS.LIKED_TRADES, freshTrades);
      saveStoredSet(STORAGE_KEYS.SAVED_TRADES, freshTrades);

      window.dispatchEvent(new CustomEvent(EVENTS.LISTING_LIKED, { detail: { sync: true } }));
      window.dispatchEvent(new CustomEvent(EVENTS.TRADE_LIKED, { detail: { sync: true } }));
      window.dispatchEvent(new CustomEvent(EVENTS.LISTING_SAVED, { detail: { sync: true } }));
      window.dispatchEvent(new CustomEvent(EVENTS.TRADE_SAVED, { detail: { sync: true } }));

      return {
        likedListingIds: json.liked_listing_ids,
        likedTradeIds: json.liked_trade_ids,
      };
    }
  } catch (err) {
    // Fail silently
  }

  return { likedListingIds: [], likedTradeIds: [] };
}

export function clearUserLikes(): void {
  saveStoredSet(STORAGE_KEYS.LIKED_LISTINGS, new Set());
  saveStoredSet(STORAGE_KEYS.SAVED_LISTINGS, new Set());
  saveStoredSet(STORAGE_KEYS.LIKED_TRADES, new Set());
  saveStoredSet(STORAGE_KEYS.SAVED_TRADES, new Set());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTS.LISTING_LIKED, { detail: { sync: true } }));
    window.dispatchEvent(new CustomEvent(EVENTS.TRADE_LIKED, { detail: { sync: true } }));
  }
}
