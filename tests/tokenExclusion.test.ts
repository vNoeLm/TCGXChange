import { describe, expect, it } from 'vitest';
import { isToken, isBaseSetCard } from '../src/lib/cardVariants';
import { isTokenCard } from '../src/lib/riftboundRules';

describe('Token Card Identification & Deck Builder Exclusion', () => {
  describe('isToken', () => {
    it('identifies cards with card_type === "Token" or containing "token"', () => {
      expect(isToken({ card_type: 'Token' })).toBe(true);
      expect(isToken({ card_type: 'token' })).toBe(true);
      expect(isToken({ card_type: 'Token Creature' })).toBe(true);
      expect(isToken({ card_type: 'Token Unit' })).toBe(true);
    });

    it('identifies cards with subtype containing "token"', () => {
      expect(isToken({ card_type: 'Unit', subtype: 'Token' })).toBe(true);
      expect(isToken({ card_type: 'Unit', subtype: 'token' })).toBe(true);
      expect(isToken({ card_type: 'Unit', subtype: 'Token Unit' })).toBe(true);
    });

    it('identifies cards with rarity === "Token"', () => {
      expect(isToken({ card_type: 'Unit', rarity: 'Token' })).toBe(true);
      expect(isToken({ card_type: 'Unit', rarity: 'token' })).toBe(true);
    });

    it('identifies cards with "Token" tag across array, string, and object shapes', () => {
      expect(isToken({ card_type: 'Unit', tags: ['Token'] })).toBe(true);
      expect(isToken({ card_type: 'Unit', tags: ['token'] })).toBe(true);
      expect(isToken({ card_type: 'Unit', tags: ['Mech', 'Token'] })).toBe(true);
      expect(isToken({ card_type: 'Unit', tags: 'Token' })).toBe(true);
      expect(isToken({ card_type: 'Unit', tags: 'Mech, Token' })).toBe(true);
      expect(isToken({ card_type: 'Unit', tags: { tags: ['Token'] } })).toBe(true);
    });

    it('identifies cards with token card numbers (-T, T-, T01, etc.)', () => {
      expect(isToken({ card_number: 'VEN-T03' })).toBe(true);
      expect(isToken({ card_number: 'RAD-T02' })).toBe(true);
      expect(isToken({ card_number: 'T-01' })).toBe(true);
      expect(isToken({ card_number: 'T01' })).toBe(true);
      expect(isToken({ card_number: 'SOR-T01' })).toBe(true);
      expect(isToken({ card_number: '123-T' })).toBe(true);
    });

    it('identifies cards with token name patterns', () => {
      expect(isToken({ name: 'Soldier (Token)' })).toBe(true);
      expect(isToken({ name: 'Soldier Token' })).toBe(true);
      expect(isToken({ name: 'Mech [Token]' })).toBe(true);
    });

    it('identifies cards with token metadata', () => {
      expect(isToken({ metadata: { is_token: true } })).toBe(true);
      expect(isToken({ metadata: { type: 'Token' } })).toBe(true);
    });

    it('does not falsely classify normal constructed cards as tokens', () => {
      expect(isToken({
        name: 'Aatrox, The Darkin Blade',
        card_number: 'OGN-001',
        card_type: 'Unit',
        subtype: 'Darkin',
        rarity: 'Epic',
        tags: ['Darkin', 'Ascended'],
      })).toBe(false);

      expect(isToken({
        name: 'Deflect',
        card_number: 'OGN-120',
        card_type: 'Spell',
        subtype: 'Reaction',
        rarity: 'Common',
        tags: ['Spell'],
      })).toBe(false);

      expect(isToken({
        name: 'Monkey D. Luffy',
        card_number: 'OP01-001',
        card_type: 'Leader',
        rarity: 'L',
      })).toBe(false);

      // Card with word "Token" inside name that is not a token descriptor (e.g. Token of Faith)
      expect(isToken({
        name: 'Token of Faith',
        card_number: 'MTG-045',
        card_type: 'Artifact',
        rarity: 'Rare',
      })).toBe(false);
    });
  });

  describe('isTokenCard in riftboundRules', () => {
    it('properly identifies token cards using isToken logic', () => {
      expect(isTokenCard({ card_type: 'Token' })).toBe(true);
      expect(isTokenCard({ card_number: 'VEN-T03' })).toBe(true);
      expect(isTokenCard({ tags: ['Token'] } as any)).toBe(true);
      expect(isTokenCard({ card_type: 'Unit', card_number: 'OGN-001' })).toBe(false);
    });
  });

  describe('isBaseSetCard', () => {
    it('never considers a token card as a base set card', () => {
      expect(isBaseSetCard({
        card_number: 'VEN-T03',
        card_type: 'Token',
        rarity: 'Token',
      })).toBe(false);
    });
  });
});
