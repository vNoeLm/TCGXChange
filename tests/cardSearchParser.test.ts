import { describe, expect, it } from 'vitest';
import {
  parseCardSearch,
  cardMatchesSearch,
  getIntelliSenseSuggestions,
} from '../src/lib/cardSearchParser';

describe('cardSearchParser', () => {
  describe('parseCardSearch', () => {
    it('returns empty parsed search for empty strings', () => {
      const parsed = parseCardSearch('');
      expect(parsed.hasCommands).toBe(false);
      expect(parsed.plainQuery).toBe('');
      expect(parsed.textKeywords).toEqual([]);
    });

    it('parses text: command correctly', () => {
      const parsed = parseCardSearch('text:gold');
      expect(parsed.hasCommands).toBe(true);
      expect(parsed.textKeywords).toEqual(['gold']);
      expect(parsed.plainQuery).toBe('');
    });

    it('supports t: alias for text:', () => {
      const parsed = parseCardSearch('t:draw');
      expect(parsed.hasCommands).toBe(true);
      expect(parsed.textKeywords).toEqual(['draw']);
    });

    it('supports quoted text values like text:"when I hold"', () => {
      const parsed = parseCardSearch('text:"when I hold" type:unit');
      expect(parsed.textKeywords).toEqual(['when I hold']);
      expect(parsed.typeKeywords).toEqual(['unit']);
      expect(parsed.plainQuery).toBe('');
    });

    it('preserves plain search text alongside commands', () => {
      const parsed = parseCardSearch('Ahri text:charm set:rad');
      expect(parsed.textKeywords).toEqual(['charm']);
      expect(parsed.setKeywords).toEqual(['rad']);
      expect(parsed.plainQuery).toBe('Ahri');
    });

    it('parses numeric stats filters like cost:>2 might:5', () => {
      const parsed = parseCardSearch('cost:>2 might:5');
      expect(parsed.costFilters).toEqual([{ op: '>', val: 2 }]);
      expect(parsed.mightFilters).toEqual([{ op: '=', val: 5 }]);
    });
  });

  describe('cardMatchesSearch', () => {
    const cardWithAbility = {
      name: "An Offer You Can't Refuse",
      card_type: 'Spell',
      subtype: null,
      ability: '[Action] Kill a gear. Its controller plays a Gold gear token exhausted.',
      text: 'Go on, take it.',
      effect: null,
      cost: 2,
    };

    const cardWithFlavor = {
      name: 'Treasure Hunter',
      card_type: 'Unit',
      subtype: null,
      ability: 'When I move, gain 1 gold.',
      text: "“I'm sure they won't miss it.”",
      effect: null,
      cost: 3,
    };

    const cardWithoutGold = {
      name: 'Mystic Shot',
      card_type: 'Spell',
      subtype: null,
      ability: 'Deal 2 damage to any target.',
      text: 'Target acquired.',
      effect: null,
      cost: 2,
    };

    it('matches cards when query text is found in ability', () => {
      expect(cardMatchesSearch(cardWithAbility, 'text:gold')).toBe(true);
      expect(cardMatchesSearch(cardWithAbility, 't:gear')).toBe(true);
      expect(cardMatchesSearch(cardWithoutGold, 'text:gold')).toBe(false);
    });

    it('matches cards when query text is found in flavor text', () => {
      expect(cardMatchesSearch(cardWithFlavor, 'text:"miss it"')).toBe(true);
      expect(cardMatchesSearch(cardWithoutGold, 'text:"miss it"')).toBe(false);
    });

    it('combines text and type commands cleanly', () => {
      expect(cardMatchesSearch(cardWithAbility, 'text:gold type:spell')).toBe(true);
      expect(cardMatchesSearch(cardWithAbility, 'text:gold type:unit')).toBe(false);
      expect(cardMatchesSearch(cardWithFlavor, 'text:gold type:unit')).toBe(true);
    });
  });

  describe('getIntelliSenseSuggestions', () => {
    it('suggests command list when input is empty', () => {
      const { suggestions } = getIntelliSenseSuggestions('', 0, 'en');
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(s => s.displayText === 'text:')).toBe(true);
    });

    it('filters commands when typing a prefix like "tex"', () => {
      const { suggestions } = getIntelliSenseSuggestions('tex', 3, 'en');
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].displayText).toBe('text:');
    });

    it('suggests values when typing after command colon like "type:"', () => {
      const { suggestions } = getIntelliSenseSuggestions('type:', 5, 'en');
      expect(suggestions.some(s => s.displayText === 'type:unit')).toBe(true);
      expect(suggestions.some(s => s.displayText === 'type:signature')).toBe(true);
      expect(suggestions.some(s => s.displayText === 'type:spell')).toBe(true);
    });

    it('suggests values when typing "text:"', () => {
      const { suggestions } = getIntelliSenseSuggestions('text:', 5, 'en');
      expect(suggestions.some(s => s.displayText === 'text:gold')).toBe(true);
      expect(suggestions.some(s => s.displayText === 'text:draw')).toBe(true);
    });
  });
});
