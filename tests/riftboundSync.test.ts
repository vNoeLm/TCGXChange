import { describe, expect, it } from 'vitest';
import {
  deriveSpecialSetCode,
  isDotggSpecialSetCard,
  mapDotggSpecialCard,
  mapOfficialCard,
  normalizeCardMatchKeys,
} from '../src/lib/riftboundSync';

describe('riftboundSync non-base dotgg sets & official mapping', () => {
  it('skips main/base sets and promo aggregate set on riftbound.gg while keeping collector sets', () => {
    expect(isDotggSpecialSetCard({ id: 'OGN-001', set_name: 'Origins' })).toBe(false);
    expect(isDotggSpecialSetCard({ id: 'OGS-001', set_name: 'Proving Grounds' })).toBe(false);
    expect(isDotggSpecialSetCard({ id: 'SFD-001', set_name: 'Spiritforged' })).toBe(false);
    expect(isDotggSpecialSetCard({ id: 'UNL-001', set_name: 'Unleashed' })).toBe(false);
    expect(isDotggSpecialSetCard({ id: 'VEN-001', set_name: 'Vendetta' })).toBe(false);
    expect(isDotggSpecialSetCard({ id: 'RAD-001', set_name: 'Radiance' })).toBe(false);
    expect(isDotggSpecialSetCard({ id: 'PRM-001', set_name: 'Promo' })).toBe(false);

    expect(isDotggSpecialSetCard({ id: 'KDA-001-P', set_name: 'K/DA Couture Collection' })).toBe(true);
    expect(isDotggSpecialSetCard({ id: 'T1A-001-P', set_name: 'T1 2025 Worlds Champion Collection' })).toBe(true);
    expect(isDotggSpecialSetCard({ id: 'SGN-001/003-P', set_name: 'Secret Garden Set' })).toBe(true);
    expect(isDotggSpecialSetCard({ id: 'ARC-001', set_name: 'Arcane Box Set' })).toBe(true);
  });

  it('derives deterministic set codes and card match keys', () => {
    expect(deriveSpecialSetCode('K/DA Couture Collection')).toBe('KDA');
    expect(deriveSpecialSetCode('T1 2025 Worlds Champion Collection')).toBe('T1W');
    expect(deriveSpecialSetCode('Secret Garden Set')).toBe('SGN');
    expect(deriveSpecialSetCode('Arcane Box Set')).toBe('ARC');
    expect(deriveSpecialSetCode('Future Worlds Set', 'FWS-001-P')).toBe('FWS');

    expect(normalizeCardMatchKeys('RAD-SP1/005')).toEqual(['RAD-SP1/005', 'RAD-SP1']);
    expect(normalizeCardMatchKeys('KDA-001-P')).toEqual(['KDA-001-P']);
  });

  it('maps dotgg special set cards including token fallback, cmid, promo flag, and R2 preservation', () => {
    const ahri = mapDotggSpecialCard(
      {
        id: 'KDA-001-P',
        name: 'Ahri - Nine-Tailed Fox (K/DA Couture Collection)',
        set_name: 'K/DA Couture Collection',
        rarity: 'Showcase',
        type: ['Legend'],
        color: ['Calm', 'Mind'],
        cost: null,
        might: null,
        tags: ['Ahri'],
        cmid: '920105',
        promo: '1',
        image: 'https://static.dotgg.gg/riftbound/cards/KDA-001-P.webp',
        effect: 'When an enemy unit attacks a battlefield you control, give it -1 :rb_might: this turn.',
      },
      'set-kda'
    );
    expect(ahri.card_type).toBe('Legend');
    expect(ahri.domain).toBe('Calm, Mind');
    expect(ahri.ability).toContain('-1 :rb_might:');
    expect(ahri.text).toBeNull();
    expect(ahri.metadata).toEqual({
      cardmarket_id: 920105,
      is_promo: true,
      source: 'riftbound.gg',
    });

    const token = mapDotggSpecialCard(
      {
        id: 'SGN-T01-P',
        name: 'Bird // Brush',
        set_name: 'Secret Garden Set',
        rarity: 'Common',
        type: null,
        color: ['Colorless'],
        cost: '0',
        might: '1',
        cmid: '900394',
        promo: '1',
        flavor: 'Cloudy with a chance of talons.',
      },
      'set-sgn',
      { image_path: 'riftbound/sgn-t01-p.webp', metadata: { cardmarket_id: 999999 } }
    );
    expect(token.card_type).toBe('Token');
    expect(token.text).toBe('Cloudy with a chance of talons.');
    expect(token.image_path).toBe('riftbound/sgn-t01-p.webp');
    expect(token.metadata.cardmarket_id).toBe(999999);
  });

  it('maps playriftbound.com rich text into ability (preserving R2 image paths)', () => {
    const official = mapOfficialCard(
      {
        publicCode: 'UNL-131/219',
        name: 'Abandon',
        cardType: { type: [{ label: 'Spell' }] },
        rarity: { value: { label: 'Uncommon' } },
        domain: { values: [{ label: 'Chaos' }] },
        energy: { value: { id: 2, label: '2' } },
        text: { richText: { body: '<p>[Reaction]<br />Counter a spell.</p>' } },
        cardImage: { url: 'https://cmsassets.rgpub.io/abandon.png' },
      },
      'set-unl',
      { image_path: 'riftbound/unl-131-219.webp' }
    );
    expect(official.ability).toBe('[Reaction]<br />Counter a spell.');
    expect(official.image_path).toBe('riftbound/unl-131-219.webp');
    expect(official).not.toHaveProperty('text');
  });
});
