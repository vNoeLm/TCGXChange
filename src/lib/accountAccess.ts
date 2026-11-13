/**
 * What a suspended account may still use.
 *
 * A ban removes access to messaging and community actions while leaving the card catalog, decks,
 * collections and official store available.
 */
export const RESTRICTED_PATHS = ['/messages'] as const;

export const BAN_SUMMARY =
  'Your account is suspended. Messages and community actions are unavailable, but you can still use the catalog and the official store.';

export const BAN_SUMMARY_HU =
  'A fiókod fel van függesztve. Az üzenetek és a közösségi funkciók nem érhetők el, de a katalógust és a hivatalos áruházat továbbra is használhatod.';

export const BAN_DETAIL =
  'A suspension removes access to messages and community reporting. Browsing the card catalog, tracking your collection, building decks and ordering from the official store keep working. If you believe this is a mistake, contact support@tcgxchange.net.';

export const BAN_DETAIL_HU =
  'A felfüggesztés az üzenetekhez és a közösségi jelentésekhez való hozzáférést korlátozza. A kártyakatalógus böngészése, a gyűjtőmappa kezelése, a pakliépítés és a hivatalos áruházból való rendelés továbbra is működik. Ha úgy gondolod, hogy ez tévedés, írj a support@tcgxchange.net címre.';

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
  return /^\/api\/(messages|reports)(\/|$)/.test(clean);
}
