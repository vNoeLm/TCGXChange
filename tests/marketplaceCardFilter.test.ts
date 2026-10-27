import { describe, expect, it } from 'vitest';
import { matchesMarketplaceCard } from '../src/lib/marketplaceCardFilter';
import type { FilterState } from '../src/types';

const filters = (overrides: Partial<FilterState> = {}): FilterState => ({
  category: 'singles',
  game: 'riftbound',
  set: '',
  rarities: [],
  type: '',
  domains: [],
  tags: [],
  costMin: 1,
  costMax: 10,
  ...overrides,
});

const listing = (card_id: string, extra: Record<string, any> = {}) => ({
  card_id,
  name: 'Card',
  card_number: 'RAD-001/167',
  rarity: 'Rare',
  card_type: 'Unit',
  game: 'riftbound',
  cost: 2,
  ...extra,
});

const rare = listing('card-a');
const common = listing('card-b', { rarity: 'Common', card_number: 'RAD-002/167' });

describe('marketplace card filtering', () => {
  it('shows every listing when no wishlist is selected', () => {
    expect(matchesMarketplaceCard(rare, filters(), null)).toBe(true);
    expect(matchesMarketplaceCard(common, filters(), null)).toBe(true);
  });

  it('shows only the cards on the selected wishlist', () => {
    const ids = new Set(['card-a']);
    expect(matchesMarketplaceCard(rare, filters(), ids)).toBe(true);
    expect(matchesMarketplaceCard(common, filters(), ids)).toBe(false);
  });

  it('still applies the other filters to cards on the wishlist', () => {
    const ids = new Set(['card-a']);
    expect(matchesMarketplaceCard(rare, filters({ tags: ['champion'] }), ids)).toBe(false);
    expect(matchesMarketplaceCard({ ...rare, tags: ['champion'] }, filters({ tags: ['champion'] }), ids)).toBe(true);
  });

  it('keeps out a listing whose card id is missing when a wishlist is selected', () => {
    expect(matchesMarketplaceCard({ name: 'No id' }, filters(), new Set(['card-a']))).toBe(false);
  });
});
