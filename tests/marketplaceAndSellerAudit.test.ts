import { describe, it, expect } from 'vitest';
import {
  ACTIVE_HOLD_STATUSES,
  collectActiveHeldIds,
  findOrphanedOnHoldIds,
} from '../src/lib/holdReconciliation';
import {
  normalizeMarketplaceTab,
  parseMarketplaceUrlParams,
} from '../src/lib/marketplaceUrlState';

describe('Hold Reconciliation (Trades & Bulk Ghost Holds)', () => {
  it('includes all four active hold lifecycle statuses', () => {
    expect(ACTIVE_HOLD_STATUSES).toEqual(['pending', 'held', 'handed_over', 'buyer_received']);
  });

  it('collects active held IDs from both top-level inventory_id and nested items[]', () => {
    const activeSet = collectActiveHeldIds([
      { inventory_id: 'trade-1', items: null },
      {
        inventory_id: null,
        items: [{ inventory_id: 'bulk-99' }, { inventory_id: '  mkt-42  ' }],
      },
      { inventory_id: '', items: [{}] },
    ]);

    expect(activeSet.has('trade-1')).toBe(true);
    expect(activeSet.has('bulk-99')).toBe(true);
    expect(activeSet.has('mkt-42')).toBe(true);
    expect(activeSet.size).toBe(3);
  });

  it('identifies only orphaned on_hold items while preserving legitimately held and non-held items', () => {
    const activeSet = collectActiveHeldIds([
      { inventory_id: 'trade-active' },
      { items: [{ inventory_id: 'bulk-active' }] },
    ]);

    const trades = [
      { id: 'trade-active', status: 'on_hold' },
      { id: 'trade-ghost', status: 'on_hold' },
      { id: 'trade-open', status: 'open' },
      { id: 'trade-done', status: 'completed' },
    ];
    expect(findOrphanedOnHoldIds(trades, activeSet)).toEqual(['trade-ghost']);

    const bulkLots = [
      { id: 'bulk-active', status: 'on_hold' },
      { id: 'bulk-ghost-1', status: 'on_hold' },
      { id: 'bulk-ghost-2', status: 'On Hold' },
      { id: 'bulk-stock', status: 'in_stock' },
      { id: 'bulk-sold', status: 'sold' },
    ];
    expect(findOrphanedOnHoldIds(bulkLots, activeSet)).toEqual(['bulk-ghost-1', 'bulk-ghost-2']);
  });
});

describe('Marketplace URL Tab & Deep-Link Parsing', () => {
  it('normalizes tab aliases cleanly and rejects unknown values', () => {
    expect(normalizeMarketplaceTab('auctions')).toBe('auctions');
    expect(normalizeMarketplaceTab('AUCTION')).toBe('auctions');
    expect(normalizeMarketplaceTab('bulk')).toBe('bulk');
    expect(normalizeMarketplaceTab('singles')).toBe('listings');
    expect(normalizeMarketplaceTab('saved')).toBe('likes');
    expect(normalizeMarketplaceTab('cards')).toBe('cards');
    expect(normalizeMarketplaceTab('trades')).toBeNull();
    expect(normalizeMarketplaceTab('invalid-tab')).toBeNull();
    expect(normalizeMarketplaceTab(null)).toBeNull();
  });

  it('parses ?tab=auctions from live outbid notifications', () => {
    const parsed = parseMarketplaceUrlParams('?tab=auctions');
    expect(parsed.view).toBe('auctions');
    expect(parsed.auctionId).toBeNull();
  });

  it('auto-selects matching view tab when deep-linking to an auction or bulk lot', () => {
    const aucLink = parseMarketplaceUrlParams('?auction_id=auc-77');
    expect(aucLink.view).toBe('auctions');
    expect(aucLink.auctionId).toBe('auc-77');

    const bulkLink = parseMarketplaceUrlParams('?bulk=bulk-55');
    expect(bulkLink.view).toBe('bulk');
    expect(bulkLink.bulkId).toBe('bulk-55');
  });

  it('preserves explicit tab when both tab and item modal params are present', () => {
    const parsed = parseMarketplaceUrlParams('?tab=likes&auction=auc-88&inventory_id=inv-10');
    expect(parsed.view).toBe('likes');
    expect(parsed.auctionId).toBe('auc-88');
    expect(parsed.listingId).toBe('inv-10');
  });
});
