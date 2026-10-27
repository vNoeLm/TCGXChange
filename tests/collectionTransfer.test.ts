import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCollectionOptions,
  getCardsOfCollection,
  getCollectionName,
  executeCollectionTransfer,
} from '../src/lib/collectionTransfer';
import { PERSONAL_COLLECTION_ID, type NamedCollection } from '../src/lib/collectionDefaults';

vi.mock('../src/lib/collectionsStore', () => ({
  setCollectionCards: vi.fn(),
}));

import { setCollectionCards } from '../src/lib/collectionsStore';

describe('collectionTransfer utils', () => {
  const named: NamedCollection[] = [
    {
      id: 'coll-1',
      name: 'Trade Binder',
      cards: { card_a: 2, card_b: 1 },
      always_list: false,
      list_defaults: {
        condition: 'Near Mint',
        price_mode: 'market',
        base_price_huf: 100,
        skip_unpriced: false,
        price_adjust_pct: 0,
        min_price_huf: 0,
        keep_copies: 0,
        handover_methods: ['personal'],
      },
    },
    {
      id: 'coll-2',
      name: 'Store Inventory',
      cards: { card_c: 5 },
      always_list: true,
      list_defaults: {
        condition: 'Near Mint',
        price_mode: 'market',
        base_price_huf: 100,
        skip_unpriced: false,
        price_adjust_pct: 0,
        min_price_huf: 0,
        keep_copies: 0,
        handover_methods: ['personal'],
      },
    },
  ];

  const personalCards = {
    card_a: 4,
    card_d: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCollectionOptions', () => {
    it('always includes Personal and maps named collections', () => {
      const opts = getCollectionOptions(named);
      expect(opts).toEqual([
        { id: PERSONAL_COLLECTION_ID, name: 'Personal' },
        { id: 'coll-1', name: 'Trade Binder' },
        { id: 'coll-2', name: 'Store Inventory' },
      ]);
    });
  });

  describe('getCardsOfCollection', () => {
    it('returns personalCards for personal ID', () => {
      expect(getCardsOfCollection(PERSONAL_COLLECTION_ID, personalCards, named)).toBe(personalCards);
    });

    it('returns named collection cards when found', () => {
      expect(getCardsOfCollection('coll-1', personalCards, named)).toEqual({ card_a: 2, card_b: 1 });
    });

    it('returns empty object if collection not found', () => {
      expect(getCardsOfCollection('non-existent', personalCards, named)).toEqual({});
    });
  });

  describe('getCollectionName', () => {
    it('returns Personal for personal ID', () => {
      expect(getCollectionName(PERSONAL_COLLECTION_ID, named)).toBe('Personal');
    });

    it('returns collection name for named ID', () => {
      expect(getCollectionName('coll-1', named)).toBe('Trade Binder');
    });

    it('returns fallback collection if not found', () => {
      expect(getCollectionName('unknown', named)).toBe('collection');
    });
  });

  describe('executeCollectionTransfer', () => {
    it('returns false early when moves are empty or fromId equals toId', async () => {
      const applyPersonal = vi.fn();
      const pricesFor = vi.fn();
      const onToast = vi.fn();

      const ok1 = await executeCollectionTransfer({
        fromId: 'personal',
        toId: 'personal',
        moves: { card_a: 1 },
        personalCards,
        named,
        applyPersonal,
        pricesFor,
        onToast,
      });
      expect(ok1).toBe(false);

      const ok2 = await executeCollectionTransfer({
        fromId: 'personal',
        toId: 'coll-1',
        moves: { card_a: 0 },
        personalCards,
        named,
        applyPersonal,
        pricesFor,
        onToast,
      });
      expect(ok2).toBe(false);
    });

    it('transfers from Personal to Named collection successfully', async () => {
      vi.mocked(setCollectionCards).mockResolvedValue(true);
      const applyPersonal = vi.fn();
      const pricesFor = vi.fn().mockReturnValue({});
      const onToast = vi.fn();

      const ok = await executeCollectionTransfer({
        fromId: PERSONAL_COLLECTION_ID,
        toId: 'coll-1',
        moves: { card_a: 2 },
        personalCards,
        named,
        applyPersonal,
        pricesFor,
        onToast,
        successMessage: 'Moved 2x card_a',
      });

      expect(ok).toBe(true);
      // Target (coll-1) received increment: 2 + 2 = 4
      expect(setCollectionCards).toHaveBeenCalledWith('coll-1', { card_a: 4, card_b: 1 }, {});
      // Source (personal) received decrement: 4 - 2 = 2
      expect(applyPersonal).toHaveBeenCalledWith({ card_a: 2, card_d: 1 });
      expect(onToast).toHaveBeenCalledWith('Moved 2x card_a', 'success');
    });

    it('removes keys that reach 0 when transferring from Personal', async () => {
      vi.mocked(setCollectionCards).mockResolvedValue(true);
      const applyPersonal = vi.fn();
      const pricesFor = vi.fn().mockReturnValue({});
      const onToast = vi.fn();

      const ok = await executeCollectionTransfer({
        fromId: PERSONAL_COLLECTION_ID,
        toId: 'coll-1',
        moves: { card_d: 1 },
        personalCards,
        named,
        applyPersonal,
        pricesFor,
        onToast,
      });

      expect(ok).toBe(true);
      // card_d had 1 copy, moving 1 leaves 0, so key is deleted
      expect(applyPersonal).toHaveBeenCalledWith({ card_a: 4 });
    });

    it('transfers from Named collection to Personal successfully', async () => {
      vi.mocked(setCollectionCards).mockResolvedValue(true);
      const applyPersonal = vi.fn();
      const pricesFor = vi.fn();
      const onToast = vi.fn();

      const ok = await executeCollectionTransfer({
        fromId: 'coll-1',
        toId: PERSONAL_COLLECTION_ID,
        moves: { card_b: 1 },
        personalCards,
        named,
        applyPersonal,
        pricesFor,
        onToast,
      });

      expect(ok).toBe(true);
      // Target (Personal) incremented: card_b was not present, now 1
      expect(applyPersonal).toHaveBeenCalledWith({ card_a: 4, card_d: 1, card_b: 1 });
      // Source (coll-1) decremented: card_b was 1, moving 1 leaves 0
      expect(setCollectionCards).toHaveBeenCalledWith('coll-1', { card_a: 2 });
    });

    it('computes prices for always_list collections', async () => {
      vi.mocked(setCollectionCards).mockResolvedValue(true);
      const applyPersonal = vi.fn();
      const pricesFor = vi.fn().mockReturnValue({ card_a: 1500 });
      const onToast = vi.fn();

      const ok = await executeCollectionTransfer({
        fromId: PERSONAL_COLLECTION_ID,
        toId: 'coll-2', // always_list is true
        moves: { card_a: 1 },
        personalCards,
        named,
        applyPersonal,
        pricesFor,
        onToast,
      });

      expect(ok).toBe(true);
      expect(pricesFor).toHaveBeenCalledWith(named[1], named[1].list_defaults, { card_a: 1 });
      expect(setCollectionCards).toHaveBeenCalledWith('coll-2', { card_c: 5, card_a: 1 }, { card_a: 1500 });
    });
  });
});
