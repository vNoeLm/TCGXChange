import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabaseServer';
import { withEdgeCache } from '../../lib/edgeCache';
import { isUnreleasedSet } from '../../lib/cardPreview';
import { GAMES } from '../../lib/constants';
import type { CatalogCard } from '../../types';

export const prerender = false;

const ALLOWED_GAMES = new Set(GAMES.map((g) => g.id));

function mapCatalogRow(row: any): CatalogCard {
  return {
    id: row.id,
    card_number: row.card_number,
    name: row.name,
    rarity: row.rarity,
    card_type: row.card_type,
    cost: row.cost ?? (row.energy ? parseInt(row.energy, 10) : 0),
    image_path: row.image_path,
    subtype: row.subtype,
    text: row.text,
    game: row.game || 'riftbound',
    metadata: row.metadata || {},
    energy: row.energy,
    might: row.might,
    domain: row.domain,
    tags: row.tags,
    ability: row.ability,
    effect: row.effect ?? null,
    might_bonus: row.might_bonus ?? null,
    attribute: row.attribute ?? row.metadata?.attribute ?? null,
    counter:
      row.counter ??
      (row.metadata?.counter !== undefined && row.metadata?.counter !== null && row.metadata?.counter !== ''
        ? Number(row.metadata.counter)
        : null),
    block_icon:
      row.block_icon ??
      (row.metadata?.block_icon !== undefined && row.metadata?.block_icon !== null && row.metadata?.block_icon !== ''
        ? String(row.metadata.block_icon)
        : null),
    illustration_type: row.illustration_type ?? row.metadata?.illustration_type ?? null,
    is_reprint: Boolean(
      row.is_reprint ??
        row.metadata?.is_reprint ??
        (/_r\d+$/i.test(row.card_number || '') || /\(reprint\)/i.test(row.name || ''))
    ),
    artist: row.artist,
    market_price_eur: row.market_price_eur ?? null,
    market_price_foil_eur: row.market_price_foil_eur ?? null,
    last_price_updated_at: row.last_price_updated_at ?? null,
    set_id: row.sets?.id || '',
    set_name: row.sets?.name || '',
    set_code: row.sets?.code || '',
    sets: row.sets || undefined,
  };
}

/**
 * Edge-cached full card catalog per game.
 *
 * When called with `?game=riftbound&v=<fingerprint>`, cached at the Cloudflare edge for 24h
 * because any card edit, set change, or price sync bumps the version fingerprint automatically.
 * Eliminates repeated 2–11 chunk Supabase PostgREST reads per visitor.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const game = (url.searchParams.get('game') || 'riftbound').trim().toLowerCase();
  if (!ALLOWED_GAMES.has(game)) {
    return new Response(JSON.stringify({ success: false, error: 'Unsupported game.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const version = (url.searchParams.get('v') || '').trim().slice(0, 120);
  const normalizedUrl = new URL(url.origin + url.pathname);
  normalizedUrl.searchParams.set('game', game);
  if (version) normalizedUrl.searchParams.set('v', version);

  return withEdgeCache(
    request,
    {
      cacheUrl: normalizedUrl.toString(),
      edgeTtlSeconds: version ? 86400 : 300,
      browserTtlSeconds: version ? 300 : 60,
      staleWhileRevalidateSeconds: 600,
    },
    async () => {
      try {
        const CHUNK = 1000;
        const allRows: any[] = [];
        for (let from = 0; ; from += CHUNK) {
          const { data, error } = await supabaseAdmin
            .from('cards')
            .select('*, sets ( id, name, code, release_date )')
            .eq('game', game)
            .eq('is_archived', false)
            .is('deleted_at', null)
            .order('card_number', { ascending: true })
            .range(from, from + CHUNK - 1);

          if (error) throw error;
          if (!data || data.length === 0) break;
          allRows.push(...data);
          if (data.length < CHUNK) break;
        }

        const mapped = allRows
          .map(mapCatalogRow)
          .filter((card) => !isUnreleasedSet((card.sets as any)?.release_date));

        return new Response(JSON.stringify({ data: mapped, count: mapped.length }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        console.error('Edge catalog API error:', err);
        return new Response(JSON.stringify({ error: err?.message || 'Failed to load catalog.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
    }
  );
};
