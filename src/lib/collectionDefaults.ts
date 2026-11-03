import { ALL_HANDOVER_IDS } from './handover';

/**
 * Named collections, as the browser and the server both see them. "personal" is the original
 * collection (kept in the browser and synced); everything else is a named one stored on the server.
 */

export const PERSONAL_COLLECTION_ID = 'personal';
export const MAX_COLLECTIONS = 20;
export const MAX_COLLECTION_NAME = 60;

/** How an always-list collection lists a card it gets. */
export interface ListDefaults {
  condition: string;
  /** One fixed price, or each card's market price / estimated value. */
  price_mode: 'fixed' | 'market' | 'estimate';
  /** The fixed price, or the fallback for a card without market data. */
  base_price_huf: number;
  /** When true (and price_mode !== 'fixed'), cards with no market/estimated price are not listed. */
  skip_unpriced: boolean;
  /** Added to a market / estimated price, so -10 lists 10% under it. */
  price_adjust_pct: number;
  /** A market / estimated price is never lower than this. */
  min_price_huf: number;
  /** Number of copies of each card to keep unlisted for personal play/collection (0 = list all). */
  keep_copies: number;
  /** @deprecated Removed to prevent artificial scarcity */
  max_list_qty?: number;
  handover_methods: string[];
  is_public?: boolean;
}

export const DEFAULT_LIST_DEFAULTS: ListDefaults = {
  condition: 'Near Mint',
  price_mode: 'market',
  base_price_huf: 100,
  skip_unpriced: false,
  price_adjust_pct: 0,
  min_price_huf: 0,
  keep_copies: 0,
  max_list_qty: 0,
  handover_methods: ['personal'],
  is_public: false,
};

export const LISTING_CONDITIONS = ['Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
export function formatCondition(condition?: string | null, lang: string = 'en'): string {
  if (!condition) return 'Near Mint';
  if (lang !== 'hu') return condition;
  switch (condition) {
    case 'Mint':
      return 'Mint (Tökéletes)';
    case 'Near Mint':
      return 'Near Mint (Újszerű)';
    case 'Lightly Played':
      return 'Lightly Played (Enyhén játszott)';
    case 'Moderately Played':
      return 'Moderately Played (Közepesen játszott)';
    case 'Heavily Played':
      return 'Heavily Played (Erősen játszott)';
    case 'Damaged':
      return 'Damaged (Sérült)';
    case 'Mixed / Played':
      return 'Vegyes / Játszott';
    default:
      return condition;
  }
}


export interface PersonalCollectionSettings {
  name: string;
  is_public: boolean;
  description?: string;
}

export const DEFAULT_PERSONAL_SETTINGS: PersonalCollectionSettings = {
  name: 'Personal',
  is_public: false,
  description: '',
};

export const PERSONAL_SETTINGS_STORAGE_KEY = 'tcg_personal_collection_settings';

export interface NamedCollection {
  id: string;
  name: string;
  cards: Record<string, number>;
  always_list: boolean;
  is_public?: boolean;
  description?: string;
  list_defaults: ListDefaults & { is_public?: boolean; is_personal?: boolean; description?: string };
  created_at: string;
  updated_at: string;
}

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeListDefaults(raw: unknown): ListDefaults {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const methods = Array.isArray(o.handover_methods)
    ? o.handover_methods.filter((m: unknown) => typeof m === 'string' && (ALL_HANDOVER_IDS as string[]).includes(m))
    : [];
  return {
    condition: LISTING_CONDITIONS.includes(o.condition) ? o.condition : DEFAULT_LIST_DEFAULTS.condition,
    price_mode: o.price_mode === 'fixed' || o.price_mode === 'estimate' ? o.price_mode : 'market',
    base_price_huf: int(o.base_price_huf, 1, 10_000_000, DEFAULT_LIST_DEFAULTS.base_price_huf),
    skip_unpriced: Boolean(o.skip_unpriced),
    price_adjust_pct: int(o.price_adjust_pct, -90, 500, 0),
    min_price_huf: int(o.min_price_huf, 0, 10_000_000, 0),
    keep_copies: int(o.keep_copies, 0, 99, 0),
    max_list_qty: 0,
    handover_methods: methods.length ? methods : DEFAULT_LIST_DEFAULTS.handover_methods,
  };
}

/** Counts cleaned up: whole numbers from 1 to 9999, nothing else. */
export function normalizeCards(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string' || !/^[0-9a-f-]{36}(_foil)?$/i.test(key)) continue;
    const n = int(value, 0, 9999, 0);
    if (n > 0) out[key] = n;
  }
  return out;
}

/**
 * The price an always-list collection lists a card at, from its defaults and the card's values.
 * Returns 0 when `skip_unpriced` is enabled and no reference price exists.
 */
export function defaultListPrice(defaults: ListDefaults, values: { marketHuf: number | null; estimateHuf: number | null }): number {
  const fallback = Math.max(1, Math.round(defaults.base_price_huf || 100));
  if (defaults.price_mode === 'fixed') return fallback;
  const ref = defaults.price_mode === 'estimate'
    ? (values.estimateHuf ?? values.marketHuf)
    : values.marketHuf;
  if (ref === null || !Number.isFinite(ref) || ref <= 0) {
    return defaults.skip_unpriced ? 0 : fallback;
  }
  const adjusted = Math.round(ref * (1 + (defaults.price_adjust_pct || 0) / 100));
  return Math.max(1, Math.round(defaults.min_price_huf || 0), adjusted);
}
