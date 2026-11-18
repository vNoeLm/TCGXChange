import { describe, it, expect } from 'vitest';
import { formatCardmarketSearchQuery, getCardmarketSearchUrl } from '../src/lib/cardmarketUrls';

describe('cardmarketUrls', () => {
  it('formats Riftbound queries by Cardmarket product title rather than collector code', () => {
    expect(
      getCardmarketSearchUrl({
        game: 'riftbound',
        name: 'Showstopper',
        card_number: 'OGN-270',
        set_code: 'OGN',
      })
    ).toBe('https://www.cardmarket.com/en/Riftbound/Products/Search?searchString=Showstopper');

    expect(
      formatCardmarketSearchQuery({
        game: 'riftbound',
        name: 'Miss Fortune - Buccaneer (Regional Qualifier Houston Champion Promo)',
        card_number: 'OGN-193b',
      })
    ).toBe('Miss Fortune, Buccaneer');
  });

  it('keeps hyphenated card code for One Piece where Cardmarket includes (SET-NUM) in titles', () => {
    expect(
      getCardmarketSearchUrl({
        game: 'onepiece',
        name: 'Yamato (Alternate Art)',
        card_number: 'OP13-054_p1',
      })
    ).toBe('https://www.cardmarket.com/en/OnePiece/Products/Search?searchString=OP13-054');

    expect(
      formatCardmarketSearchQuery({
        game: 'onepiece',
        name: 'Sabo - P-044 (Pirate Foil)',
        card_number: 'P-044/84',
      })
    ).toBe('P-044');
  });

  it('formats Lorcana, Star Wars Unlimited, and Flesh and Blood titles cleanly', () => {
    expect(
      formatCardmarketSearchQuery({
        game: 'lorcana',
        name: 'Mickey Mouse - Brave Little Tailor',
        card_number: '115',
      })
    ).toBe('Mickey Mouse - Brave Little Tailor');

    expect(
      formatCardmarketSearchQuery({
        game: 'starwars',
        name: 'Iden Versio - Inferno Squad Commander',
        card_type: 'Leader',
        card_number: '002',
      })
    ).toBe('Iden Versio, Inferno Squad Commander');

    expect(
      formatCardmarketSearchQuery({
        game: 'starwars',
        name: "Administrator's Tower - Cloud City",
        card_type: 'Base',
        card_number: '295',
      })
    ).toBe("Administrator's Tower");

    expect(
      formatCardmarketSearchQuery({
        game: 'fab',
        name: 'Breaking Point (Red)',
        card_number: 'UPR093',
      })
    ).toBe('Breaking Point');
  });
});
