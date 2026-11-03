import { describe, it, expect } from 'vitest';

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
    if (params.hasCollections) {
      return 'collection';
    }
    if (params.hasListings) {
      return 'sale';
    }
    return 'collection';
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

    // Default when user has collections
    expect(resolveInitialTab({ hasCollections: true })).toBe('collection');

    // Default when no collections but has listings
    expect(resolveInitialTab({ hasCollections: false, hasListings: true })).toBe('sale');
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
});
