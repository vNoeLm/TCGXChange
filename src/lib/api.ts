import { supabase } from './supabase';
import { isUnreleasedSet } from './cardPreview';
import type { FilterState, InventoryCard, CatalogCard } from '../types';
import { findSearchableKeyword, keywordOrClauses, tagOrClauses, SEARCHABLE_KEYWORDS } from './keywordSearch';
import { parseCardSearch } from './cardSearchParser';
import {
  DOMAINS, RARITIES,
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
  const cacheKey = `catalog4_${JSON.stringify(filters)}_${searchQuery.trim().toLowerCase()}`;
  if (!bypassCache) {
    await ensureFreshCache();
    const cached = getCached<{ data: CatalogCard[]; count: number | null }>(cacheKey);
    if (cached) return cached;
  }

  // Parse search query with support for command syntax like text:gold, name:ahri, set:rad, etc.
  const parsedSearch = parseCardSearch(searchQuery);

  const rawSearch = searchQuery.trim();
  let querySetFilter: string | null = parsedSearch.setKeywords[0] || null;
  if (!querySetFilter) {
    const setSyntaxMatch = rawSearch.match(/\b(?:s|set):([a-zA-Z0-9_\-]+)\b/i);
    if (setSyntaxMatch) {
      querySetFilter = setSyntaxMatch[1].trim();
    }
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

  // Apply search command filters:
  // 1. Text commands (ability, text, effect)
  if (parsedSearch.textKeywords.length > 0) {
    for (const kw of parsedSearch.textKeywords) {
      const kwLike = `"%${kw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}%"`;
      query = query.or(`text.ilike.${kwLike},ability.ilike.${kwLike},effect.ilike.${kwLike}`);
    }
  }

  // 2. Name commands
  if (parsedSearch.nameKeywords.length > 0) {
    for (const n of parsedSearch.nameKeywords) {
      query = query.ilike('name', `%${n}%`);
    }
  }

  // 3. Artist commands
  if (parsedSearch.artistKeywords.length > 0) {
    for (const a of parsedSearch.artistKeywords) {
      query = query.ilike('artist', `%${a}%`);
    }
  }

  // 4. Tag commands
  if (parsedSearch.tagKeywords.length > 0) {
    for (const tg of parsedSearch.tagKeywords) {
      const clauses = tagOrClauses(tg);
      if (clauses.length > 0) {
        query = query.or(clauses.join(','));
      }
    }
  }

  // 5. Type commands
  if (parsedSearch.typeKeywords.length > 0) {
    for (const t of parsedSearch.typeKeywords) {
      const tLower = t.toLowerCase();
      if (tLower === 'champion') {
        query = query.eq('subtype', 'Champion');
      } else if (tLower === 'signature') {
        query = query.ilike('subtype', '%Signature%');
      } else if (tLower === 'token') {
        query = query.or('card_type.eq.Token,subtype.ilike.%Token%');
      } else {
        query = query.or(`card_type.ilike.%${t}%,subtype.ilike.%${t}%`);
      }
    }
  }

  // 6. Rarity commands
  if (parsedSearch.rarityKeywords.length > 0) {
    for (const r of parsedSearch.rarityKeywords) {
      query = query.ilike('rarity', `%${r}%`);
    }
  }

  // 7. Domain commands
  if (parsedSearch.domainKeywords.length > 0) {
    for (const d of parsedSearch.domainKeywords) {
      query = query.ilike('domain', `%${d}%`);
    }
  }

  // 8. Cost comparisons (energy)
  for (const cmp of parsedSearch.costFilters) {
    if (cmp.op === '=') query = query.eq('energy', cmp.val);
    else if (cmp.op === '>=') query = query.gte('energy', cmp.val);
    else if (cmp.op === '<=') query = query.lte('energy', cmp.val);
    else if (cmp.op === '>') query = query.gt('energy', cmp.val);
    else if (cmp.op === '<') query = query.lt('energy', cmp.val);
  }

  // 9. Might / Power comparisons
  for (const cmp of [...parsedSearch.mightFilters, ...parsedSearch.powerFilters]) {
    if (cmp.op === '=') query = query.eq('might', cmp.val);
    else if (cmp.op === '>=') query = query.gte('might', cmp.val);
    else if (cmp.op === '<=') query = query.lte('might', cmp.val);
    else if (cmp.op === '>') query = query.gt('might', cmp.val);
    else if (cmp.op === '<') query = query.lt('might', cmp.val);
  }

  // 10. Plain text search (if any text remains outside commands)
  if (parsedSearch.plainQuery !== '') {
    const like = `"%${parsedSearch.plainQuery.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}%"`;
    const clauses = [`name.ilike.${like}`, `card_number.ilike.${like}`, `artist.ilike.${like}`, ...tagOrClauses(parsedSearch.plainQuery)];
    const searchedKeyword = findSearchableKeyword(parsedSearch.plainQuery);
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

  // Validate rarities against active game (Lorcana handles 'Super'->'Super Rare' & promo sub-rarities client-side)
  if (targetGame !== 'lorcana' && filters.rarities && filters.rarities.length > 0) {
    const allowedRarities =
      targetGame === 'mtg' ? MTG_RARITIES :
      targetGame === 'onepiece' ? ONEPIECE_RARITIES :
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
      } else if (filters.type === 'Signature' || filters.type === 'Signature Spell') {
        query = query.ilike('subtype', '%Signature%');
      } else if (filters.type === 'Token') {
        query = query.or('card_type.eq.Token,subtype.ilike.%Token%');
      } else {
        query = query.eq('card_type', filters.type);
      }
    } else if (targetGame !== 'starwars') {
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
        const regularColors = cleanColors.filter(c => c !== 'Multicolor');
        const hasMulticolor = cleanColors.includes('Multicolor');
        const clauses = [
          ...regularColors.map(c => `domain.ilike.%${c}%`),
          ...(hasMulticolor ? ['domain.ilike.% %', 'domain.ilike.%/%'] : []),
        ];
        if (clauses.length > 0) {
          query = query.or(clauses.join(','));
        }
      }
    } else if (targetGame === 'lorcana') {
      const cleanInks = filters.domains.filter(i => LORCANA_INKS.includes(i));
      if (cleanInks.length > 0) {
        const orQuery = cleanInks.map(c => `domain.ilike.%${c}%`).join(',');
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
  const defaultMinCost = (targetGame === 'onepiece' || targetGame === 'lorcana' || targetGame === 'starwars') ? 0 : 1;
  const defaultMaxCost = targetGame === 'lorcana' ? 12 : targetGame === 'starwars' ? 15 : 10;
  if (filters.costMin !== undefined && filters.costMin !== null && filters.costMin > defaultMinCost) {
    query = query.gte('cost', filters.costMin);
  }
  if (filters.costMax !== undefined && filters.costMax !== null && filters.costMax < defaultMaxCost) {
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
      attribute: row.attribute ?? row.metadata?.attribute ?? null,
      counter: row.counter ?? (row.metadata?.counter !== undefined && row.metadata?.counter !== null && row.metadata?.counter !== '' ? Number(row.metadata.counter) : null),
      block_icon: row.block_icon ?? (row.metadata?.block_icon !== undefined && row.metadata?.block_icon !== null && row.metadata?.block_icon !== '' ? String(row.metadata.block_icon) : null),
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
  });

  // Released or not: cards of a set that isn't out yet aren't shown (lib/cardPreview.ts).
  mappedData = mappedData.filter(card => !isUnreleasedSet((card.sets as any)?.release_date));

  if (validSets.length > 0) {
    mappedData = mappedData.filter(card => validSets.includes(card.set_name));
  }

  // One Piece client-side attribute/counter/block/power/type(subtype) filters
  // (applied safely on mappedData so queries also work seamlessly before DB column migrations)
  if (targetGame === 'onepiece') {
    if (filters.tags && filters.tags.length > 0) {
      const wanted = filters.tags.map(t => t.trim().toLowerCase());
      mappedData = mappedData.filter(card => {
        const subTokens = (card.subtype || '')
          .split(/[/,]+/)
          .map(s => s.trim().toLowerCase())
          .filter(Boolean);
        const tagTokens = Array.isArray(card.tags)
          ? card.tags.map((t: any) => String(t).trim().toLowerCase())
          : [];
        return wanted.some(w => subTokens.includes(w) || tagTokens.includes(w));
      });
    }
    if (filters.attributes && filters.attributes.length > 0) {
      const wanted = filters.attributes.map(a => a.trim().toLowerCase());
      mappedData = mappedData.filter(card => {
        if (!card.attribute) return false;
        const cardAttrs = card.attribute
          .split(/[/,&]+/)
          .map(s => s.trim().toLowerCase())
          .filter(Boolean);
        return wanted.some(w => cardAttrs.includes(w));
      });
    }
    if (filters.counters && filters.counters.length > 0) {
      mappedData = mappedData.filter(card => {
        const c = card.counter;
        return filters.counters!.some(sel => (sel === 0 ? (c === 0 || c === null || c === undefined) : c === sel));
      });
    }
    if (filters.blockIcons && filters.blockIcons.length > 0) {
      const wantedBlocks = filters.blockIcons.map(b => String(b).trim().toUpperCase());
      mappedData = mappedData.filter(card => card.block_icon != null && wantedBlocks.includes(String(card.block_icon).trim().toUpperCase()));
    }
    if (filters.illustrationTypes && filters.illustrationTypes.length > 0) {
      const wantedIllusts = filters.illustrationTypes.map(i => i.trim().toLowerCase());
      mappedData = mappedData.filter(card => card.illustration_type != null && wantedIllusts.includes(card.illustration_type.trim().toLowerCase()));
    }
    if (filters.hideReprints) {
      mappedData = mappedData.filter(card => !card.is_reprint);
    }
    if (filters.domains && filters.domains.includes('Multicolor') && filters.domains.length === 1) {
      mappedData = mappedData.filter(card => {
        const parts = (card.domain || '').split(/[\s,/&]+/).map(s => s.trim()).filter(Boolean);
        return parts.length > 1;
      });
    }
    if (filters.powerMin != null || filters.powerMax != null) {
      mappedData = mappedData.filter(card => {
        const raw = card.might != null ? String(card.might).trim() : '';
        if (!/^\d+$/.test(raw)) return false;
        const p = parseInt(raw, 10);
        if (filters.powerMin != null && p < filters.powerMin) return false;
        if (filters.powerMax != null && p > filters.powerMax) return false;
        return true;
      });
    }
  }

  // Disney Lorcana client-side filters (Inkable, Rarity incl. Super/Special tags, Ability, Classification,
  // Lore Value, Strength, Willpower, Movement, Legality)
  if (targetGame === 'lorcana') {
    if (filters.rarities && filters.rarities.length > 0) {
      const wanted = filters.rarities.map(r => r.trim().toLowerCase());
      mappedData = mappedData.filter(card => {
        const rLower = (card.rarity || '').trim().toLowerCase();
        const specialLower = String(card.metadata?.special_rarity || '').trim().toLowerCase();
        return wanted.some(w => {
          if (w === 'super') return rLower === 'super' || rLower === 'super rare';
          if (w === 'super rare') return rLower === 'super rare' || rLower === 'super';
          return rLower === w || (specialLower !== '' && specialLower === w);
        });
      });
    }
    if (filters.inkable && filters.inkable !== 'all') {
      const wantInkable = filters.inkable === 'yes';
      mappedData = mappedData.filter(card => {
        const val = card.metadata?.inkwell;
        return typeof val === 'boolean' ? val === wantInkable : false;
      });
    }
    if (filters.tags && filters.tags.length > 0) {
      const wanted = filters.tags.map(t => t.trim().toLowerCase());
      mappedData = mappedData.filter(card => {
        const subTokens = (card.subtype || '')
          .split(/[•·,/]+/)
          .map(s => s.trim().toLowerCase())
          .filter(Boolean);
        const metaTokens = Array.isArray(card.metadata?.subtypes)
          ? card.metadata.subtypes.map((s: any) => String(s).trim().toLowerCase())
          : [];
        return wanted.some(w => subTokens.includes(w) || metaTokens.includes(w));
      });
    }
    if (filters.abilities && filters.abilities.length > 0) {
      const wanted = filters.abilities.map(a => a.trim().toLowerCase());
      mappedData = mappedData.filter(card => {
        const metaAbs = Array.isArray(card.metadata?.abilities)
          ? card.metadata.abilities.map((a: any) => String(a).trim().toLowerCase())
          : [];
        const txt = (card.text || '').toLowerCase();
        return wanted.some(w => {
          if (metaAbs.some((ma: string) => ma === w || (w === 'shift' && ma.endsWith('shift')))) return true;
          const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`(?:^|\\n|\\b)${escaped}(?:\\b|\\s*[+\\d])`, 'i').test(txt);
        });
      });
    }
    if (filters.loreMin != null || filters.loreMax != null) {
      mappedData = mappedData.filter(card => {
        const raw = card.energy ?? card.metadata?.lore ?? null;
        if (raw === null || raw === undefined || !/^\d+$/.test(String(raw).trim())) return false;
        const val = parseInt(String(raw).trim(), 10);
        if (filters.loreMin != null && val < filters.loreMin) return false;
        if (filters.loreMax != null && val > filters.loreMax) return false;
        return true;
      });
    }
    if (filters.strengthMin != null || filters.strengthMax != null) {
      mappedData = mappedData.filter(card => {
        const raw = card.might ?? card.metadata?.strength ?? null;
        if (raw === null || raw === undefined || !/^\d+$/.test(String(raw).trim())) return false;
        const val = parseInt(String(raw).trim(), 10);
        if (filters.strengthMin != null && val < filters.strengthMin) return false;
        if (filters.strengthMax != null && val > filters.strengthMax) return false;
        return true;
      });
    }
    if (filters.willpowerMin != null || filters.willpowerMax != null) {
      mappedData = mappedData.filter(card => {
        const raw = card.might_bonus ?? card.metadata?.willpower ?? null;
        if (raw === null || raw === undefined || !/^\d+$/.test(String(raw).trim())) return false;
        const val = parseInt(String(raw).trim(), 10);
        if (filters.willpowerMin != null && val < filters.willpowerMin) return false;
        if (filters.willpowerMax != null && val > filters.willpowerMax) return false;
        return true;
      });
    }
    if (filters.movementMin != null || filters.movementMax != null) {
      mappedData = mappedData.filter(card => {
        const raw = card.metadata?.move_cost ?? null;
        if (raw === null || raw === undefined || !/^\d+$/.test(String(raw).trim())) return false;
        const val = parseInt(String(raw).trim(), 10);
        if (filters.movementMin != null && val < filters.movementMin) return false;
        if (filters.movementMax != null && val > filters.movementMax) return false;
        return true;
      });
    }
    if (filters.legality && filters.legality.length > 0) {
      const wanted = filters.legality.map(l => l.trim().toLowerCase());
      mappedData = mappedData.filter(card => {
        const fmts = Array.isArray(card.metadata?.legal_formats)
          ? card.metadata.legal_formats.map((f: any) => String(f).trim().toLowerCase())
          : [];
        return wanted.some(w => fmts.includes(w));
      });
    }
  }

  // Star Wars: Unlimited client-side filters (Type incl. Leader Unit, Aspect Or/And + No Aspect,
  // HP, Power, Upgrade HP, Upgrade Power, Arena, Trait Or/And, Keyword)
  if (targetGame === 'starwars') {
    if (filters.type) {
      const wantedType = filters.type.trim().toLowerCase();
      mappedData = mappedData.filter(card => {
        const primary = (card.card_type || '').trim().toLowerCase();
        const metaTypes = Array.isArray(card.metadata?.types)
          ? card.metadata.types.map((x: any) => String(x).trim().toLowerCase())
          : [];
        return primary === wantedType || metaTypes.includes(wantedType);
      });
    }
    if (filters.domains && filters.domains.length > 0) {
      const cleanAspects = filters.domains.filter(a => STARWARS_ASPECTS.includes(a)).map(a => a.toLowerCase());
      if (cleanAspects.length > 0) {
        const mode = filters.aspectMode || 'or';
        mappedData = mappedData.filter(card => {
          const metaAspects = Array.isArray(card.metadata?.aspects)
            ? card.metadata.aspects.map((x: any) => String(x).trim().toLowerCase()).filter(Boolean)
            : (card.domain || '')
                .split(/[/,]+/)
                .map(s => s.trim().toLowerCase())
                .filter(s => s && s !== 'no aspect');
          const matchesAspect = (target: string) =>
            target === 'no aspect' ? metaAspects.length === 0 : metaAspects.includes(target);
          return mode === 'and'
            ? cleanAspects.every(matchesAspect)
            : cleanAspects.some(matchesAspect);
        });
      }
    }
    if (filters.hpMin != null || filters.hpMax != null) {
      mappedData = mappedData.filter(card => {
        const raw = card.might_bonus ?? card.metadata?.hp ?? null;
        if (raw === null || raw === undefined || !/^-?\d+$/.test(String(raw).trim())) return false;
        const val = parseInt(String(raw).trim(), 10);
        if (filters.hpMin != null && val < filters.hpMin) return false;
        if (filters.hpMax != null && val > filters.hpMax) return false;
        return true;
      });
    }
    if (filters.powerMin != null || filters.powerMax != null) {
      mappedData = mappedData.filter(card => {
        const raw = card.might ?? card.metadata?.power ?? null;
        if (raw === null || raw === undefined || !/^-?\d+$/.test(String(raw).trim())) return false;
        const val = parseInt(String(raw).trim(), 10);
        if (filters.powerMin != null && val < filters.powerMin) return false;
        if (filters.powerMax != null && val > filters.powerMax) return false;
        return true;
      });
    }
    if (filters.upgradeHpMin != null || filters.upgradeHpMax != null) {
      mappedData = mappedData.filter(card => {
        const raw = card.metadata?.upgrade_hp ?? null;
        if (raw === null || raw === undefined || !/^-?\d+$/.test(String(raw).trim())) return false;
        const val = parseInt(String(raw).trim(), 10);
        if (filters.upgradeHpMin != null && val < filters.upgradeHpMin) return false;
        if (filters.upgradeHpMax != null && val > filters.upgradeHpMax) return false;
        return true;
      });
    }
    if (filters.upgradePowerMin != null || filters.upgradePowerMax != null) {
      mappedData = mappedData.filter(card => {
        const raw = card.metadata?.upgrade_power ?? null;
        if (raw === null || raw === undefined || !/^-?\d+$/.test(String(raw).trim())) return false;
        const val = parseInt(String(raw).trim(), 10);
        if (filters.upgradePowerMin != null && val < filters.upgradePowerMin) return false;
        if (filters.upgradePowerMax != null && val > filters.upgradePowerMax) return false;
        return true;
      });
    }
    if (filters.arenas && filters.arenas.length > 0) {
      const wanted = filters.arenas.map(a => a.trim().toLowerCase());
      mappedData = mappedData.filter(card => {
        const metaArenas = Array.isArray(card.metadata?.arenas)
          ? card.metadata.arenas.map((x: any) => String(x).trim().toLowerCase())
          : [];
        return wanted.some(w => metaArenas.includes(w));
      });
    }
    if (filters.tags && filters.tags.length > 0) {
      const wanted = filters.tags.map(t => t.trim().toLowerCase());
      const mode = filters.traitMode || 'or';
      mappedData = mappedData.filter(card => {
        const traitSet = new Set<string>();
        for (const t of (Array.isArray(card.metadata?.traits) ? card.metadata.traits : [])) {
          if (t) traitSet.add(String(t).trim().toLowerCase());
        }
        for (const t of (Array.isArray(card.tags) ? card.tags : [])) {
          if (t) traitSet.add(String(t).trim().toLowerCase());
        }
        if (card.subtype) {
          for (const part of card.subtype.split(/[,/•·]+/)) {
            if (part.trim()) traitSet.add(part.trim().toLowerCase());
          }
        }
        return mode === 'and'
          ? wanted.every(w => traitSet.has(w))
          : wanted.some(w => traitSet.has(w));
      });
    }
    if (filters.keywords && filters.keywords.length > 0) {
      const wanted = filters.keywords.map(k => k.trim().toLowerCase());
      mappedData = mappedData.filter(card => {
        const metaKw = Array.isArray(card.metadata?.keywords)
          ? card.metadata.keywords.map((k: any) => String(k).trim().toLowerCase())
          : [];
        const fullText = `${card.text || ''}\n${card.ability || ''}`.toLowerCase();
        return wanted.some(w => metaKw.includes(w) || new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(fullText));
      });
    }
  }


  const result = { data: mappedData, count: mappedData.length };
  setCached(cacheKey, result);
  return result;
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

