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

/**
 * Returns the canonical profile URL for a user.
 */
export function getProfileUrl(profile: { id: string; display_name?: string | null }): string {
  return `/profile/${getProfileSlug(profile)}`;
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
