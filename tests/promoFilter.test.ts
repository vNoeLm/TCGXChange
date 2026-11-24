import { describe, expect, it } from 'vitest';
import {
  getDisplaySetLabel,
  getEffectiveSetName,
  isBaseSetCard,
  isPromoCard,
  matchesCardVariants,
} from '../src/lib/cardVariants';
import { countActiveFilters } from '../src/lib/activeFilterCount';
import type { FilterState } from '../src/types';

const baseFilters = (overrides: Partial<FilterState> = {}): FilterState => ({
  game: 'riftbound',
  sets: [],
  rarities: [],
  type: '',
  domains: [],
  tags: [],
  costMin: 1,
  costMax: 10,
  promoFilter: 'all',
  ...overrides,
});

describe('Promo variant detection & parent set resolution', () => {
  it('identifies promo cards by set, rarity, number suffix, or metadata', () => {
    expect(isPromoCard({ sets: { name: 'Promo', code: 'PRM' }, card_number: 'OGN-193-P' })).toBe(true);
    expect(isPromoCard({ card_number: 'RAD-110-P' })).toBe(true);
    expect(isPromoCard({ card_number: 'PRM-001', rarity: 'Common' })).toBe(true);
    expect(isPromoCard({ set_name: 'K/DA Couture Collection', card_number: 'KDA-001', rarity: 'Promo' })).toBe(true);
    expect(isPromoCard({ set_name: 'Origins', card_number: 'OGN-001/298', metadata: { is_promo: true } })).toBe(true);
    expect(isPromoCard({ set_name: 'Origins', card_number: 'OGN-001/298', rarity: 'Common' })).toBe(false);
  });

  it('maps legacy PRM set cards to their parent set while preserving standalone set names', () => {
    expect(getEffectiveSetName({ sets: { name: 'Promo', code: 'PRM' }, card_number: 'OGN-193-P' })).toBe('Origins');
    expect(getEffectiveSetName({ sets: { name: 'Promo', code: 'PRM' }, card_number: 'SFD-012-P' })).toBe('Spiritforged');
    expect(getEffectiveSetName({ sets: { name: 'Promo', code: 'PRM' }, card_number: 'UNL-044-P' })).toBe('Unleashed');
    expect(getEffectiveSetName({ sets: { name: 'Promo', code: 'PRM' }, card_number: 'VEN-005-P' })).toBe('Vendetta');
    expect(getEffectiveSetName({ sets: { name: 'Promo', code: 'PRM' }, card_number: 'RAD-110-P' })).toBe('Radiance');
    expect(getEffectiveSetName({ sets: { name: 'Promo', code: 'PRM' }, card_number: 'OGS-001-P' })).toBe('Proving Grounds');
    expect(
      getEffectiveSetName({ sets: { name: 'K/DA Couture Collection', code: 'KDA' }, card_number: 'KDA-001' })
    ).toBe('K/DA Couture Collection');
  });

  it('never classifies promo cards as base set cards', () => {
    expect(isBaseSetCard({ set_name: 'Promo', set_code: 'PRM', card_number: 'OGN-193/298' })).toBe(false);
    expect(isBaseSetCard({ set_name: 'Origins', card_number: 'OGN-001/298', rarity: 'Common' })).toBe(true);
  });

  it('filters cards according to promoFilter: all (default), only, and none', () => {
    const regularCard = { id: 'reg', game: 'riftbound', set_name: 'Origins', card_number: 'OGN-001/298', rarity: 'Common' };
    const promoCard = { id: 'prm', game: 'riftbound', set_name: 'Promo', set_code: 'PRM', card_number: 'OGN-193-P', rarity: 'Promo' };

    // Default / 'all' includes both regular and promo cards
    expect(matchesCardVariants(regularCard, baseFilters({ promoFilter: 'all' }))).toBe(true);
    expect(matchesCardVariants(promoCard, baseFilters({ promoFilter: 'all' }))).toBe(true);
    expect(matchesCardVariants(promoCard, baseFilters({ promoFilter: undefined }))).toBe(true);

    // 'only' keeps only promos
    expect(matchesCardVariants(regularCard, baseFilters({ promoFilter: 'only' }))).toBe(false);
    expect(matchesCardVariants(promoCard, baseFilters({ promoFilter: 'only' }))).toBe(true);

    // 'none' hides promos
    expect(matchesCardVariants(regularCard, baseFilters({ promoFilter: 'none' }))).toBe(true);
    expect(matchesCardVariants(promoCard, baseFilters({ promoFilter: 'none' }))).toBe(false);
  });

  it('counts promoFilter as an active filter only when changed from default ("all")', () => {
    expect(countActiveFilters(baseFilters({ promoFilter: 'all' }))).toBe(0);
    expect(countActiveFilters(baseFilters({ promoFilter: 'only' }))).toBe(1);
    expect(countActiveFilters(baseFilters({ promoFilter: 'none' }))).toBe(1);
  });

  it('formats promo display set labels with their parent set (e.g. Origins Promo)', () => {
    expect(
      getDisplaySetLabel({
        name: 'Blazing Scorcher (Origins Nexus Night Promo)',
        sets: { name: 'Promo', code: 'PRM' },
        card_number: '001-P',
        rarity: 'Common',
      })
    ).toBe('Origins Promo');

    expect(
      getDisplaySetLabel({
        name: 'Cleave',
        sets: { name: 'Origins', code: 'OGN' },
        card_number: 'OGN-004/298',
        rarity: 'Common',
        metadata: { is_promo: true },
      })
    ).toBe('Origins Promo');

    expect(
      getDisplaySetLabel({
        name: 'Cleave',
        sets: { name: 'Origins', code: 'OGN' },
        card_number: 'OGN-004/298',
        rarity: 'Common',
      })
    ).toBe('Origins');

    expect(
      getDisplaySetLabel({
        name: 'Special Event Card',
        sets: { name: 'Promo', code: 'PRM' },
        card_number: 'PRM-001',
      })
    ).toBe('Promo');
  });
});
