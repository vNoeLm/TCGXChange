export const GAMES = [
  { id: 'riftbound', name: 'Riftbound', active: true },
  { id: 'mtg', name: 'Magic: The Gathering', active: true },
  { id: 'onepiece', name: 'One Piece Card Game', active: true },
  { id: 'lorcana', name: 'Disney Lorcana', active: true },
  { id: 'starwars', name: 'Star Wars: Unlimited', active: true },
  { id: 'fab', name: 'Flesh and Blood', active: true },
];

export const CATEGORIES = [
  { id: 'singles', label: 'Singles', icon: '' },
  { id: 'sealed', label: 'Sealed Product', icon: '' },
] as const;

export const SEALED_PRODUCT_TYPES = [
  'Booster Box',
  'Booster Pack',
  'Starter Deck',
  'Bundle',
  'Elite Trainer Box',
  'Tin / Collection Box',
];

// ─── Magic: The Gathering Constants ──────────────────────────────────
export const MTG_RARITIES = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Special', 'Bonus'];
export const MTG_TYPES = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land', 'Battle'];

// ─── One Piece Card Game Constants ───────────────────────────────────
export const ONEPIECE_RARITIES = ['Common', 'Uncommon', 'Rare', 'Super Rare', 'Secret Rare', 'Leader', 'Treasure Rare', 'Promo'];
export const ONEPIECE_TYPES = ['Leader', 'Character', 'Event', 'Stage'];
export const ONEPIECE_COLORS = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];

// ─── Disney Lorcana Constants ──────────────────────────────────────
export const LORCANA_RARITIES = ['Common', 'Uncommon', 'Rare', 'Super Rare', 'Legendary', 'Enchanted', 'Special'];
export const LORCANA_TYPES = ['Character', 'Action', 'Item', 'Location'];
export const LORCANA_INKS = ['Amber', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Steel'];

// ─── Star Wars: Unlimited Constants ─────────────────────────────────
export const STARWARS_RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Special'];
export const STARWARS_TYPES = ['Unit', 'Event', 'Upgrade', 'Leader', 'Base'];
export const STARWARS_ASPECTS = ['Vigilance', 'Command', 'Aggression', 'Cunning', 'Villainy', 'Heroism'];

// ─── Flesh and Blood Constants ─────────────────────────────────────
export const FAB_RARITIES = ['Common', 'Rare', 'Super Rare', 'Majestic', 'Legendary', 'Fabled', 'Token'];
export const FAB_TYPES = ['Action', 'Attack Reaction', 'Defense Reaction', 'Instant', 'Equipment', 'Weapon', 'Hero', 'Resource', 'Ally', 'Aura', 'Item', 'Block'];
export const FAB_CLASSES = ['Generic', 'Brute', 'Guardian', 'Ninja', 'Warrior', 'Mechanologist', 'Ranger', 'Runeblade', 'Wizard', 'Illusionist', 'Assassin', 'Necromancer'];

// ─── Riftbound Constants ──────────────────────────────────────────
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase'];
export const TYPES = ['Unit', 'Champion', 'Spell', 'Signature Spell', 'Gear', 'Battlefield', 'Legend', 'Rune', 'Token'];
// Main sets in release order, oldest first (Origins Oct 2025, Spiritforged Feb 2026, Unleashed May
// 2026, Vendetta Jul 2026, Radiance Oct 2026), then the extras. Set pickers sort by this - see sortSetNames.
export const SETS = ['Origins', 'Spiritforged', 'Unleashed', 'Vendetta', 'Radiance', 'Proving Grounds', 'Promo'];
/** Not main sets: starter products and promos, listed after every main set. */
const EXTRA_SET_NAMES = ['Proving Grounds', 'Promo'];
export const DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'Colorless'];
export const TAGS = ["Ahri","Akali","Akshan","Ambessa","Anivia","Annie","Aphelios","Ashe","Azir","Bandle City","Bard","Bilgewater","Bird","Blitzcrank","Bomb","Caitlyn","Cat","Darius","Demacia","Demon","Diana","Dog","Dr. Mundo","Dragon","Draven","Ekko","Elite","Equipment","Evelynn","Ezreal","Fae","Fiora","Fizz","Freljord","Galio","Gangplank","Garen","Graves","Heimerdinger","Hwei","Icathia","Illaoi","Ionia","Irelia","Ivern","Ixtal","Janna","Jarvan IV","Jax","Jayce","Jhin","Jinx","K'Sante","Kai'Sa","Karma","Karthus","Katarina","Kathkan","Kayle","Kayn","Kennen","Kha'Zix","Kog'Maw","LeBlanc","Lee Sin","Leona","Lillia","Lucian","Lulu","Lux","Malzahar","Master Yi","Mech","Mel","Miss Fortune","Mordekaiser","Morgana","Mount Targon","Nami","Nasus","Neeko","Nidalee","Nilah","Nocturne","Noxus","Orianna","Ornn","Piltover","Pirate","Poppy","Poro","Pyke","Qiyana","Recruit","Rek'Sai","Rell","Renata Glasc","Renekton","Rengar","Riven","Rumble","Sentinel","Seraphine","Sett","Shadow Isles","Shen","Shurima","Sivir","Sona","Soraka","Spider","Spirit","Swain","Syndra","Taric","Teemo","The Void","Trifarian","Tryndamere","Twisted Fate","Udyr","Vayne","Vex","Vi","Viktor","Volibear","Warwick","Xerath","Xin Zhao","Yasuo","Yone","Yordle","Yuumi","Zaun","Zed","Ziggs","Zilean"];

const isExtraSet = (name: string) =>
  EXTRA_SET_NAMES.includes(name) || /promo|starter deck|proving grounds/i.test(name);

/**
 * Set names for a picker: main sets oldest to newest, then extras (starter products, promos).
 * A set not in the lists above yet - a new release - goes after the known main sets, before the
 * extras. Every set picker (catalog, marketplace, deck builder, binder) uses this, so none of them
 * shows sets in whatever order the cards happened to come back in.
 */
export function sortSetNames(names: string[]): string[] {
  const known = SETS;
  const rank = (name: string) => {
    const i = known.indexOf(name);
    if (isExtraSet(name)) return 2000 + (i >= 0 ? i : 999);
    return i >= 0 ? i : 1000;
  };
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// ─── Storage Keys ─────────────────────────────────────────────────
/** Centralized localStorage / sessionStorage key registry. */
export const STORAGE_KEYS = {
  ACTIVE_GAME:         'tcg_active_game',
  CART:                'tcg-cart',
  CART_EXPIRY:         'tcg-cart-expiry',
  CHECKOUT_INFO:       'tcg-checkout-info',
  ORDERS:              'tcg-orders',
  LANG:                'tcg-lang',
  THEME_OVERRIDE:      'tcg-theme-override',
  INVENTORY_FILTERS:   'inventoryFilters',
  INVENTORY_SEARCH:    'inventorySearchQuery',
  INVENTORY_SORT:      'inventorySortMode',
  INVENTORY_GRID:      'inventoryGridSize',
  CATALOG_GAME:        'catalogGame',
} as const;

// ─── Custom Event Names ────────────────────────────────────────────
/** Centralized CustomEvent name registry. */
export const EVENTS = {
  GAME_CHANGE:          'tcg-game-change',
  CART_CHANGED:         'tcg-cart-changed',
  ORDERS_CHANGED:       'tcg-orders-changed',
  STORE_INVENTORY_CHANGE: 'tcg-store-inventory-change',
  SETTINGS_CHANGED:     'tcg-settings-changed',
} as const;

// ─── Sort Modes ────────────────────────────────────────────────────
export const SORT_MODES = [
  'Price (Low to High)',
  'Price (High to Low)',
  'Most Liked',
  'Quantity (High to Low)',
  'Quantity (Low to High)',
  'Card Number (Asc)',
  'Card Number (Desc)',
  'Rarity (High to Low)',
  'Rarity (Low to High)',
  'Name (A to Z)',
  'Name (Z to A)',
] as const;

export type SortMode = typeof SORT_MODES[number];

// ─── Platform Store Owner ──────────────────────────────────────────
export const OWNER_ID = 'd47ca466-6520-46ec-aff2-718732f1baf7';
