import { extraLegendsRequired, legendNameKey } from '../../lib/riftboundRules';
import { isToken } from '../../lib/cardVariants';
import { gameStorageKey, hasZone, maxCopies, type GameId } from '../../lib/deckRules';
import { useState, useEffect } from 'react';
import type { CatalogCard } from '../../types';

export interface DeckState {
  game?: GameId;
  legend: string | null;
  champion: string | null;
  /** Riftbound: legends chosen besides the starting legend, for a card like Neeko, Blending In
   * ("choose 3 different legends in addition to your starting legend"). See deckExtraLegendsRequired. */
  extraLegends?: string[];
  mainDeck: Record<string, number>;
  runeDeck: Record<string, number>;
  battlefields: Record<string, number>;
  sideboard: Record<string, number>;
}

/**
 * How many extra legends this deck has to choose: the most any card in the main deck or the
 * champion slot asks for (Neeko, Blending In: 3). 0 when nothing in the deck asks.
 */
export function deckExtraLegendsRequired(deck: DeckState, allCards: CatalogCard[]): number {
  const ids = [deck.champion, ...Object.keys(deck.mainDeck || {})].filter(Boolean) as string[];
  return ids.reduce((most, id) => Math.max(most, extraLegendsRequired(allCards.find(c => c.id === id))), 0);
}

const INITIAL_DECK: DeckState = {
  legend: null,
  champion: null,
  extraLegends: [],
  mainDeck: {},
  runeDeck: {},
  battlefields: {},
  sideboard: {},
};

export function useDeckBuilder(activeGame: GameId = 'riftbound') {
  const [deck, setDeck] = useState<DeckState>(() => ({
    ...INITIAL_DECK,
    game: activeGame,
  }));
  // The storage key whose deck is currently in state. When the game changes, state still holds
  // the previous game's deck until the load effect swaps it in; `loaded` stays false meanwhile so
  // the save effect can never write the old game's deck under the new game's key.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const storageKey = gameStorageKey(activeGame, 'deck');
  const loaded = loadedKey === storageKey;

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setDeck({
          ...INITIAL_DECK,
          ...parsed,
          game: activeGame,
          extraLegends: Array.isArray(parsed.extraLegends) ? parsed.extraLegends : [],
        });
      } catch (e) {
        console.error('Failed to parse saved deck', e);
        setDeck({ ...INITIAL_DECK, game: activeGame });
      }
    } else {
      setDeck({ ...INITIAL_DECK, game: activeGame });
    }
    setLoadedKey(storageKey);
  }, [activeGame, storageKey]);

  useEffect(() => {
    if (loaded) {
      localStorage.setItem(storageKey, JSON.stringify(deck));
    }
  }, [deck, loaded, storageKey]);

  const addCard = (card: CatalogCard, zone: keyof DeckState, allCards: CatalogCard[]) => {
    if (isToken(card)) return;
    setDeck(prev => {
      // Zones this game doesn't have (e.g. runes in Magic) take nothing. Extra legends is a
      // Riftbound-only extra slot rather than a regular zone.
      if (zone === 'extraLegends' ? activeGame !== 'riftbound' : !hasZone(activeGame, zone as string)) return prev;

      // Riftbound extra legends (Neeko, Blending In): legends only, as many as the deck asks for,
      // and "different" - no name may match another chosen legend or the starting legend.
      if (zone === 'extraLegends') {
        if (card.card_type !== 'Legend') return prev;
        const current = prev.extraLegends || [];
        if (current.includes(card.id)) return prev;
        const allowed = deckExtraLegendsRequired(prev, allCards) || 3;
        if (current.length >= allowed) {
          alert(`You choose ${allowed} extra legends. Remove one first.`);
          return prev;
        }
        const takenNames = [prev.legend, ...current]
          .map(id => legendNameKey(allCards.find(c => c.id === id)?.name))
          .filter(Boolean);
        if (takenNames.includes(legendNameKey(card.name))) {
          alert(`"${card.name}" is already one of your legends. The extra legends must all have different names, including from your starting legend.`);
          return prev;
        }
        return { ...prev, extraLegends: [...current, card.id] };
      }

      // Riftbound Legend / Champion, One Piece Leader (the legend slot)
      if (zone === 'legend' || zone === 'champion') {
        return { ...prev, [zone]: card.id };
      }

      const currentZoneKey = zone as 'mainDeck' | 'runeDeck' | 'battlefields' | 'sideboard';
      const currentCount = prev[currentZoneKey]?.[card.id] || 0;
      
      // Total copies of this card name across all zones must not exceed the game's limit
      let totalCopies = 0;
      
      const champ = allCards.find(x => x.id === prev.champion);
      if (champ && champ.name === card.name) totalCopies += 1;

      const countZone = (zoneMap: Record<string, number> | undefined) => {
        if (!zoneMap) return;
        Object.entries(zoneMap).forEach(([id, qty]) => {
          const c = allCards.find(x => x.id === id);
          if (c && c.name === card.name) totalCopies += qty;
        });
      };

      countZone(prev.mainDeck);
      countZone(prev.runeDeck);
      countZone(prev.battlefields);
      countZone(prev.sideboard);

      const limit = maxCopies(activeGame, card);
      if (totalCopies >= limit) {
        alert(`You can only have up to ${limit} copies of any unique card name per deck.`);
        return prev;
      }

      return {
        ...prev,
        [currentZoneKey]: {
          ...(prev[currentZoneKey] || {}),
          [card.id]: currentCount + 1
        }
      };
    });
  };


  const removeCard = (cardId: string, zone: keyof DeckState) => {
    setDeck(prev => {
      if (zone === 'extraLegends') {
        return { ...prev, extraLegends: (prev.extraLegends || []).filter(id => id !== cardId) };
      }

      if (zone === 'legend' || zone === 'champion') {
        return { ...prev, [zone]: null };
      }
      
      const currentZoneKey = zone as 'mainDeck' | 'runeDeck' | 'battlefields' | 'sideboard';
      const currentCount = prev[currentZoneKey]?.[cardId] || 0;
      if (currentCount <= 1) {
        const newZone = { ...(prev[currentZoneKey] || {}) };
        delete newZone[cardId];
        return { ...prev, [currentZoneKey]: newZone };
      }

      return {
        ...prev,
        [currentZoneKey]: {
          ...(prev[currentZoneKey] || {}),
          [cardId]: currentCount - 1
        }
      };
    });
  };

  const removeCardFromAnyZone = (cardId: string) => {
    setDeck(prev => {
      if (prev.extraLegends && prev.extraLegends.includes(cardId)) {
        return { ...prev, extraLegends: prev.extraLegends.filter(id => id !== cardId) };
      }
      if (prev.legend === cardId) return { ...prev, legend: null };
      if (prev.champion === cardId) return { ...prev, champion: null };

      for (const zone of ['mainDeck', 'runeDeck', 'battlefields', 'sideboard'] as const) {
        if (prev[zone] && prev[zone][cardId]) {
          const currentCount = prev[zone][cardId];
          if (currentCount <= 1) {
            const nextZone = { ...prev[zone] };
            delete nextZone[cardId];
            return { ...prev, [zone]: nextZone };
          } else {
            return {
              ...prev,
              [zone]: {
                ...prev[zone],
                [cardId]: currentCount - 1
              }
            };
          }
        }
      }
      return prev;
    });
  };

  const clearDeck = () => setDeck({ ...INITIAL_DECK, game: activeGame });

  const loadDeck = (newDeck: DeckState) => {
    setDeck({
      ...INITIAL_DECK,
      ...newDeck,
      game: activeGame,
      extraLegends: Array.isArray(newDeck.extraLegends) ? newDeck.extraLegends : [],
    });
  };

  return { deck, addCard, removeCard, removeCardFromAnyZone, clearDeck, loadDeck, loaded };
}
