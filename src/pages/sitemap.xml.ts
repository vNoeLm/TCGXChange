import type { APIRoute } from 'astro';
import { GAMES } from '../lib/constants';
import { P2P_PUBLIC_LAUNCH } from '../lib/p2pConstants';
import { HELP_PAGES, LEGAL_PAGES } from '../lib/site';
import { STORE_PUBLIC_LAUNCH } from '../lib/storeConstants';
import { SITE_URL, escapeXml } from '../lib/seo';
import { supabase } from '../lib/supabase';

export const prerender = false;

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: string;
}

const SITEMAP_TIMEOUT_MS = 3000;

async function fetchWithTimeout<T>(promise: PromiseLike<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), SITEMAP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const GET: APIRoute = async () => {
  const entries: SitemapEntry[] = [
    { loc: `${SITE_URL}/`, changefreq: 'daily', priority: '1.0' },
    ...GAMES.filter((g) => g.active !== false).map((g) => ({
      loc: `${SITE_URL}/${g.id}`,
      changefreq: 'daily' as const,
      priority: '0.9',
    })),
    { loc: `${SITE_URL}/decks`, changefreq: 'daily', priority: '0.8' },
    { loc: `${SITE_URL}/deck-builder`, changefreq: 'weekly', priority: '0.8' },
    { loc: `${SITE_URL}/binder`, changefreq: 'weekly', priority: '0.7' },
    ...HELP_PAGES.map((p) => ({
      loc: `${SITE_URL}${p.href}`,
      changefreq: 'monthly' as const,
      priority: '0.5',
    })),
    ...LEGAL_PAGES.map((p) => ({
      loc: `${SITE_URL}${p.href}`,
      changefreq: 'monthly' as const,
      priority: '0.3',
    })),
  ];

  if (STORE_PUBLIC_LAUNCH) {
    entries.push({ loc: `${SITE_URL}/store`, changefreq: 'daily', priority: '0.8' });
  }
  if (P2P_PUBLIC_LAUNCH) {
    entries.push({ loc: `${SITE_URL}/marketplace`, changefreq: 'hourly', priority: '0.8' });
  }

  const [{ data: publicDecks }, { data: activeCards }, storeProductsRes] = await Promise.all([
    fetchWithTimeout(
      supabase
        .from('public_decks')
        .select('id, updated_at')
        .eq('is_public', true)
        .order('updated_at', { ascending: false })
        .limit(1000),
      { data: null } as any
    ),
    fetchWithTimeout(
      supabase
        .from('cards')
        .select('id, created_at')
        .eq('is_archived', false)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5000),
      { data: null } as any
    ),
    STORE_PUBLIC_LAUNCH
      ? fetchWithTimeout(
          supabase
            .from('store_products')
            .select('slug, updated_at')
            .is('deleted_at', null)
            .in('status', ['active', 'out_of_stock'])
            .limit(2000),
          { data: null } as any
        )
      : Promise.resolve({ data: null } as any),
  ]);

  if (Array.isArray(publicDecks)) {
    for (const d of publicDecks) {
      if (!d?.id) continue;
      entries.push({
        loc: `${SITE_URL}/decks/view?deck=${encodeURIComponent(d.id)}`,
        lastmod: d.updated_at ? new Date(d.updated_at).toISOString().split('T')[0] : undefined,
        changefreq: 'weekly',
        priority: '0.6',
      });
    }
  }

  if (Array.isArray(storeProductsRes?.data)) {
    for (const p of storeProductsRes.data) {
      if (!p?.slug) continue;
      entries.push({
        loc: `${SITE_URL}/store/product?slug=${encodeURIComponent(p.slug)}`,
        lastmod: p.updated_at ? new Date(p.updated_at).toISOString().split('T')[0] : undefined,
        changefreq: 'daily',
        priority: '0.7',
      });
    }
  }

  if (Array.isArray(activeCards)) {
    for (const c of activeCards) {
      if (!c?.id) continue;
      entries.push({
        loc: `${SITE_URL}/card?id=${encodeURIComponent(c.id)}`,
        changefreq: 'weekly',
        priority: '0.6',
      });
    }
  }

  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      if (entry.priority) parts.push(`    <priority>${entry.priority}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    }),
    '</urlset>',
  ];

  return new Response(xmlLines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
