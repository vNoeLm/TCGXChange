import {
  FAB_CLASSES,
  LORCANA_CLASSIFICATIONS,
  ONEPIECE_TYPES,
  STARWARS_TRAITS,
  TAGS,
} from './constants';

export const CUSTOM_CARD_TAGS_KEY = 'custom_card_tags';

export function getDefaultTagsForGame(game: string): string[] {
  switch ((game || 'riftbound').toLowerCase()) {
    case 'riftbound':
      return [...TAGS];
    case 'onepiece':
      return [...ONEPIECE_TYPES];
    case 'lorcana':
      return [...LORCANA_CLASSIFICATIONS];
    case 'starwars':
      return [...STARWARS_TRAITS];
    case 'fab':
      return [...FAB_CLASSES];
    default:
      return [];
  }
}

export function normalizeTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<string, string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const clean = entry.trim().replace(/\s+/g, ' ');
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, clean);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export function mergeTagsForGame(
  game: string,
  customRegistry: Record<string, string[]> | null | undefined,
  cards: Array<{ game?: string | null; tags?: unknown }> = []
): string[] {
  const g = (game || 'riftbound').toLowerCase();
  const seen = new Map<string, string>();

  const add = (val: string) => {
    const clean = val.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const lower = clean.toLowerCase();
    if (!seen.has(lower)) seen.set(lower, clean);
  };

  for (const t of getDefaultTagsForGame(g)) add(t);

  const customForGame = customRegistry && Array.isArray(customRegistry[g]) ? customRegistry[g] : [];
  for (const t of customForGame) {
    if (typeof t === 'string') add(t);
  }

  for (const c of cards) {
    if ((c.game || 'riftbound').toLowerCase() !== g) continue;
    if (Array.isArray(c.tags)) {
      for (const t of c.tags) {
        if (typeof t === 'string') add(t);
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
