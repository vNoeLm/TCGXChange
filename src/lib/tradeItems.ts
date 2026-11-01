import type { CatalogCard, MarketplaceTrade, TradeCardEntry } from '../types';

export function normalizeTradeItems(
  raw: unknown,
  defaultFoil: boolean | null = false
): TradeCardEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TradeCardEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, any>;
    const cardId = typeof obj.card_id === 'string' ? obj.card_id.trim() : '';
    if (!cardId) continue;
    const condition =
      typeof obj.condition === 'string' && obj.condition.trim()
        ? obj.condition.trim()
        : 'Near Mint';
    const isFoil =
      obj.is_foil === null
        ? null
        : typeof obj.is_foil === 'boolean'
        ? obj.is_foil
        : defaultFoil;
    const quantity = Math.max(1, Math.min(99, parseInt(String(obj.quantity ?? 1), 10) || 1));
    out.push({
      card_id: cardId,
      ...(obj.card && typeof obj.card === 'object' ? { card: obj.card as CatalogCard } : {}),
      condition,
      is_foil: isFoil,
      quantity,
    });
  }
  return out;
}

export function getTradeOfferedItems(trade: Partial<MarketplaceTrade> | null | undefined): TradeCardEntry[] {
  if (!trade) return [];
  if (Array.isArray(trade.offered_items) && trade.offered_items.length > 0) {
    return trade.offered_items;
  }
  if (trade.offered_card_id || trade.offered_card) {
    return [
      {
        card_id: trade.offered_card_id || trade.offered_card?.id || '',
        card: trade.offered_card,
        condition: trade.offered_condition || 'Near Mint',
        is_foil: Boolean(trade.offered_is_foil),
        quantity: Math.max(1, Number(trade.offered_quantity) || 1),
      },
    ];
  }
  return [];
}

export function getTradeWantedItems(trade: Partial<MarketplaceTrade> | null | undefined): TradeCardEntry[] {
  if (!trade) return [];
  if (Array.isArray(trade.wanted_items) && trade.wanted_items.length > 0) {
    return trade.wanted_items;
  }
  if (trade.wanted_card_id || trade.wanted_card) {
    return [
      {
        card_id: trade.wanted_card_id || trade.wanted_card?.id || '',
        card: trade.wanted_card,
        condition: trade.wanted_min_condition || 'Near Mint',
        is_foil: trade.wanted_is_foil === undefined ? null : trade.wanted_is_foil,
        quantity: Math.max(1, Number(trade.wanted_quantity) || 1),
      },
    ];
  }
  return [];
}

export function getTradeSideTotalQuantity(items: TradeCardEntry[]): number {
  return items.reduce((sum, item) => sum + (Math.max(1, Number(item.quantity) || 1)), 0);
}

export function summarizeTradeSide(items: TradeCardEntry[], lang: string = 'en'): string {
  const isHu = lang === 'hu';
  if (!Array.isArray(items) || items.length === 0) {
    return isHu ? 'Kártya' : 'Card';
  }
  const first = items[0];
  const firstName = first.card?.name || (isHu ? 'Kártya' : 'Card');
  const firstLabel = first.quantity > 1 ? `${first.quantity}x ${firstName}` : firstName;
  if (items.length === 1) {
    return firstLabel;
  }
  const extraCount = items.length - 1;
  return isHu ? `${firstLabel} +${extraCount} további` : `${firstLabel} +${extraCount} more`;
}
