import type { APIRoute } from 'astro';
import { bannedResponse, getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { canCallerModerateGame } from '../../../lib/cardUpdateServer';
import {
  CARDMARKET_GAME_IDS,
  PRICE_GUIDE_URLS_BY_GAME,
  PRODUCT_LIST_URLS_BY_GAME,
  type CardmarketCatalogProduct,
  type GuideRow,
} from '../../../lib/cardmarketPrices';

export const prerender = false;

interface CachedFeed {
  fetchedAt: number;
  products: CardmarketCatalogProduct[];
  guideById: Map<number, GuideRow>;
}

const FEED_CACHE_TTL_MS = 10 * 60 * 1000;
const feedCache = new Map<string, CachedFeed>();

async function loadCardmarketFeed(game: string): Promise<CachedFeed> {
  const cached = feedCache.get(game);
  if (cached && Date.now() - cached.fetchedAt < FEED_CACHE_TTL_MS) {
    return cached;
  }

  const productUrl = PRODUCT_LIST_URLS_BY_GAME[game];
  const guideUrl = PRICE_GUIDE_URLS_BY_GAME[game];
  if (!productUrl || !guideUrl) {
    throw new Error(`Cardmarket feed is not configured for ${game}.`);
  }

  const [prodRes, guideRes] = await Promise.all([
    fetch(productUrl, { signal: AbortSignal.timeout(15000) }),
    fetch(guideUrl, { signal: AbortSignal.timeout(15000) }),
  ]);

  if (!prodRes.ok) throw new Error(`Cardmarket product catalog returned HTTP ${prodRes.status}`);
  const prodJson = await prodRes.json();
  const products: CardmarketCatalogProduct[] = Array.isArray(prodJson?.products) ? prodJson.products : [];

  const guideById = new Map<number, GuideRow>();
  if (guideRes.ok) {
    const guideJson = await guideRes.json();
    const rows: GuideRow[] = Array.isArray(guideJson?.priceGuides) ? guideJson.priceGuides : [];
    for (const row of rows) {
      if (row && typeof row.idProduct === 'number') {
        guideById.set(row.idProduct, row);
      }
    }
  }

  const entry: CachedFeed = { fetchedAt: Date.now(), products, guideById };
  feedCache.set(game, entry);
  return entry;
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized — Sign in required.' }, 401);
    if (caller.isBanned) return bannedResponse();
    if (!caller.isAdmin && !caller.isModerator) {
      return jsonResponse({ success: false, error: 'Forbidden — Moderator or Admin access required.' }, 403);
    }

    const game = (url.searchParams.get('game') || 'riftbound').trim().toLowerCase();
    if (!canCallerModerateGame(caller, game)) {
      return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${game}.` }, 403);
    }

    if (!CARDMARKET_GAME_IDS[game]) {
      return jsonResponse({
        success: true,
        supported: false,
        results: [],
        message: `No public Cardmarket product catalog exists for "${game}".`,
      });
    }

    const query = (url.searchParams.get('q') || '').trim().toLowerCase();
    const expansionParam = (url.searchParams.get('expansion') || '').trim();
    const productParam = (url.searchParams.get('idProduct') || '').trim();
    const expFilter = expansionParam ? parseInt(expansionParam, 10) : NaN;
    const idFilter = productParam ? parseInt(productParam, 10) : NaN;

    const feed = await loadCardmarketFeed(game);
    let matches = feed.products;

    if (Number.isInteger(idFilter) && idFilter > 0) {
      matches = matches.filter((p) => p.idProduct === idFilter);
    } else {
      if (Number.isInteger(expFilter) && expFilter > 0) {
        matches = matches.filter((p) => p.idExpansion === expFilter);
      }
      if (query) {
        // Also allow pasting an idProduct or expansion ID straight into the search box
        if (/^\d{4,}$/.test(query)) {
          const num = parseInt(query, 10);
          matches = matches.filter((p) => p.idProduct === num || p.idExpansion === num);
        } else {
          const tokens = query.split(/\s+/).filter(Boolean);
          matches = matches.filter((p) => {
            const hay = `${p.name || ''} ${p.idProduct} ${p.idExpansion || ''}`.toLowerCase();
            return tokens.every((tok) => hay.includes(tok));
          });
        }
      }
    }

    // Most recently added Cardmarket products first (special editions & promos stand out at the top)
    const sorted = [...matches]
      .sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || '') || b.idProduct - a.idProduct)
      .slice(0, 60);

    const results = sorted.map((p) => {
      const g = feed.guideById.get(p.idProduct);
      return {
        idProduct: p.idProduct,
        name: p.name,
        idExpansion: p.idExpansion ?? null,
        idCategory: p.idCategory ?? null,
        dateAdded: p.dateAdded ?? null,
        trend: g?.trend ?? null,
        trendFoil: g?.['trend-foil'] ?? null,
        avg7: g?.avg7 ?? null,
        avg7Foil: g?.['avg7-foil'] ?? null,
        low: g?.low ?? null,
      };
    });

    return jsonResponse({
      success: true,
      supported: true,
      totalCatalogProducts: feed.products.length,
      totalMatched: matches.length,
      results,
    });
  } catch (err: any) {
    console.error('Cardmarket lookup error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Failed to search Cardmarket catalog.' }, 502);
  }
};
