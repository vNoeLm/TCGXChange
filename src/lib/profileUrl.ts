/**
 * Utility functions for user profile URLs and human-friendly discriminator slugs.
 * Format: /profile/<slugified-name>-<short-id> (e.g. /profile/samuel-majdik-661484 or /profile/tcgxchange-d47ca4)
 */

export function slugifyDisplayName(name?: string | null): string {
  if (!name) return 'user';
  return name
    .normalize('NFD') // decompose accented letters (e.g. á -> a + combining mark)
    .replace(/[\u0300-\u036f]/g, '') // strip accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric to hyphens
    .replace(/^-+|-+$/g, '') || 'user'; // trim leading/trailing hyphens
}

export function getShortId(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 6).toLowerCase();
}

/**
 * Returns a human-friendly unique slug for a user, combining their display name and short ID.
 * Example: "tcgxchange-d47ca4" or "samuel-majdik-661484"
 */
export function getProfileSlug(profile: { id: string; display_name?: string | null }): string {
  const shortId = getShortId(profile.id);
  const slug = slugifyDisplayName(profile.display_name);
  return `${slug}-${shortId}`;
}

export type ProfileTab = 'sale' | 'collection' | 'decks' | 'reviews' | 'orders' | 'settings';
export const VALID_PROFILE_TABS: readonly ProfileTab[] = ['sale', 'collection', 'decks', 'reviews', 'orders', 'settings'] as const;

/**
 * Returns the canonical profile URL for a user, optionally targeting a specific tab.
 * Example: /profile/tcgxchange-d47ca4 or /profile/tcgxchange-d47ca4/collection
 */
export function getProfileUrl(
  profile: { id: string; display_name?: string | null },
  tab?: ProfileTab | null
): string {
  const slug = getProfileSlug(profile);
  if (tab && tab !== 'sale' && (VALID_PROFILE_TABS as readonly string[]).includes(tab)) {
    return `/profile/${slug}/${tab}`;
  }
  return `/profile/${slug}`;
}

/**
 * Parses pathname and search parameters to determine target user ID and active tab.
 * Handles:
 * - /profile -> { userId: null, tab: null }
 * - /profile/collection -> { userId: null, tab: 'collection' }
 * - /profile/tcgxchange-d47ca4 -> { userId: 'tcgxchange-d47ca4', tab: null }
 * - /profile/tcgxchange-d47ca4/collection -> { userId: 'tcgxchange-d47ca4', tab: 'collection' }
 * - /profile?id=xyz&tab=collection -> { userId: 'xyz', tab: 'collection' }
 */
export function parseProfileLocation(pathname = '', search = '', hash = ''): {
  userId: string | null;
  tab: ProfileTab | null;
} {
  const searchParams = new URLSearchParams(search);
  if (
    hash === '#order-history' ||
    searchParams.get('order') ||
    searchParams.get('order_number') ||
    searchParams.get('hold') ||
    searchParams.get('hold_request_id')
  ) {
    return {
      userId: searchParams.get('id') || null,
      tab: 'orders',
    };
  }

  // Path segments: e.g. /profile/tcgxchange-d47ca4/collection -> ['tcgxchange-d47ca4', 'collection']
  const cleanPath = pathname.replace(/^\/(?:profile|user)\/?/i, '').replace(/\/+$/, '');
  const segments = cleanPath ? cleanPath.split('/').map(s => decodeURIComponent(s).trim()) : [];

  let userId: string | null = null;
  let tab: ProfileTab | null = null;

  if (segments.length === 1) {
    const seg = segments[0].toLowerCase();
    if ((VALID_PROFILE_TABS as readonly string[]).includes(seg)) {
      tab = seg as ProfileTab;
    } else {
      userId = segments[0];
    }
  } else if (segments.length >= 2) {
    userId = segments[0];
    const seg1 = segments[1].toLowerCase();
    if ((VALID_PROFILE_TABS as readonly string[]).includes(seg1)) {
      tab = seg1 as ProfileTab;
    }
  }

  // Fallback to search params if not specified in path
  if (!userId) {
    const qId = searchParams.get('id');
    if (qId) userId = qId;
  }
  if (!tab) {
    const qTab = searchParams.get('tab')?.toLowerCase();
    if (qTab && (VALID_PROFILE_TABS as readonly string[]).includes(qTab)) {
      tab = qTab as ProfileTab;
    }
  }

  return { userId, tab };
}

/**
 * Parses a profile URL parameter into its components.
 */
export function parseProfileParam(param: string): {
  isUuid: boolean;
  shortId: string | null;
  nameQuery: string | null;
} {
  const trimmed = param.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
  if (isUuid) {
    return { isUuid: true, shortId: null, nameQuery: null };
  }

  // Check if ending with a 6-8 hex character short ID suffix: name-661484
  const match = trimmed.match(/^(.*?)-?([0-9a-f]{6,8})$/i);
  if (match) {
    const rawName = match[1]?.trim() || null;
    const shortId = match[2].toLowerCase();
    return {
      isUuid: false,
      shortId,
      nameQuery: rawName && rawName.length > 0 ? rawName : null,
    };
  }

  return {
    isUuid: false,
    shortId: null,
    nameQuery: trimmed,
  };
}
