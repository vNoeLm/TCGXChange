import { describe, expect, it } from 'vitest';
import { getDefaultTagsForGame, mergeTagsForGame, normalizeTagList } from '../src/lib/cardCatalogTags';

describe('cardCatalogTags helpers', () => {
  it('normalizes and deduplicates tags case-insensitively', () => {
    expect(normalizeTagList([' K/DA ', 'k/da', '', '  Promo  ', 123])).toEqual(['K/DA', 'Promo']);
  });

  it('merges built-in game tags, custom registry tags, and card tags without duplicates', () => {
    const merged = mergeTagsForGame(
      'riftbound',
      { riftbound: ['K/DA', 'Couture Collection', 'ahri'] },
      [
        { game: 'riftbound', tags: ['Event Promo', 'K/DA'] },
        { game: 'onepiece', tags: ['ShouldNotLeak'] },
      ]
    );
    expect(merged).toContain('K/DA');
    expect(merged).toContain('Couture Collection');
    expect(merged).toContain('Event Promo');
    expect(merged).not.toContain('ShouldNotLeak');
    expect(merged.filter((t) => t.toLowerCase() === 'ahri').length).toBe(1);
    expect(merged.length).toBeGreaterThan(getDefaultTagsForGame('riftbound').length);
  });
});
