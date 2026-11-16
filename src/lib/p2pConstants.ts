/**
 * Feature flag & shared config for the Facebook-style P2P Marketplace & Hold system.
 * While P2P_PUBLIC_LAUNCH is false, only admins see /marketplace and P2P /messages so
 * prototypes can be tested safely in production before opening publicly.
 */
export const P2P_PUBLIC_LAUNCH = false;

export function isP2PEnabledFor(isAdmin?: boolean | null): boolean {
  return P2P_PUBLIC_LAUNCH || Boolean(isAdmin);
}

export type MarketplaceViewMode = 'by_card' | 'all_listings' | 'photo_posts' | 'bulk';
export type MarketplacePostType = 'photo_post' | 'bulk';

export const P2P_MAX_PENDING_HOLDS_PER_BUYER = 8;
export const P2P_PENDING_HOLD_HOURS = 48;
export const P2P_MAX_POST_IMAGES = 6;
export const P2P_MAX_POST_TAGS = 40;
