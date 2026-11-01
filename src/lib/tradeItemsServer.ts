import { supabaseAdmin } from './supabaseServer';
import { normalizeTradeItems } from './tradeItems';
import type { CatalogCard, TradeCardEntry } from '../types';

const TRADE_ITEMS_SETTINGS_KEY = 'marketplace_trade_items';

export interface StoredTradeSideItems {
  offered_items: TradeCardEntry[];
  wanted_items: TradeCardEntry[];
}

export function isMissingColumnError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    /offered_items|wanted_items/i.test(msg)
  );
}

export async function readTradeItemsFallbackMap(): Promise<Record<string, StoredTradeSideItems>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', TRADE_ITEMS_SETTINGS_KEY)
      .maybeSingle();
    if (error || !data?.value) return {};
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveTradeItemsFallback(
  tradeId: string,
  offered_items: TradeCardEntry[],
  wanted_items: TradeCardEntry[]
): Promise<void> {
  try {
    const map = await readTradeItemsFallbackMap();
    map[tradeId] = {
      offered_items: offered_items.map(({ card_id, condition, is_foil, quantity }) => ({
        card_id,
        condition,
        is_foil,
        quantity,
      })),
      wanted_items: wanted_items.map(({ card_id, condition, is_foil, quantity }) => ({
        card_id,
        condition,
        is_foil,
        quantity,
      })),
    };
    await supabaseAdmin
      .from('settings')
      .upsert(
        {
          key: TRADE_ITEMS_SETTINGS_KEY,
          value: JSON.stringify(map),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
  } catch (e) {
    console.warn('Could not persist marketplace_trade_items fallback:', e);
  }
}

export async function deleteTradeItemsFallback(tradeId: string): Promise<void> {
  try {
    const map = await readTradeItemsFallbackMap();
    if (!(tradeId in map)) return;
    delete map[tradeId];
    await supabaseAdmin
      .from('settings')
      .upsert(
        {
          key: TRADE_ITEMS_SETTINGS_KEY,
          value: JSON.stringify(map),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
  } catch {}
}

export async function hydrateTradeRowsWithItems(rows: any[]): Promise<any[]> {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const fallbackMap = await readTradeItemsFallbackMap();
  const cardIdsToFetch = new Set<string>();
  const knownCards = new Map<string, CatalogCard>();

  for (const row of rows) {
    if (row.offered_card?.id) knownCards.set(row.offered_card.id, row.offered_card);
    if (row.wanted_card?.id) knownCards.set(row.wanted_card.id, row.wanted_card);
  }

  const parsedByRow = rows.map((row) => {
    const fallback = fallbackMap[row.id];
    let offered = normalizeTradeItems(
      Array.isArray(row.offered_items) && row.offered_items.length > 0
        ? row.offered_items
        : fallback?.offered_items,
      false
    );
    let wanted = normalizeTradeItems(
      Array.isArray(row.wanted_items) && row.wanted_items.length > 0
        ? row.wanted_items
        : fallback?.wanted_items,
      null
    );

    if (offered.length === 0 && row.offered_card_id) {
      offered = [
        {
          card_id: row.offered_card_id,
          condition: row.offered_condition || 'Near Mint',
          is_foil: Boolean(row.offered_is_foil),
          quantity: Math.max(1, Number(row.offered_quantity) || 1),
        },
      ];
    }

    if (wanted.length === 0 && row.wanted_card_id) {
      wanted = [
        {
          card_id: row.wanted_card_id,
          condition: row.wanted_min_condition || 'Near Mint',
          is_foil: row.wanted_is_foil === undefined ? null : row.wanted_is_foil,
          quantity: Math.max(1, Number(row.wanted_quantity) || 1),
        },
      ];
    }

    for (const item of offered) {
      if (!knownCards.has(item.card_id)) cardIdsToFetch.add(item.card_id);
    }
    for (const item of wanted) {
      if (!knownCards.has(item.card_id)) cardIdsToFetch.add(item.card_id);
    }

    return { row, offered, wanted };
  });

  if (cardIdsToFetch.size > 0) {
    const { data: extraCards } = await supabaseAdmin
      .from('cards')
      .select(`
        id, card_number, name, rarity, card_type, cost, image_path,
        subtype, text, game, energy, might, domain, tags, ability, artist,
        sets ( id, name, code )
      `)
      .in('id', Array.from(cardIdsToFetch));

    for (const c of extraCards || []) {
      if (c?.id) knownCards.set(c.id, c as unknown as CatalogCard);
    }
  }

  return parsedByRow.map(({ row, offered, wanted }) => {
    const hydratedOffered = offered.map((it) => ({
      ...it,
      card: knownCards.get(it.card_id) || it.card,
    }));
    const hydratedWanted = wanted.map((it) => ({
      ...it,
      card: knownCards.get(it.card_id) || it.card,
    }));

    return {
      ...row,
      offered_card: row.offered_card || hydratedOffered[0]?.card || null,
      wanted_card: row.wanted_card || hydratedWanted[0]?.card || null,
      offered_items: hydratedOffered,
      wanted_items: hydratedWanted,
    };
  });
}
