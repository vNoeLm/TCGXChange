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

export const BAN_SUMMARY_HU =
  'A fiókod fel van függesztve. A piactér, az eladói felület és az üzenetek nem érhetők el, de a katalógust és a hivatalos áruházat továbbra is használhatod.';

export const BAN_DETAIL =
  'A suspension only removes access to the community marketplace, the seller hub and messages. Browsing the card catalog, tracking your collection, building decks and ordering from the official store all keep working. If you believe this is a mistake, contact support@tcgxchange.net.';

export const BAN_DETAIL_HU =
  'A felfüggesztés kizárólag a közösségi piactérhez, az eladói felülethez és az üzenetekhez való hozzáférést korlátozza. A kártyakatalógus böngészése, a gyűjtemény követése, a pakliépítés és a hivatalos áruházból való rendelés továbbra is működik. Ha úgy gondolod, hogy ez tévedés, írj a support@tcgxchange.net címre.';

export function getBanSummary(lang: string = 'en'): string {
  return lang === 'hu' ? BAN_SUMMARY_HU : BAN_SUMMARY;
}

export function getBanDetail(lang: string = 'en'): string {
  return lang === 'hu' ? BAN_DETAIL_HU : BAN_DETAIL;
}

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
