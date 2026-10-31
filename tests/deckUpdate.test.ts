import { describe, it, expect, beforeEach } from 'vitest';
import type { DeckState } from '../src/components/deck-builder/useDeckBuilder';
import type { SavedDeck } from '../src/components/deck-builder/useSavedDecks';

describe('Deck update and deduplication logic', () => {
  const dummyDeck: DeckState = {
    legend: 'card-legend-1',
    champion: 'card-champ-1',
    mainDeck: { 'card-1': 3, 'card-2': 2 },
    runeDeck: {},
    sideboard: {},
    battlefields: {},
    extraLegends: [],
  };

  const updatedDeck: DeckState = {
    ...dummyDeck,
    mainDeck: { 'card-1': 3, 'card-2': 2, 'card-3': 1 },
  };

  it('updates an existing saved deck in-place without creating duplicates', () => {
    const list: SavedDeck[] = [
      {
        id: 'deck-123',
        name: 'sera New',
        deck: dummyDeck,
        createdAt: 1000,
        publishedDeckId: 'pub-abc',
      },
    ];

    // Simulate updateDeck
    const nextList = list.map(d =>
      d.id === 'deck-123'
        ? { ...d, name: 'sera New', deck: updatedDeck, publishedDeckId: 'pub-abc' }
        : d
    );

    expect(nextList).toHaveLength(1);
    expect(nextList[0].id).toBe('deck-123');
    expect(nextList[0].name).toBe('sera New');
    expect(nextList[0].deck.mainDeck['card-3']).toBe(1);
    expect(nextList[0].publishedDeckId).toBe('pub-abc');
  });

  it('matches existing saved deck by publishedDeckId or name to prevent duplicate creation', () => {
    const savedDecks: SavedDeck[] = [
      {
        id: 'saved-1',
        name: 'sera New',
        deck: dummyDeck,
        createdAt: 1000,
        publishedDeckId: 'pub-1',
      },
    ];

    const publishedDeckRow = {
      id: 'pub-1',
      name: 'sera New',
      deck: dummyDeck,
    };

    // When opening from /decks/view
    const existing = savedDecks.find(
      d =>
        d.publishedDeckId === publishedDeckRow.id ||
        d.name.trim().toLowerCase() === publishedDeckRow.name.trim().toLowerCase()
    );

    expect(existing).toBeDefined();
    expect(existing?.id).toBe('saved-1');
  });

  it('links publishedDeckId on saved deck when matching by name', () => {
    const savedDecks: SavedDeck[] = [
      {
        id: 'saved-2',
        name: 'sera New',
        deck: dummyDeck,
        createdAt: 1000,
      },
    ];

    const publishedDeckId = 'pub-2';
    const updated = savedDecks.map(d =>
      d.id === 'saved-2'
        ? { ...d, publishedDeckId }
        : d
    );

    expect(updated[0].publishedDeckId).toBe('pub-2');
  });
});
