/**
 * What a suspended account may still use.
 *
 * A ban is meant to take away the community parts of the site - the marketplace, the seller hub
 * and messages - while leaving the catalog and the official store alone. The pages, the server
 * APIs and the database policies all read the same list so one of them cannot quietly disagree.
 */
export const RESTRICTED_PATHS = ['/marketplace', '/seller', '/messages'] as const;

export const BAN_SUMMARY =
  'Your account is suspended. The marketplace, seller hub and messages are unavailable, but you can still use the catalog and the official store.';

export const BAN_DETAIL =
  'A suspension only removes access to the community marketplace, the seller hub and messages. Browsing the card catalog, tracking your collection, building decks and ordering from the official store all keep working. If you believe this is a mistake, contact support@tcgxchange.net.';

/** True for the pages a suspended account may not open. */
export function isRestrictedPath(pathname: string): boolean {
  const clean = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  return RESTRICTED_PATHS.some((path) => clean === path || clean.startsWith(`${path}/`));
}

/** True when the API route belongs to the community features a suspension blocks. */
export function isRestrictedApiPath(pathname: string): boolean {
  const clean = pathname.split('?')[0] || '';
  return /^\/api\/(marketplace|reviews|reports)(\/|$)/.test(clean);
}
