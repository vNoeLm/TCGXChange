/**
 * Reusable Cloudflare Workers Cache API (`caches.default`) helper.
 *
 * - In Cloudflare Workers production: caches JSON responses directly at the nearest PoP edge
 *   (zero Supabase calls on HIT, ~10–30ms response time, $0 cost).
 * - In local Node / Vitest / non-Workers runtimes: safely no-ops and executes the producer directly.
 */

interface CfCache {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
}

function getDefaultEdgeCache(): CfCache | null {
  try {
    const g = globalThis as any;
    if (g?.caches && g.caches.default && typeof g.caches.default.match === 'function') {
      return g.caches.default as CfCache;
    }
  } catch {
    // Non-Workers environment
  }
  return null;
}

export interface EdgeCacheOptions {
  /** Edge cache TTL in seconds (`s-maxage`). */
  edgeTtlSeconds: number;
  /** Browser cache TTL in seconds (`max-age`). Defaults to 0. */
  browserTtlSeconds?: number;
  /** `stale-while-revalidate` window in seconds. */
  staleWhileRevalidateSeconds?: number;
  /** Optional explicit normalized cache URL (defaults to `request.url`). */
  cacheUrl?: string;
}

function buildCacheControl(opts: EdgeCacheOptions): string {
  const browserMax = Math.max(0, Math.floor(opts.browserTtlSeconds ?? 0));
  const edgeMax = Math.max(1, Math.floor(opts.edgeTtlSeconds));
  const swr = opts.staleWhileRevalidateSeconds ? Math.max(0, Math.floor(opts.staleWhileRevalidateSeconds)) : 0;
  return swr > 0
    ? `public, max-age=${browserMax}, s-maxage=${edgeMax}, stale-while-revalidate=${swr}`
    : `public, max-age=${browserMax}, s-maxage=${edgeMax}`;
}

/**
 * Serves a GET response from Cloudflare's edge cache when available, otherwise runs `producer()`,
 * attaches `Cache-Control` headers, stores the 200 OK response in `caches.default`, and returns it.
 */
export async function withEdgeCache(
  request: Request,
  options: EdgeCacheOptions,
  producer: () => Promise<Response>
): Promise<Response> {
  const cache = getDefaultEdgeCache();
  const cacheKeyUrl = options.cacheUrl || request.url;
  const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
  const cacheControl = buildCacheControl(options);

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set('X-Edge-Cache', 'HIT');
        return res;
      }
    } catch {
      // Fall through to origin producer on cache read error
    }
  }

  const originRes = await producer();
  if (!originRes.ok) {
    return originRes;
  }

  const headers = new Headers(originRes.headers);
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Edge-Cache', cache ? 'MISS' : 'BYPASS');

  const finalRes = new Response(originRes.body, {
    status: originRes.status,
    statusText: originRes.statusText,
    headers,
  });

  if (cache) {
    try {
      await cache.put(cacheKey, finalRes.clone());
    } catch {
      // Non-fatal: still return the fresh response
    }
  }

  return finalRes;
}

/**
 * Best-effort purge of a specific URL from Cloudflare's local PoP edge cache.
 */
export async function purgeEdgeCacheUrl(url: string): Promise<void> {
  const cache = getDefaultEdgeCache();
  if (!cache) return;
  try {
    await cache.delete(new Request(url, { method: 'GET' }));
  } catch {
    // Ignore purge failures
  }
}
