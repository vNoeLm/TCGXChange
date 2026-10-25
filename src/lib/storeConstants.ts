import type { StoreProductCategory, StoreVariantKind } from '../types';
import { GAMES } from './constants';

export interface StoreCategoryDef {
  id: StoreProductCategory;
  label: string;
  label_hu?: string;
  description: string;
}

export const STORE_CATEGORIES: StoreCategoryDef[] = [
  { id: 'sealed', label: 'Sealed TCG', label_hu: 'Bontatlan termékek', description: 'Booster Boxes, Packs, Vaults, Bundles & Starter Decks' },
  { id: 'sleeves', label: 'Card Sleeves', label_hu: 'Kártyavédők (Sleeves)', description: 'Standard, Japanese, Outer & Inner Perfect Fit' },
  { id: 'deck_boxes', label: 'Deck Boxes', label_hu: 'Paklitartók (Deck Box)', description: 'Boulder, Sidewinder, Flip n Tray & Deck Cases' },
  { id: 'binders', label: 'Binders & Albums', label_hu: 'Albumok és mappák', description: 'Zipfolios, 9-pocket, 12-pocket & Pocket Pages' },
  { id: 'playmats', label: 'Playmats & Tubes', label_hu: 'Játszószőnyegek (Playmat)', description: 'Gaming playmats, custom art mats & storage tubes' },
  { id: 'protection', label: 'Toploaders & Cases', label_hu: 'Toploaderek és védelem', description: 'Toploaders, Magnetic One-Touch & Display stands' },
  { id: 'storage', label: 'Storage & Boxes', label_hu: 'Tárolódobozok és archívumok', description: 'Arkhive, Superhive, Card boxes & Vault storage' },
  { id: 'dice', label: 'Dice & Counters', label_hu: 'Dobókockák és jelölők', description: 'Dice sets, damage counters, tokens & life trackers' },
  { id: 'accessories', label: 'Accessories', label_hu: 'Kiegészítők', description: 'Dividers, bands, cleaning supplies & other accessories' },
  { id: 'other', label: 'Other', label_hu: 'Egyéb kiegészítők', description: 'Miscellaneous TCG supplies & collectibles' },
];

export const STORE_SUBCATEGORIES_BY_CATEGORY: Record<string, string[]> = {
  sealed: ['Booster Display', 'Booster Pack', 'Vault', 'Starter Deck', 'Bundle'],
  sleeves: ['Standard Sleeves', 'Japanese Sleeves', 'Inner / Perfect Fit', 'Outer Sleeves', 'Art Sleeves'],
  deck_boxes: ['Deck Box (80+)', 'Deck Box (100+)', 'Double Deck Box (133+)', 'Storage Deck Case (200+)'],
  binders: ['9-Pocket Binder', '12-Pocket Binder', '4-Pocket Binder', 'Pocket Pages'],
  playmats: ['Playmat', 'Playmat Tube', '2-Player Playmat'],
  protection: ['Toploader', 'Magnetic One-Touch', 'Semi-Rigid / Card Saver', 'Team Bags', 'Display Stand'],
  storage: ['Card Storage Box', 'Mass Storage / Hive', 'Dividers'],
  dice: ['Dice Set', 'Counters & Tokens', 'Life Pad / Tracker'],
  accessories: ['Dividers', 'Bands & Straps', 'Cleaning & Care'],
};

export const STORE_BRANDS = [
  'Ultimate Guard',
  'Dragon Shield',
  'Gamegenic',
  'Ultra PRO',
  'KMC',
  'Bandai',
  'Ravensburger',
  'Wizards of the Coast',
  'Fantasy Flight Games',
  'Legend Story Studios',
  'Riot Games',
  'Other',
] as const;

export const STORE_GAMES = [
  { id: 'universal', name: 'Universal / Supplies (All Games)' },
  ...GAMES.map((g) => ({ id: g.id, name: g.name })),
];

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * The shop is hidden from everyone but admins until this is flipped to true. It is enforced in the
 * API too (not just the page), so the catalogue cannot be read by calling the endpoint directly.
 */
export const STORE_PUBLIC_LAUNCH = true;

export const STORE_VARIANT_KINDS: { id: StoreVariantKind; label: string }[] = [
  { id: 'language', label: 'Language' },
  { id: 'color', label: 'Color' },
  { id: 'set', label: 'Set' },
  { id: 'size', label: 'Size' },
  { id: 'other', label: 'Option' },
];

export const STORE_STATUSES = ['draft', 'active', 'archived', 'out_of_stock'] as const;

/** Stable, unique URL slug: the name (+ option) plus the SKU when there is one, else a random suffix. */
export function buildProductSlug(name: string, sku?: string | null, variantLabel?: string | null): string {
  const base = slugify([name, variantLabel].filter(Boolean).join(' ')) || 'product';
  const suffix = sku ? slugify(sku) : Math.random().toString(36).substring(2, 7);
  return suffix ? `${base}-${suffix}` : base;
}

/** Rows per import request. Kept small: each update is its own outbound request and Workers cap those. */
export const IMPORT_BATCH_SIZE = 40;
