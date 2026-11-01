export type MarketplaceViewTab = 'cards' | 'listings' | 'trades' | 'bulk' | 'auctions' | 'likes';

export interface ParsedMarketplaceUrlParams {
  view: MarketplaceViewTab | null;
  auctionId: string | null;
  bulkId: string | null;
  tradeId: string | null;
  listingId: string | null;
  cardId: string | null;
}

/**
 * Normalizes a raw `tab` or `view` query value to a valid MarketplaceViewTab.
 */
export function normalizeMarketplaceTab(raw: string | null | undefined): MarketplaceViewTab | null {
  if (!raw) return null;
  switch (raw.trim().toLowerCase()) {
    case 'cards':
    case 'grouped':
      return 'cards';
    case 'listings':
    case 'singles':
    case 'individual':
      return 'listings';
    case 'trades':
    case 'trade':
      return 'trades';
    case 'bulk':
    case 'lots':
      return 'bulk';
    case 'auctions':
    case 'auction':
      return 'auctions';
    case 'likes':
    case 'liked':
    case 'saved':
      return 'likes';
    default:
      return null;
  }
}

/**
 * Parses URL search parameters for `/marketplace` to resolve the initial tab (`view`)
 * and any deep-linked modal IDs (including `*_id` aliases).
 */
export function parseMarketplaceUrlParams(search: string): ParsedMarketplaceUrlParams {
  const params = new URLSearchParams(search);
  const explicitTab = normalizeMarketplaceTab(params.get('tab') || params.get('view'));

  const auctionId = params.get('auction')?.trim() || params.get('auction_id')?.trim() || null;
  const bulkId = params.get('bulk')?.trim() || params.get('bulk_id')?.trim() || null;
  const tradeId = params.get('trade')?.trim() || params.get('trade_id')?.trim() || null;
  const listingId = params.get('listing')?.trim() || params.get('inventory_id')?.trim() || null;
  const cardId = params.get('card')?.trim() || params.get('card_id')?.trim() || null;

  let view: MarketplaceViewTab | null = explicitTab;
  if (!view) {
    if (auctionId) view = 'auctions';
    else if (bulkId) view = 'bulk';
    else if (tradeId) view = 'trades';
  }

  return {
    view,
    auctionId,
    bulkId,
    tradeId,
    listingId,
    cardId,
  };
}
