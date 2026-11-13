import { loadCardValueData, valueOfCard, type CardValueData } from './cardValues';
import { roundHuf } from './priceSuggestion';
import { defaultListPrice, parseCollectionKey, type ListDefaults, type NamedCollection } from './collectionDefaults';
import { supabase } from './supabase';

/**
 * The price an always-list collection puts a card up at: its defaults applied to the card's market
 * price / estimated value. Worked out in the browser, which has the price data; the server uses the
 * collection's fixed price for a card it gets no price for.
 */
export function listPriceForCard(
  defaults: ListDefaults,
  card: { id: string; rarity?: string | null; market_price_eur?: number | null; market_price_foil_eur?: number | null } | null | undefined,
  isFoil: boolean,
  values: CardValueData
): number {
  if (!card) return defaults.price_mode !== 'fixed' && defaults.skip_unpriced ? 0 : defaults.base_price_huf;
  const v = valueOfCard(card, isFoil, values);
  return defaultListPrice(defaults, {
    marketHuf: v.referenceHuf ? roundHuf(v.referenceHuf) : null,
    estimateHuf: v.valueHuf,
  });
}

/**
 * Computes initial listing prices for every card in a collection using its list_defaults,
 * fetching card market price metadata from Supabase when not already in memory.
 */
export async function computeCollectionPrices(
  coll: NamedCollection,
  defaults: ListDefaults = coll.list_defaults
): Promise<Record<string, number>> {
  const keys = Object.keys(coll.cards);
  if (keys.length === 0) return {};

  const parsed = keys.map((key) => ({ key, ...parseCollectionKey(key) }));
  const uniqueIds = [...new Set(parsed.map((p) => p.cardId))];

  const [{ data: cards }, values] = await Promise.all([
    supabase
      .from('cards')
      .select('id, rarity, market_price_eur, market_price_foil_eur')
      .in('id', uniqueIds),
    loadCardValueData(),
  ]);

  const cardMap = new Map<string, { id: string; rarity?: string | null; market_price_eur?: number | null; market_price_foil_eur?: number | null }>();
  for (const c of cards || []) {
    cardMap.set(c.id, c);
  }

  const prices: Record<string, number> = {};
  for (const { key, cardId, isFoil } of parsed) {
    const price = listPriceForCard(defaults, cardMap.get(cardId), isFoil, values);
    prices[key] = price;
    if (!(cardId in prices) || !isFoil) {
      prices[cardId] = price;
    }
  }
  return prices;
}

