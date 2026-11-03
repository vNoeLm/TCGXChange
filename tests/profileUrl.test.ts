import { describe, it, expect } from 'vitest';
import {
  slugifyDisplayName,
  getShortId,
  getProfileSlug,
  getProfileUrl,
  parseProfileParam,
} from '../src/lib/profileUrl';

describe('profileUrl helpers', () => {
  it('slugifies display names accurately with diacritics stripped', () => {
    expect(slugifyDisplayName('TCGXChange')).toBe('tcgxchange');
    expect(slugifyDisplayName('Sámuel Majdik')).toBe('samuel-majdik');
    expect(slugifyDisplayName('Éva Kovács')).toBe('eva-kovacs');
    expect(slugifyDisplayName('John & Jane')).toBe('john-jane');
    expect(slugifyDisplayName('')).toBe('user');
    expect(slugifyDisplayName(null)).toBe('user');
  });

  it('generates 6-character short IDs', () => {
    expect(getShortId('d47ca466-6520-46ec-aff2-718732f1baf7')).toBe('d47ca4');
    expect(getShortId('66148473-b290-449e-b98a-739f9412a9ef')).toBe('661484');
  });

  it('generates profile slugs and URLs', () => {
    const user1 = { id: 'd47ca466-6520-46ec-aff2-718732f1baf7', display_name: 'TCGXChange' };
    expect(getProfileSlug(user1)).toBe('tcgxchange-d47ca4');
    expect(getProfileUrl(user1)).toBe('/profile/tcgxchange-d47ca4');

    const user2 = { id: '66148473-b290-449e-b98a-739f9412a9ef', display_name: 'Sámuel Majdik' };
    expect(getProfileSlug(user2)).toBe('samuel-majdik-661484');
    expect(getProfileUrl(user2)).toBe('/profile/samuel-majdik-661484');
  });

  it('parses profile parameters for UUID, slug, shortId, and display name', () => {
    // 1. Full UUID
    const parsedUuid = parseProfileParam('d47ca466-6520-46ec-aff2-718732f1baf7');
    expect(parsedUuid.isUuid).toBe(true);

    // 2. Name + Short ID discriminator
    const parsedSlug = parseProfileParam('samuel-majdik-661484');
    expect(parsedSlug.isUuid).toBe(false);
    expect(parsedSlug.shortId).toBe('661484');
    expect(parsedSlug.nameQuery).toBe('samuel-majdik');

    // 3. Short ID alone
    const parsedShort = parseProfileParam('d47ca4');
    expect(parsedShort.isUuid).toBe(false);
    expect(parsedShort.shortId).toBe('d47ca4');

    // 4. Raw name alone
    const parsedName = parseProfileParam('TCGXChange');
    expect(parsedName.isUuid).toBe(false);
    expect(parsedName.shortId).toBe(null);
    expect(parsedName.nameQuery).toBe('TCGXChange');
  });
});
