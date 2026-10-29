import { supabase } from './supabase';
import { isUnreleasedSet } from './cardPreview';
import { getEffectiveLikeCount } from './marketplaceInteractions';
import type { FilterState, InventoryCard, CatalogCard } from '../types';
import { findSearchableKeyword, keywordOrClauses, tagOrClauses, SEARCHABLE_KEYWORDS } from './keywordSearch';
import {
  OWNER_ID, DOMAINS, RARITIES,
  MTG_RARITIES,
  ONEPIECE_RARITIES, ONEPIECE_COLORS,
  LORCANA_RARITIES, LORCANA_INKS,
  STARWARS_RARITIES, STARWARS_ASPECTS,
  FAB_RARITIES, FAB_CLASSES,
} from './constants';

export const PAGE_SIZE = 36;
export const STORE_PAGE_SIZE = 100;

// --- Helper: Clean Condition Notes (Hide Raw System JSON) ---
export function getDisplayConditionNotes(notes: string | null | undefined): string | null {
  if (!notes || typeof notes !== 'string') return null;
  const trimmed = notes.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const userNote = parsed.user_notes || parsed.condition_notes || parsed.notes || parsed.description;
        if (typeof userNote === 'string' && userNote.trim().length > 0) {
          return userNote.trim();
        }
        return null;
      }
    } catch (e) {}
  }
  if (trimmed.startsWith('marketplace:') || trimmed.startsWith('seller:')) {
    return null;
  }
  return trimmed;
}

// --- Caching Layer (Memory + SessionStorage) ---
// Card data changes (sets added or removed, release dates, the price sync) are noticed on their
// own - see ensureFreshCache. Bump this only when the shape of what's cached changes in the code.
const CACHE_VERSION = 'v31';
const DATA_VERSION_KEY = 'tcg_card_data_version';
/** How long a page load waits for the freshness check before using the cache anyway. */
const DATA_VERSION_TIMEOUT_MS = 1500;
const memoryCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

// Clear any stale caches from previous app versions and any stale setting cache
if (typeof window !== 'undefined') {
  try {
    Object.keys(sessionStorage).forEach(k => {
      if (k.includes('setting_') || (k.startsWith('tcg_cache_') && !k.startsWith(`tcg_cache_${CACHE_VERSION}_`))) {
        sessionStorage.removeItem(k);
      }
    });
  } catch (e) {}
}

function getCached<T>(key: string): T | null {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && (now - mem.timestamp < CACHE_TTL_MS)) {
    return mem.data as T;
  }

  if (typeof window !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(`tcg_cache_${CACHE_VERSION}_${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (now - parsed.timestamp < CACHE_TTL_MS)) {
          memoryCache.set(key, parsed);
          return parsed.data as T;
        }
      }
    } catch (e) {}
  }
  return null;
}

function setCached<T>(key: string, data: T): void {
  const entry = { data, timestamp: Date.now() };
  memoryCache.set(key, entry);
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(`tcg_cache_${CACHE_VERSION}_${key}`, JSON.stringify(entry));
    } catch (e) {}
  }
}

export function clearApiCache(): void {
  memoryCache.clear();
  if (typeof window !== 'undefined') {
    try {
      Object.keys(sessionStorage).forEach(k => {
        if (k.startsWith('tcg_cache_')) sessionStorage.removeItem(k);
      });
    } catch (e) {}
  }
}

let freshnessCheck: Promise<void> | null = null;

/**
 * Once per page load: asks the server for the card data's current fingerprint
 * (/api/card-data-version) and drops every cached list if it differs from the one the cache was
 * filled under. Waits at most DATA_VERSION_TIMEOUT_MS; if the check fails or is slow, the cache is
 * used as before.
 */
function ensureFreshCache(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!freshnessCheck) {
    const check = fetch('/api/card-data-version')
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        const version = typeof json?.version === 'string' ? json.version : null;
        if (!version) return;
        let previous: string | null = null;
        try { previous = sessionStorage.getItem(DATA_VERSION_KEY); } catch (e) {}
        if (previous === version) return;
        clearApiCache();
        try { sessionStorage.setItem(DATA_VERSION_KEY, version); } catch (e) {}
      })
      .catch(() => {});
    freshnessCheck = Promise.race([check, new Promise<void>(resolve => setTimeout(resolve, DATA_VERSION_TIMEOUT_MS))]);
  }
  return freshnessCheck;
}

export function clearStoreCache(): void {
  for (const key of Array.from(memoryCache.keys())) {
    if (key.includes('owner_store_') || key.includes('inv_') || key.includes('card_detail_')) {
      memoryCache.delete(key);
    }
  }
  if (typeof window !== 'undefined') {
    try {
      Object.keys(sessionStorage).forEach(k => {
        if (k.includes('owner_store_') || k.includes('inv_') || k.includes('card_detail_')) {
          sessionStorage.removeItem(k);
        }
      });
    } catch (e) {}
  }
}

export async function fetchCardsCatalog(
  filters: FilterState,
  searchQuery: string,
  bypassCache = false
): Promise<{ data: CatalogCard[]; count: number | null }> {
  const cacheKey = `catalog3_${JSON.stringify(filters)}_${searchQuery.trim().toLowerCase()}`;
  if (!bypassCache) {
    await ensureFreshCache();
    const cached = getCached<{ data: CatalogCard[]; count: number | null }>(cacheKey);
    if (cached) return cached;
  }

  // Parse any s:<set> or set:<set> syntax (e.g. "s:rad", "s:radiance", "set:ogn")
  const rawSearch = searchQuery.trim();
  let querySetFilter: string | null = null;
  let textSearch = rawSearch;
  const setSyntaxMatch = rawSearch.match(/\b(?:s|set):([a-zA-Z0-9_\-]+)\b/i);
  if (setSyntaxMatch) {
    querySetFilter = setSyntaxMatch[1].trim();
    textSearch = rawSearch.replace(setSyntaxMatch[0], '').replace(/\s+/g, ' ').trim();
  }

  // `*` rather than a column list so newer columns (effect, might_bonus) come through as soon as
  // they exist without the query breaking on databases that haven't added them yet.
  const needsInnerSet = Boolean(filters.sets?.length || querySetFilter);
  const selectFields = needsInnerSet
    ? `*, sets!inner ( id, name, code, release_date )`
    : `*, sets ( id, name, code, release_date )`;

  let query = supabase
    .from('cards')
    .select(selectFields);

  if (textSearch !== '') {
    // Quoted, so commas, dots and brackets in the search ("Azir, Ascendant", "Akali (Promo)") stay
    // part of the value - unquoted, the or() filter read them as separators and found nothing.
    const like = `"%${textSearch.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}%"`;
    const clauses = [`name.ilike.${like}`, `card_number.ilike.${like}`, `artist.ilike.${like}`, ...tagOrClauses(textSearch)];
    // Typing a known keyword ("deflect", "xp") also finds cards with that keyword in their text.
    const searchedKeyword = findSearchableKeyword(textSearch);
    if (searchedKeyword) clauses.push(...keywordOrClauses(searchedKeyword));
    query = query.or(clauses.join(','));
  }

  if (querySetFilter) {
    if (querySetFilter.length <= 4) {
      query = query.ilike('sets.code', `%${querySetFilter}%`);
    } else {
      query = query.ilike('sets.name', `%${querySetFilter}%`);
    }
  }

  // Game filter (defaults to riftbound if not specified or if 'riftbound')
  const targetGame = (filters.game && filters.game !== 'all') ? filters.game : 'riftbound';
  query = query.eq('game', targetGame);

  let validSets: string[] = [];
  if (filters.sets && filters.sets.length > 0) {
    validSets = filters.sets;
    query = query.in('sets.name', validSets);
  }

  // Validate rarities against active game
  if (filters.rarities && filters.rarities.length > 0) {
    const allowedRarities =
      targetGame === 'mtg' ? MTG_RARITIES :
      targetGame === 'onepiece' ? ONEPIECE_RARITIES :
      targetGame === 'lorcana' ? LORCANA_RARITIES :
      targetGame === 'starwars' ? STARWARS_RARITIES :
      targetGame === 'fab' ? FAB_RARITIES :
      RARITIES;
    const cleanRarities = filters.rarities.filter(r => allowedRarities.includes(r));
    if (cleanRarities.length > 0) {
      query = query.in('rarity', cleanRarities);
    }
  }

  if (filters.type) {
    if (targetGame === 'riftbound') {
      if (filters.type === 'Champion') {
        query = query.eq('subtype', 'Champion');
      } else if (filters.type === 'Signature Spell') {
        query = query.eq('card_type', 'Spell').ilike('subtype', '%Signature%');
      } else if (filters.type === 'Token') {
        query = query.or('card_type.eq.Token,subtype.ilike.%Token%');
      } else {
        query = query.eq('card_type', filters.type);
      }
    } else {
      query = query.eq('card_type', filters.type);
    }
  }

  // Validate domains / colors / inks / aspects / classes against active game
  if (filters.domains && filters.domains.length > 0) {
    if (targetGame === 'riftbound') {
      const cleanDomains = filters.domains.filter(d => DOMAINS.includes(d));
      if (cleanDomains.length > 0) {
        const orQuery = cleanDomains.map(c => `domain.ilike.%${c}%`).join(',');
        query = query.or(orQuery);
      }
    } else if (targetGame === 'onepiece') {
      const cleanColors = filters.domains.filter(c => ONEPIECE_COLORS.includes(c));
      if (cleanColors.length > 0) {
        const orQuery = cleanColors.map(c => `domain.ilike.%${c}%`).join(',');
        query = query.or(orQuery);
      }
    } else if (targetGame === 'lorcana') {
      const cleanInks = filters.domains.filter(i => LORCANA_INKS.includes(i));
      if (cleanInks.length > 0) {
        const orQuery = cleanInks.map(c => `domain.ilike.%${c}%`).join(',');
        query = query.or(orQuery);
      }
    } else if (targetGame === 'starwars') {
      const cleanAspects = filters.domains.filter(a => STARWARS_ASPECTS.includes(a));
      if (cleanAspects.length > 0) {
        const orQuery = cleanAspects.map(c => `domain.ilike.%${c}%`).join(',');
        query = query.or(orQuery);
      }
    } else if (targetGame === 'fab') {
      const cleanClasses = filters.domains.filter(cl => FAB_CLASSES.includes(cl));
      if (cleanClasses.length > 0) {
        const orQuery = cleanClasses.map(c => `domain.ilike.%${c}%`).join(',');
        query = query.or(orQuery);
      }
    }
  }

  // Cost filter
  if (filters.costMin && filters.costMin > 1) {
    query = query.gte('cost', filters.costMin);
  }
  if (filters.costMax && filters.costMax < 10) {
    query = query.lte('cost', filters.costMax);
  }

  if (targetGame === 'riftbound' && filters.tags && filters.tags.length > 0) {
    const tagQuery = filters.tags.map(t => `tags.cs.["${t}"]`).join(',');
    query = query.or(tagQuery);
  }

  // "and" (default): each keyword gets its own OR-group over ability/text and PostgREST ANDs
  // the groups together. "or": one group holding every keyword's clauses.
  if (targetGame === 'riftbound' && filters.keywords && filters.keywords.length > 0) {
    const valid = filters.keywords.filter(k => (SEARCHABLE_KEYWORDS as readonly string[]).includes(k));
    if (filters.keywordMode === 'or') {
      if (valid.length > 0) query = query.or(valid.flatMap(k => keywordOrClauses(k)).join(','));
    } else {
      valid.forEach(k => { query = query.or(keywordOrClauses(k).join(',')); });
    }
  }

  query = query.order('card_number');

  let allData: any[] = [];
  let from = 0;
  const CHUNK = 2000;

  while (true) {
    const { data: chunk, error: chunkErr } = await query.range(from, from + CHUNK - 1);
    if (chunkErr) {
      console.error('Error fetching cards catalog:', chunkErr);
      break;
    }
    if (!chunk || chunk.length === 0) break;
    allData.push(...chunk);
    from += CHUNK;
    if (chunk.length < CHUNK) break;
  }

  let mappedData: CatalogCard[] = allData.map((row: any) => {
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
      artist: row.artist,
      market_price_eur: row.market_price_eur ?? null,
      market_price_foil_eur: row.market_price_foil_eur ?? null,
      last_price_updated_at: row.last_price_updated_at ?? null,
      set_id: row.sets?.id || '',
      set_name: row.sets?.name || '',
      set_code: row.sets?.code || '',
      sets: row.sets || undefined,
    };
  });

  // Released or not: cards of a set that isn't out yet aren't shown (lib/cardPreview.ts).
  mappedData = mappedData.filter(card => !isUnreleasedSet((card.sets as any)?.release_date));

  if (validSets.length > 0) {
    mappedData = mappedData.filter(card => validSets.includes(card.set_name));
  }


  const result = { data: mappedData, count: mappedData.length };
  setCached(cacheKey, result);
  return result;
}

// --- Public: Card Detail (product page) ---
export async function fetchCardDetail(inventoryId: string, bypassCache = false) {
  const cacheKey = `card_detail_inv_${inventoryId}`;
  if (!bypassCache) {
    await ensureFreshCache();
    const cached = getCached<any>(cacheKey);
    if (cached) return cached;
  }

  // P2P listings live in marketplace_listings. Store products use their own store_products
  // backend and never resolve through this function.
  let { data: mktRow, error: mktErr } = await supabase
    .from('marketplace_listings')
    .select(`
      id, seller_id, card_id, condition, is_foil, price_huf, status, quantity,
      likes_count,
      description, handover_methods, images, collection_id, created_at, updated_at,
      cards (
        *,
        sets ( name, code )
      )
    `)
    .eq('id', inventoryId)
    .maybeSingle();

  if (mktErr && mktErr.message && mktErr.message.includes('likes_count')) {
    const fallback = await supabase
      .from('marketplace_listings')
      .select(`
        id, seller_id, card_id, condition, is_foil, price_huf, status, quantity,
        description, handover_methods, images, collection_id, created_at, updated_at,
        cards (
          *,
          sets ( name, code )
        )
      `)
      .eq('id', inventoryId)
      .maybeSingle();
    mktRow = fallback.data as any;
  }

  if (!mktRow) throw new Error('Item not found.');

  const photos = Array.isArray((mktRow as any).images)
    ? ((mktRow as any).images as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  const data: any = {
    ...mktRow,
    inventory_id: (mktRow as any).id,
    notes: (mktRow as any).description ?? null,
    likes_count: getEffectiveLikeCount((mktRow as any).id, 'listing', typeof (mktRow as any).likes_count === 'number' ? (mktRow as any).likes_count : 0),
    is_bulk: false,
    inventory_images: photos.map((image_path, display_order) => ({ image_path, display_order })),
  };

  const sellerId = (data as any).seller_id || OWNER_ID;
  const handoverMethods: string[] = Array.isArray((data as any).handover_methods) && (data as any).handover_methods.length > 0
    ? (data as any).handover_methods
    : ['personal', 'foxpost', 'packeta', 'other'];

  let sellerName = sellerId === OWNER_ID ? 'Noel :3' : 'Community Seller';
  let sellerAvatar = null;
  let sellerRole = sellerId === OWNER_ID ? 'owner' : 'user';
  let sellerCountry = 'HU';

  try {
    let { data: prof } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, role, is_admin, country')
      .eq('id', sellerId)
      .maybeSingle();

    // Country column not migrated yet: retry without it rather than losing the whole profile.
    if (!prof) {
      const fallback = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, role, is_admin')
        .eq('id', sellerId)
        .maybeSingle();
      prof = fallback.data as typeof prof;
    }

    if (prof) {
      sellerName = prof.display_name || (prof.role === 'owner' ? 'Noel :3' : 'Community Seller');
      sellerAvatar = prof.avatar_url || null;
      sellerRole = prof.role || (prof.is_admin ? 'admin' : 'user');
      sellerCountry = ((prof as any).country || 'HU').toUpperCase();
    }
  } catch (err) {}

  const normalizedStatus = (data.status === 'Reserved' || data.status === 'On Hold') ? 'On Hold' : data.status;

  const enriched = {
    ...data,
    status: normalizedStatus,
    handover_methods: handoverMethods,
    seller_id: sellerId,
    seller_name: sellerName,
    seller_avatar: sellerAvatar,
    seller_role: sellerRole,
    seller_country: sellerCountry,
  };
  setCached(cacheKey, enriched);
  return enriched;
}

export async function fetchCardOnly(cardId: string, bypassCache = false) {
  const cacheKey = `card_only3_${cardId}`;
  if (!bypassCache) {
    await ensureFreshCache();
    const cached = getCached<any>(cacheKey);
    if (cached) return cached;
  }

  const { data, error } = await supabase
    .from('cards')
    .select(`*, sets ( name, code, release_date )`)
    .eq('id', cardId)
    .single();
  if (error) throw error;
  if (isUnreleasedSet((data as any)?.sets?.release_date)) {
    throw new Error("This card hasn't been released yet.");
  }
  setCached(cacheKey, data);
  return data;
}

