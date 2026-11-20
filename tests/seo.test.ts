import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  SITE_URL,
  buildBaseJsonLd,
  buildCardSeoMeta,
  buildDeckSeoMeta,
  buildProfileSeoMeta,
  buildRobotsContent,
  buildStoreProductSeoMeta,
  escapeXml,
  isNoIndexPath,
  normalizeCanonicalUrl,
  truncateMetaDescription,
} from '../src/lib/seo';

describe('seo helpers', () => {
  it('truncates long descriptions cleanly at word boundaries', () => {
    const text = 'Alpha '.repeat(40).trim();
    const out = truncateMetaDescription(text, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('...')).toBe(true);
    expect(truncateMetaDescription('')).toBe(DEFAULT_DESCRIPTION);
  });

  it('normalizes canonical URLs and preserves whitelisted entity params only', () => {
    expect(normalizeCanonicalUrl('/')).toBe(`${SITE_URL}/`);
    expect(normalizeCanonicalUrl('/decks/')).toBe(`${SITE_URL}/decks`);
    expect(normalizeCanonicalUrl('/decks', '?utm_source=fb&sort=newest')).toBe(`${SITE_URL}/decks`);
    expect(normalizeCanonicalUrl('/decks/view/', '?deck=abc-123&utm_source=x', ['deck'])).toBe(
      `${SITE_URL}/decks/view?deck=abc-123`
    );
  });

  it('classifies noindex paths correctly respecting public launch flags', () => {
    expect(isNoIndexPath('/admin/prices')).toBe(true);
    expect(isNoIndexPath('/login')).toBe(true);
    expect(isNoIndexPath('/messages')).toBe(true);
    expect(isNoIndexPath('/profile')).toBe(true);
    expect(isNoIndexPath('/profile/collection')).toBe(true);
    expect(isNoIndexPath('/profile/noel-123456')).toBe(false);
    expect(isNoIndexPath('/profile/noel-123456/orders')).toBe(true);
    expect(isNoIndexPath('/profile/noel-123456/settings')).toBe(true);
    expect(isNoIndexPath('/store', { storePublic: false })).toBe(true);
    expect(isNoIndexPath('/store', { storePublic: true })).toBe(false);
    expect(isNoIndexPath('/marketplace', { p2pPublic: false })).toBe(true);
    expect(isNoIndexPath('/marketplace', { p2pPublic: true })).toBe(false);
    expect(isNoIndexPath('/riftbound')).toBe(false);
    expect(isNoIndexPath('/decks')).toBe(false);
  });

  it('builds valid robots directives', () => {
    expect(buildRobotsContent(true)).toBe('noindex, nofollow');
    expect(buildRobotsContent(false)).toContain('index, follow');
    expect(buildRobotsContent(false)).toContain('max-image-preview:large');
  });

  it('builds site-wide base JSON-LD with SearchAction and Organization', () => {
    const ld = buildBaseJsonLd() as { '@graph': any[] };
    expect(Array.isArray(ld['@graph'])).toBe(true);
    expect(ld['@graph'].some((item) => item['@type'] === 'Organization')).toBe(true);
    const website = ld['@graph'].find((item) => item['@type'] === 'WebSite');
    expect(website?.potentialAction?.['@type']).toBe('SearchAction');
  });

  it('builds dynamic card SEO metadata with image and price offer', () => {
    const meta = buildCardSeoMeta({
      id: 'card-1',
      name: 'Jinx, Loose Cannon',
      game: 'riftbound',
      setName: 'Origins',
      cardNumber: 'OGN-001',
      rarity: 'Rare',
      cardType: 'Unit',
      imageUrl: 'https://cdn.example/ogn-001.webp',
      marketPriceEur: 12.5,
    });
    expect(meta.title).toBe('Jinx, Loose Cannon (OGN-001) | Origins | TCG XChange');
    expect(meta.canonical).toBe(`${SITE_URL}/card?id=card-1`);
    expect(meta.ogImage).toBe('https://cdn.example/ogn-001.webp');
    expect(meta.twitterCard).toBe('summary_large_image');
    expect(meta.description).toContain('€12.50');
    expect((meta.jsonLd[0] as any).offers.price).toBe('12.50');
  });

  it('builds dynamic deck SEO metadata with author and fallback image', () => {
    const meta = buildDeckSeoMeta({
      id: 'deck-42',
      name: 'Aggro Fury',
      game: 'riftbound',
      ownerName: 'Noel',
      legendName: 'Jinx',
    });
    expect(meta.title).toBe('Aggro Fury — Riftbound Deck | TCG XChange');
    expect(meta.canonical).toBe(`${SITE_URL}/decks/view?deck=deck-42`);
    expect(meta.ogImage).toBe(DEFAULT_OG_IMAGE);
    expect(meta.twitterCard).toBe('summary');
    expect(meta.description).toContain('Aggro Fury');
    expect(meta.description).toContain('Noel');
  });

  it('marks private profile tabs as noindex while keeping collection and decks indexable', () => {
    const publicMeta = buildProfileSeoMeta({ id: '12345678-0000-0000-0000-000000000000', display_name: 'Noel' }, 'decks');
    expect(publicMeta.noindex).toBe(false);
    expect(publicMeta.canonical).toContain('/profile/noel-123456/decks');

    const privateMeta = buildProfileSeoMeta({ id: '12345678-0000-0000-0000-000000000000', display_name: 'Noel' }, 'orders');
    expect(privateMeta.noindex).toBe(true);
  });

  it('builds store product JSON-LD with availability and HUF price', () => {
    const meta = buildStoreProductSeoMeta({
      slug: 'origins-booster-box',
      name: 'Origins Booster Box',
      priceHuf: 49990,
      stockQuantity: 4,
      game: 'riftbound',
    });
    expect(meta.canonical).toBe(`${SITE_URL}/store/product?slug=origins-booster-box`);
    expect((meta.jsonLd[0] as any).offers.availability).toBe('https://schema.org/InStock');
    expect((meta.jsonLd[0] as any).offers.price).toBe(49990);
  });

  it('escapes XML special characters safely', () => {
    expect(escapeXml('https://tcgxchange.net/card?a=1&b="x"')).toBe(
      'https://tcgxchange.net/card?a=1&amp;b=&quot;x&quot;'
    );
  });
});
