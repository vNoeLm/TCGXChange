import { GAMES } from './constants';
import { P2P_PUBLIC_LAUNCH } from './p2pConstants';
import { getProfileUrl, type ProfileTab } from './profileUrl';
import { STORE_PUBLIC_LAUNCH } from './storeConstants';

export const SITE_URL = 'https://tcgxchange.net';
export const SITE_NAME = 'TCG XChange';
export const SITE_ALT_NAME = 'TCG XChange.net';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/brand/oauth-logo.png`;
export const DEFAULT_OG_IMAGE_ALT = 'TCG XChange logo';
export const DEFAULT_DESCRIPTION =
  'Browse TCG card catalogs and live Cardmarket prices, track your collection, build decks, and organize your binder on TCG XChange.';

export function getGameDisplayName(gameId?: string | null): string {
  if (!gameId) return 'TCG';
  const normalized = gameId.trim().toLowerCase();
  const match = GAMES.find((g) => g.id === normalized);
  if (match) return match.name;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** Collapse whitespace and trim a meta description cleanly at word boundaries. */
export function truncateMetaDescription(raw?: string | null, maxLen = 158): string {
  const clean = (raw || '').replace(/\s+/g, ' ').trim();
  if (!clean) return DEFAULT_DESCRIPTION;
  if (clean.length <= maxLen) return clean;
  const sliced = clean.slice(0, maxLen - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const trimmed = lastSpace > Math.floor(maxLen * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return `${trimmed.replace(/[.,;:!?-]+$/, '')}...`;
}

/**
 * Normalize canonical URLs to https://tcgxchange.net without trailing slashes (except `/`),
 * optionally preserving only whitelisted entity-identifying query params (e.g. `deck`, `id`, `slug`).
 */
export function normalizeCanonicalUrl(
  pathname: string,
  search = '',
  allowedQueryKeys: readonly string[] = []
): string {
  const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '') || '/';
  if (allowedQueryKeys.length > 0 && search) {
    const incoming = new URLSearchParams(search);
    const kept = new URLSearchParams();
    for (const key of allowedQueryKeys) {
      const val = incoming.get(key);
      if (val && val.trim()) {
        kept.set(key, val.trim());
      }
    }
    const qs = kept.toString();
    if (qs) {
      return `${SITE_URL}${normalizedPath}?${qs}`;
    }
  }
  return `${SITE_URL}${normalizedPath}`;
}

export function buildRobotsContent(noindex?: boolean): string {
  return noindex
    ? 'noindex, nofollow'
    : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
}

export function isNoIndexPath(
  pathname: string,
  opts: { storePublic?: boolean; p2pPublic?: boolean } = {}
): boolean {
  const clean = pathname === '/' ? '/' : pathname.replace(/\/+$/, '').toLowerCase() || '/';
  const storePublic = opts.storePublic ?? STORE_PUBLIC_LAUNCH;
  const p2pPublic = opts.p2pPublic ?? P2P_PUBLIC_LAUNCH;

  if (
    clean === '/api' ||
    clean.startsWith('/api/') ||
    clean === '/admin' ||
    clean.startsWith('/admin/') ||
    clean === '/login' ||
    clean === '/register' ||
    clean === '/reset-password' ||
    clean === '/banned' ||
    clean === '/account-deleted' ||
    clean === '/messages' ||
    clean === '/profile' ||
    clean === '/user' ||
    clean.startsWith('/user/') ||
    clean === '/404'
  ) {
    return true;
  }

  // Own-profile shortcut tabs (/profile/collection, /profile/orders, etc.) & private sub-tabs
  if (clean.startsWith('/profile/')) {
    const segs = clean.slice('/profile/'.length).split('/').filter(Boolean);
    if (segs.length === 1 && ['collection', 'sale', 'wishlists', 'decks', 'reviews', 'orders', 'settings'].includes(segs[0])) {
      return true;
    }
    if (segs.length >= 2 && ['orders', 'settings'].includes(segs[1])) {
      return true;
    }
  }

  if (!storePublic && (clean === '/store' || clean.startsWith('/store/') || clean === '/support')) {
    return true;
  }

  if (!p2pPublic && (clean === '/marketplace' || clean.startsWith('/marketplace/'))) {
    return true;
  }

  return false;
}

export function buildBaseJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        logo: {
          '@type': 'ImageObject',
          url: DEFAULT_OG_IMAGE,
        },
        email: 'support@tcgxchange.net',
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: SITE_NAME,
        alternateName: SITE_ALT_NAME,
        url: `${SITE_URL}/`,
        publisher: {
          '@id': `${SITE_URL}/#organization`,
        },
        inLanguage: ['en', 'hu'],
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  };
}

export function buildBreadcrumbJsonLd(
  items: ReadonlyArray<{ name: string; url: string }>
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

export interface CardSeoInput {
  id: string;
  name: string;
  game?: string | null;
  setName?: string | null;
  setCode?: string | null;
  cardNumber?: string | null;
  rarity?: string | null;
  cardType?: string | null;
  imageUrl?: string | null;
  marketPriceEur?: number | null;
}

export function buildCardSeoMeta(card: CardSeoInput) {
  const gameName = getGameDisplayName(card.game);
  const setLabel = card.setName || card.setCode || '';
  const codeSuffix = card.cardNumber ? ` (${card.cardNumber})` : '';
  const titleParts = [card.name + codeSuffix, setLabel || gameName, SITE_NAME].filter(Boolean);
  const title = titleParts.join(' | ');

  const details = [card.rarity, card.cardType, setLabel ? `from ${setLabel}` : null]
    .filter(Boolean)
    .join(' ');
  const priceSnippet =
    typeof card.marketPriceEur === 'number' && card.marketPriceEur > 0
      ? ` Market trend: €${card.marketPriceEur.toFixed(2)}.`
      : '';

  const description = truncateMetaDescription(
    `${card.name}${codeSuffix} — ${details ? `${details} in ${gameName}` : `${gameName} card`}.${priceSnippet} Check live Cardmarket prices, collection tracking, and deck legality on TCG XChange.`
  );

  const canonical = `${SITE_URL}/card?id=${encodeURIComponent(card.id)}`;
  const ogImage = card.imageUrl || DEFAULT_OG_IMAGE;
  const ogImageAlt = `${card.name} — ${gameName} card`;

  const gameCatalogPath = card.game ? `/${encodeURIComponent(card.game)}` : '/';
  const productLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: card.name,
    sku: card.cardNumber || card.id,
    category: `${gameName} Trading Card`,
    brand: {
      '@type': 'Brand',
      name: gameName,
    },
    image: ogImage,
    url: canonical,
    description,
  };

  if (typeof card.marketPriceEur === 'number' && card.marketPriceEur > 0) {
    productLd.offers = {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      price: card.marketPriceEur.toFixed(2),
      url: canonical,
    };
  }

  const breadcrumbs = buildBreadcrumbJsonLd([
    { name: 'Catalog', url: '/' },
    { name: gameName, url: gameCatalogPath },
    { name: card.name, url: `/card?id=${encodeURIComponent(card.id)}` },
  ]);

  return {
    title,
    description,
    canonical,
    ogImage,
    ogImageAlt,
    twitterCard: card.imageUrl ? ('summary_large_image' as const) : ('summary' as const),
    jsonLd: [productLd, breadcrumbs],
  };
}

export interface DeckSeoInput {
  id: string;
  name: string;
  game?: string | null;
  ownerName?: string | null;
  legendName?: string | null;
  championName?: string | null;
  imageUrl?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export function buildDeckSeoMeta(deck: DeckSeoInput) {
  const gameName = getGameDisplayName(deck.game);
  const title = `${deck.name} — ${gameName} Deck | ${SITE_NAME}`;
  const creatorPart = deck.ownerName ? ` by ${deck.ownerName}` : '';
  const leadCards = [deck.legendName, deck.championName].filter(Boolean).join(' / ');
  const leadPart = leadCards ? ` Featuring ${leadCards}.` : '';

  const description = truncateMetaDescription(
    `${deck.name} is a community ${gameName} deck${creatorPart} on TCG XChange.${leadPart} Inspect the full card list, domain breakdown, and estimated market value.`
  );

  const canonical = `${SITE_URL}/decks/view?deck=${encodeURIComponent(deck.id)}`;
  const ogImage = deck.imageUrl || DEFAULT_OG_IMAGE;
  const ogImageAlt = `${deck.name} — ${gameName} deck`;

  const deckLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: deck.name,
    description,
    url: canonical,
    image: ogImage,
    about: `${gameName} Deck`,
    ...(deck.ownerName
      ? {
          author: {
            '@type': 'Person',
            name: deck.ownerName,
          },
        }
      : {}),
    ...(deck.createdAt ? { datePublished: deck.createdAt } : {}),
    ...(deck.updatedAt ? { dateModified: deck.updatedAt } : {}),
  };

  const breadcrumbs = buildBreadcrumbJsonLd([
    { name: 'Catalog', url: '/' },
    { name: 'Deck Browser', url: '/decks' },
    { name: deck.name, url: `/decks/view?deck=${encodeURIComponent(deck.id)}` },
  ]);

  return {
    title,
    description,
    canonical,
    ogImage,
    ogImageAlt,
    twitterCard: deck.imageUrl ? ('summary_large_image' as const) : ('summary' as const),
    jsonLd: [deckLd, breadcrumbs],
  };
}

export function buildProfileSeoMeta(
  profile: { id: string; display_name?: string | null; avatar_url?: string | null },
  tab?: ProfileTab
) {
  const displayName = profile.display_name?.trim() || 'Collector';
  const tabLabels: Record<ProfileTab, string> = {
    collection: 'Collection',
    sale: 'Cards For Sale',
    wishlists: 'Wishlists',
    decks: 'Decks',
    reviews: 'Reviews',
    orders: 'Orders',
    settings: 'Settings',
  };
  const tabLabel = tab && tab !== 'collection' ? tabLabels[tab] : null;
  const noindex = tab === 'orders' || tab === 'settings';

  const title = tabLabel
    ? `${displayName} — ${tabLabel} | ${SITE_NAME}`
    : `${displayName} | Collector Profile | ${SITE_NAME}`;
  const description = truncateMetaDescription(
    tab === 'decks'
      ? `Browse public TCG decks built by ${displayName} on TCG XChange.`
      : tab === 'sale'
      ? `Browse TCG cards currently listed for sale by ${displayName} on TCG XChange.`
      : tab === 'wishlists'
      ? `Browse public TCG wishlists from ${displayName} on TCG XChange and offer cards you have.`
      : tab === 'reviews'
      ? `View buyer and seller trade reviews for ${displayName} on TCG XChange.`
      : `View ${displayName}'s public TCG collection, binders, and shared decks on TCG XChange.`
  );

  const pathUrl = getProfileUrl(profile, tab);
  const canonical = `${SITE_URL}${pathUrl}`;
  const ogImage = profile.avatar_url || DEFAULT_OG_IMAGE;

  const profileLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name: displayName,
      url: canonical,
      ...(profile.avatar_url ? { image: profile.avatar_url } : {}),
    },
  };

  return {
    title,
    description,
    canonical,
    ogImage,
    ogImageAlt: `${displayName} on ${SITE_NAME}`,
    ogType: 'profile' as const,
    noindex,
    jsonLd: [profileLd],
  };
}

export interface StoreProductSeoInput {
  slug: string;
  name: string;
  description?: string | null;
  priceHuf?: number | null;
  stockQuantity?: number | null;
  imageUrl?: string | null;
  category?: string | null;
  game?: string | null;
}

export function buildStoreProductSeoMeta(product: StoreProductSeoInput) {
  const gameLabel = product.game && product.game !== 'universal' ? getGameDisplayName(product.game) : null;
  const title = `${product.name} | Store | ${SITE_NAME}`;
  const priceText =
    typeof product.priceHuf === 'number' && product.priceHuf > 0
      ? ` ${Math.round(product.priceHuf)} Ft.`
      : '';
  const stockText =
    typeof product.stockQuantity === 'number'
      ? product.stockQuantity > 0
        ? ' In stock.'
        : ' Out of stock.'
      : '';
  const description = truncateMetaDescription(
    product.description?.trim() ||
      `Buy ${product.name}${gameLabel ? ` (${gameLabel})` : ''} at the official TCG XChange Store.${priceText}${stockText}`
  );
  const canonical = `${SITE_URL}/store/product?slug=${encodeURIComponent(product.slug)}`;
  const ogImage = product.imageUrl || DEFAULT_OG_IMAGE;

  const productLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    image: ogImage,
    url: canonical,
    ...(typeof product.priceHuf === 'number' && product.priceHuf > 0
      ? {
          offers: {
            '@type': 'Offer',
            priceCurrency: 'HUF',
            price: Math.round(product.priceHuf),
            availability:
              (product.stockQuantity ?? 0) > 0
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            url: canonical,
          },
        }
      : {}),
  };

  const breadcrumbs = buildBreadcrumbJsonLd([
    { name: 'Store', url: '/store' },
    { name: product.name, url: `/store/product?slug=${encodeURIComponent(product.slug)}` },
  ]);

  return {
    title,
    description,
    canonical,
    ogImage,
    ogImageAlt: product.name,
    ogType: 'product' as const,
    twitterCard: product.imageUrl ? ('summary_large_image' as const) : ('summary' as const),
    jsonLd: [productLd, breadcrumbs],
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
