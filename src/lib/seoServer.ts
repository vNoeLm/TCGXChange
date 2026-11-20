import { supabase, getCardImageUrl } from './supabase';
import { parseProfileParam } from './profileUrl';
import { escapeSqlLike } from './sanitize';
import { STORE_PUBLIC_LAUNCH } from './storeConstants';
import type { CardSeoInput, DeckSeoInput, StoreProductSeoInput } from './seo';

const SEO_QUERY_TIMEOUT_MS = 1500;

async function withTimeout<T>(promise: PromiseLike<T>, fallback: T, ms = SEO_QUERY_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchCardSeoData(cardId?: string | null): Promise<CardSeoInput | null> {
  const id = cardId?.trim();
  if (!id) return null;

  return withTimeout(
    (async (): Promise<CardSeoInput | null> => {
      const { data, error } = await supabase
        .from('cards')
        .select('id, name, game, card_number, rarity, card_type, image_path, market_price_eur, sets(name, code)')
        .eq('id', id)
        .eq('is_archived', false)
        .is('deleted_at', null)
        .maybeSingle();

      if (error || !data) return null;
      const setObj = Array.isArray((data as any).sets) ? (data as any).sets[0] : (data as any).sets;
      const priceNum = Number(data.market_price_eur);

      return {
        id: data.id,
        name: data.name,
        game: data.game,
        setName: setObj?.name || null,
        setCode: setObj?.code || null,
        cardNumber: data.card_number || null,
        rarity: data.rarity || null,
        cardType: data.card_type || null,
        imageUrl: data.image_path ? getCardImageUrl(data.image_path) : null,
        marketPriceEur: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null,
      };
    })(),
    null
  );
}

export async function fetchPublicDeckSeoData(deckId?: string | null): Promise<DeckSeoInput | null> {
  const id = deckId?.trim();
  if (!id) return null;

  return withTimeout(
    (async (): Promise<DeckSeoInput | null> => {
      const { data: row, error } = await supabase
        .from('public_decks')
        .select('id, name, game, user_id, legend_card_id, champion_card_id, created_at, updated_at')
        .eq('id', id)
        .eq('is_public', true)
        .maybeSingle();

      if (error || !row) return null;

      const cardIds = [row.legend_card_id, row.champion_card_id].filter(Boolean) as string[];
      const [{ data: profile }, { data: cardRows }] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', row.user_id).maybeSingle(),
        cardIds.length > 0
          ? supabase.from('cards').select('id, name, image_path').in('id', cardIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const cardMap = new Map((cardRows || []).map((c: any) => [c.id, c]));
      const legendCard = row.legend_card_id ? cardMap.get(row.legend_card_id) : null;
      const championCard = row.champion_card_id ? cardMap.get(row.champion_card_id) : null;
      const heroPath = legendCard?.image_path || championCard?.image_path || null;

      return {
        id: row.id,
        name: row.name,
        game: row.game,
        ownerName: profile?.display_name || 'Collector',
        legendName: legendCard?.name || null,
        championName: championCard?.name || null,
        imageUrl: heroPath ? getCardImageUrl(heroPath) : null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      };
    })(),
    null
  );
}

export async function fetchPublicProfileSeoData(
  param?: string | null
): Promise<{ id: string; display_name: string | null; avatar_url: string | null } | null> {
  const queryParam = param?.trim();
  if (!queryParam) return null;

  return withTimeout(
    (async () => {
      const parsed = parseProfileParam(queryParam);

      if (parsed.isUuid) {
        const { data } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .eq('id', queryParam)
          .maybeSingle();
        return data || null;
      }

      const safeNamePattern = escapeSqlLike(queryParam, 60);
      if (safeNamePattern && !/[%_]/.test(queryParam)) {
        const { data } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .ilike('display_name', safeNamePattern)
          .limit(1)
          .maybeSingle();
        if (data) return data;
      }

      if (queryParam.length >= 6) {
        const candidate = parsed.shortId || (queryParam.includes('-') ? queryParam.split('-').pop() || '' : queryParam);
        if (candidate && /^[0-9a-f]{6,8}$/i.test(candidate)) {
          const shortTarget = candidate.toLowerCase();
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, display_name, avatar_url')
            .limit(1000);
          return (
            (profiles || []).find((p: any) =>
              String(p.id).replace(/-/g, '').toLowerCase().startsWith(shortTarget)
            ) || null
          );
        }
      }

      return null;
    })(),
    null
  );
}

export async function fetchStoreProductSeoData(slug?: string | null): Promise<StoreProductSeoInput | null> {
  if (!STORE_PUBLIC_LAUNCH) return null;
  const cleanSlug = slug?.trim();
  if (!cleanSlug) return null;

  return withTimeout(
    (async (): Promise<StoreProductSeoInput | null> => {
      const { data, error } = await supabase
        .from('store_products')
        .select('slug, name, description, price_huf, stock_quantity, image_url, category, game, status')
        .eq('slug', cleanSlug)
        .is('deleted_at', null)
        .in('status', ['active', 'out_of_stock'])
        .maybeSingle();

      if (error || !data) return null;

      return {
        slug: data.slug,
        name: data.name,
        description: data.description || null,
        priceHuf: typeof data.price_huf === 'number' ? data.price_huf : Number(data.price_huf) || null,
        stockQuantity: typeof data.stock_quantity === 'number' ? data.stock_quantity : null,
        imageUrl: data.image_url || null,
        category: data.category || null,
        game: data.game || null,
      };
    })(),
    null
  );
}
