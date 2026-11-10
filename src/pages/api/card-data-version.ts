import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabaseServer';
import { cardDataVersion } from '../../lib/cardDataVersion';

export const prerender = false;

// Every page load asks for this, so the CDN answers it for a minute (and keeps serving the last
// answer while it refreshes) instead of the database.
const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
};

let versionCache: { version: string; expiresAt: number } | null = null;
let inFlightVersionPromise: Promise<string> | null = null;

export function invalidateCardDataVersionCache() {
  versionCache = null;
  inFlightVersionPromise = null;
}

async function fetchVersion(): Promise<string> {
  const [count, newest, priced, sets] = await Promise.all([
    supabaseAdmin.from('cards').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('cards').select('created_at').order('created_at', { ascending: false }).limit(1),
    supabaseAdmin
      .from('cards')
      .select('last_price_updated_at')
      .not('last_price_updated_at', 'is', null)
      .order('last_price_updated_at', { ascending: false })
      .limit(1),
    supabaseAdmin.from('sets').select('code, release_date'),
  ]);
  const error = count.error || newest.error || priced.error || sets.error;
  if (error) throw error;

  return cardDataVersion({
    cardCount: count.count,
    newestCard: newest.data?.[0]?.created_at ?? null,
    newestPrice: priced.data?.[0]?.last_price_updated_at ?? null,
    sets: sets.data || [],
  });
}

// ─── GET: fingerprint of the card data (see lib/cardDataVersion.ts) ───
export const GET: APIRoute = async () => {
  try {
    const now = Date.now();
    if (versionCache && now < versionCache.expiresAt) {
      return new Response(JSON.stringify({ version: versionCache.version }), { status: 200, headers: HEADERS });
    }

    if (!inFlightVersionPromise) {
      inFlightVersionPromise = fetchVersion()
        .then((ver) => {
          versionCache = { version: ver, expiresAt: Date.now() + 60000 };
          return ver;
        })
        .finally(() => {
          inFlightVersionPromise = null;
        });
    }

    const version = await inFlightVersionPromise;
    return new Response(JSON.stringify({ version }), { status: 200, headers: HEADERS });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};
