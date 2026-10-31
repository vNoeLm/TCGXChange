import { useState, useEffect } from 'react';
import type { DeckState } from './useDeckBuilder';
import type { CatalogCard } from '../../types';
import { parseDeckInput, type ImportResult } from './deckSerializer';
import { gameStorageKey, type GameId } from '../../lib/deckRules';

export interface SavedDeck {
  id: string;
  name: string;
  deck: DeckState;
  createdAt: number;
  publishedDeckId?: string;
  publishedAt?: number;
}

export function useSavedDecks(activeGame: GameId = 'riftbound') {
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([]);
  // Key whose decks are currently in state; see useDeckBuilder for why this isn't a boolean.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const storageKey = gameStorageKey(activeGame, 'saved_decks');
  const loaded = loadedKey === storageKey;

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        setSavedDecks(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved decks', e);
        setSavedDecks([]);
      }
    } else {
      setSavedDecks([]);
    }
    setLoadedKey(storageKey);
  }, [activeGame, storageKey]);

  useEffect(() => {
    if (loaded) {
      localStorage.setItem(storageKey, JSON.stringify(savedDecks));
    }
  }, [savedDecks, loaded, storageKey]);

  const saveDeck = (name: string, deck: DeckState, publishedDeckId?: string) => {
    const newDeck: SavedDeck = {
      id: crypto.randomUUID(),
      name,
      deck: { ...deck, game: activeGame },
      createdAt: Date.now(),
      ...(publishedDeckId ? { publishedDeckId } : {}),
    };
    const saved = localStorage.getItem(storageKey);
    let currentList: SavedDeck[] = [];
    try {
      currentList = saved ? JSON.parse(saved) : [];
    } catch {
      currentList = [];
    }
    const next = [...currentList, newDeck];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (e) {
      console.error('Failed to save to localStorage', e);
    }
    setSavedDecks(next);
    return newDeck;
  };

  const updateDeck = (id: string, deck: DeckState, name?: string, publishedDeckId?: string) => {
    const saved = localStorage.getItem(storageKey);
    let currentList: SavedDeck[] = [];
    try {
      currentList = saved ? JSON.parse(saved) : [];
    } catch {
      currentList = [];
    }
    const next = currentList.map(d => (
      d.id === id ? {
        ...d,
        name: name?.trim() || d.name,
        deck: { ...deck, game: activeGame },
        ...(publishedDeckId !== undefined ? { publishedDeckId } : {}),
      } : d
    ));
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (e) {
      console.error('Failed to update in localStorage', e);
    }
    setSavedDecks(next);
  };

  const deleteDeck = (id: string) => {
    const saved = localStorage.getItem(storageKey);
    let currentList: SavedDeck[] = [];
    try {
      currentList = saved ? JSON.parse(saved) : [];
    } catch {
      currentList = [];
    }
    const next = currentList.filter(d => d.id !== id);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (e) {
      console.error('Failed to delete from localStorage', e);
    }
    setSavedDecks(next);
  };

  const importDecksBatch = (newDecks: SavedDeck[]) => {
    setSavedDecks(prev => {
      const map = new Map(prev.map(d => [d.id, d]));
      newDecks.forEach(d => map.set(d.id, d));
      const next = Array.from(map.values());
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch (e) {
        console.error('Failed to batch save to localStorage', e);
      }
      return next;
    });
  };

  const importDeck = (content: string, allCards: CatalogCard[]): ImportResult => {
    const result = parseDeckInput(content, allCards);
    if (result.type === 'multi') {
      importDecksBatch(result.decks);
    } else if (result.type === 'single') {
      // Also automatically save the imported single deck to saved decks
      saveDeck(result.name, result.deck);
    }
    return result;
  };

  return { savedDecks, saveDeck, updateDeck, deleteDeck, importDeck, importDecksBatch, loaded };
}
