import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PERSONAL_SETTINGS,
  DEFAULT_LIST_DEFAULTS,
  type NamedCollection,
  type PersonalCollectionSettings,
  normalizeCards,
} from '../src/lib/collectionDefaults';
import { rowToCollection } from '../src/lib/collectionsServer';

describe('Collection Sharing & Personal Settings', () => {
  it('provides sensible default personal settings with private visibility', () => {
    expect(DEFAULT_PERSONAL_SETTINGS).toEqual({
      name: 'Personal',
      is_public: false,
      description: '',
    });
  });

  it('normalizes named collection row with is_public from row or list_defaults', () => {
    const rowWithColumn = {
      id: 'coll-1',
      name: 'Trade Binder',
      cards: { '11111111-1111-1111-1111-111111111111': 2 },
      always_list: false,
      is_public: true,
      description: 'Public binder for local events',
      list_defaults: DEFAULT_LIST_DEFAULTS,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    };

    const coll = rowToCollection(rowWithColumn);
    expect(coll.is_public).toBe(true);
    expect(coll.description).toBe('Public binder for local events');
    expect(coll.cards['11111111-1111-1111-1111-111111111111']).toBe(2);
  });

  it('falls back to list_defaults.is_public when column is absent', () => {
    const rowWithNested = {
      id: 'coll-2',
      name: 'My Playsets',
      cards: { '22222222-2222-2222-2222-222222222222': 4 },
      always_list: false,
      list_defaults: { ...DEFAULT_LIST_DEFAULTS, is_public: true },
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    };

    const coll = rowToCollection(rowWithNested);
    expect(coll.is_public).toBe(true);
  });

  it('defaults is_public to false when not specified', () => {
    const rowPrivate = {
      id: 'coll-3',
      name: 'Secret Stash',
      cards: {},
      always_list: false,
      list_defaults: DEFAULT_LIST_DEFAULTS,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    };

    const coll = rowToCollection(rowPrivate);
    expect(coll.is_public).toBe(false);
  });

  it('correctly ignores metadata keys in card normalization', () => {
    const rawCards = {
      '33333333-3333-3333-3333-333333333333': 1,
      '44444444-4444-4444-4444-444444444444_foil': 3,
      '_meta': { is_public: true, name: 'Personal' },
      'invalid-key': 5,
    };

    const normalized = normalizeCards(rawCards);
    expect(normalized['33333333-3333-3333-3333-333333333333']).toBe(1);
    expect(normalized['44444444-4444-4444-4444-444444444444_foil']).toBe(3);
    expect(normalized['_meta']).toBeUndefined();
    expect(normalized['invalid-key']).toBeUndefined();
  });
});
