import { describe, expect, it } from 'vitest';
import { TYPES } from '../src/lib/constants';

describe('Signature Filter & Classification', () => {
  it('defines Signature as a top-level type option instead of Signature Spell', () => {
    expect(TYPES).toContain('Signature');
    expect(TYPES).not.toContain('Signature Spell');
  });

  it('identifies signature cards across all card types: Spell, Gear, and Unit', () => {
    const sigSpell = { name: 'Encore', card_type: 'Spell', subtype: 'Signature' };
    const sigGear = { name: 'Blade of the Exile', card_type: 'Gear', subtype: 'Signature' };
    const sigUnit = { name: 'Tibbers', card_type: 'Unit', subtype: 'Signature' };
    const normalUnit = { name: 'Vanguard Defender', card_type: 'Unit', subtype: 'Elite' };
    const normalSpell = { name: 'Mystic Shot', card_type: 'Spell', subtype: '' };

    const isSignature = (card: { subtype?: string | null }) =>
      (card.subtype || '').toLowerCase().includes('signature');

    expect(isSignature(sigSpell)).toBe(true);
    expect(isSignature(sigGear)).toBe(true);
    expect(isSignature(sigUnit)).toBe(true);
    expect(isSignature(normalUnit)).toBe(false);
    expect(isSignature(normalSpell)).toBe(false);
  });
});
