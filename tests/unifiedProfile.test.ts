import { describe, it, expect } from 'vitest';
import {
  parseImageAdjustments,
  formatImageAdjustments,
  resolveAvatarImageStyle,
  parseBannerValue,
  formatBannerValue,
} from '../src/components/profile/AvatarBannerModal';

describe('Unified Profile Logic', () => {
  function computeIsMe(viewerId: string | null, urlId: string | null): boolean {
    if (!urlId) return Boolean(viewerId);
    return Boolean(viewerId && viewerId === urlId);
  }

  function resolveInitialTab(params: {
    hash?: string;
    orderParam?: string | null;
    holdParam?: string | null;
    tabParam?: string | null;
    hasCollections?: boolean;
    hasListings?: boolean;
  }): string {
    if (params.hash === '#order-history' || params.orderParam || params.holdParam) {
      return 'orders';
    }
    if (params.tabParam && ['collection', 'sale', 'decks', 'reviews', 'orders', 'settings'].includes(params.tabParam)) {
      return params.tabParam;
    }
    // Cards for sale is the primary first profile tab
    return 'sale';
  }

  function getAvailableTabs(isMe: boolean): string[] {
    const commonTabs = ['collection', 'sale', 'decks', 'reviews'];
    if (isMe) {
      return [...commonTabs, 'orders', 'settings'];
    }
    return commonTabs;
  }

  it('determines isMe correctly for owner and visiting user', () => {
    // Owner visiting /profile with no id query param
    expect(computeIsMe('user-123', null)).toBe(true);

    // Owner visiting /profile?id=user-123
    expect(computeIsMe('user-123', 'user-123')).toBe(true);

    // User A visiting User B's profile /profile?id=user-456
    expect(computeIsMe('user-123', 'user-456')).toBe(false);

    // Guest visiting /profile with no id
    expect(computeIsMe(null, null)).toBe(false);

    // Guest visiting /profile?id=user-123
    expect(computeIsMe(null, 'user-123')).toBe(false);
  });

  it('resolves initial tab based on deep links and url query', () => {
    // Deep link from order notification
    expect(resolveInitialTab({ orderParam: 'ORD-9999' })).toBe('orders');

    // Deep link from buyer hold
    expect(resolveInitialTab({ holdParam: 'hold-123' })).toBe('orders');

    // Hash anchor to #order-history
    expect(resolveInitialTab({ hash: '#order-history' })).toBe('orders');

    // Explicit tab query param
    expect(resolveInitialTab({ tabParam: 'decks' })).toBe('decks');
    expect(resolveInitialTab({ tabParam: 'sale' })).toBe('sale');
    expect(resolveInitialTab({ tabParam: 'settings' })).toBe('settings');

    // Default is 'sale' (Cards for sale, the first tab on profile)
    expect(resolveInitialTab({ hasCollections: true })).toBe('sale');
    expect(resolveInitialTab({ hasCollections: false, hasListings: true })).toBe('sale');
    expect(resolveInitialTab({})).toBe('sale');
  });

  it('restricts orders and settings tabs to profile owner only', () => {
    const ownerTabs = getAvailableTabs(true);
    expect(ownerTabs).toContain('orders');
    expect(ownerTabs).toContain('settings');
    expect(ownerTabs).toContain('collection');
    expect(ownerTabs).toContain('sale');
    expect(ownerTabs).toContain('decks');
    expect(ownerTabs).toContain('reviews');

    const publicTabs = getAvailableTabs(false);
    expect(publicTabs).not.toContain('orders');
    expect(publicTabs).not.toContain('settings');
    expect(publicTabs).toEqual(['collection', 'sale', 'decks', 'reviews']);
  });

  it('generates canonical profile URL for QR code and sharing', () => {
    const userId = 'usr_abc123';
    const origin = 'https://tcgxchange.net';
    const profileUrl = `${origin}/profile?id=${encodeURIComponent(userId)}`;
    expect(profileUrl).toBe('https://tcgxchange.net/profile?id=usr_abc123');
  });

  it('parses and formats avatar adjustments with position and zoom hash', () => {
    const clean = 'https://tcgxchange.net/cards/jinx.png';
    const formatted = formatImageAdjustments(clean, { x: 50, y: 20, zoom: 180 });
    expect(formatted).toBe('https://tcgxchange.net/cards/jinx.png#y=20&z=180');

    const parsed = parseImageAdjustments(formatted);
    expect(parsed.url).toBe(clean);
    expect(parsed.y).toBe(20);
    expect(parsed.zoom).toBe(180);
    expect(parsed.x).toBe(50);

    const style = resolveAvatarImageStyle(formatted);
    expect(style.objectPosition).toBe('50% 20%');
    expect(style.transform).toBe('scale(1.8)');

    // Banner composite value
    const bannerFormatted = formatBannerValue(clean, 40, { x: 50, y: 15, zoom: 120 });
    expect(bannerFormatted).toBe('https://tcgxchange.net/cards/jinx.png#y=15&z=120&blur=40');

    const bannerParsed = parseBannerValue(bannerFormatted);
    expect(bannerParsed.url).toBe(clean);
    expect(bannerParsed.blur).toBe(40);
    expect(bannerParsed.y).toBe(15);
    expect(bannerParsed.zoom).toBe(120);
  });
});
