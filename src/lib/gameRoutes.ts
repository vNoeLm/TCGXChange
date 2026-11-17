import { GAMES } from './constants';

export const GAME_META: Record<string, { title: string; description: string }> = {
  riftbound: {
    title: 'TCG XChange — Riftbound Card Catalog, Collection Tracker & Deck Builder',
    description:
      'Browse the Riftbound card catalog and live Cardmarket prices, manage multiple collections, build decks, and organize your binder on TCG XChange.',
  },
  onepiece: {
    title: 'TCG XChange — One Piece Card Game Catalog & Collection Tracker',
    description:
      'Browse the One Piece Card Game catalog and live Cardmarket prices, filter by Color, Cost, Power, Counter & Type, and track your collection on TCG XChange.',
  },
  lorcana: {
    title: 'TCG XChange — Disney Lorcana Card Catalog & Collection Tracker',
    description:
      'Browse the Disney Lorcana card catalog and live Cardmarket prices, filter by Ink Color, Inkable, Ability, Classification, Strength, Willpower & Lore, and track your collection on TCG XChange.',
  },
};

export function isActiveGameId(gameId?: string | null): gameId is string {
  if (!gameId) return false;
  return GAMES.some((g) => g.id === gameId && g.active !== false);
}

export function resolveGameFromPath(pathname?: string | null): string | null {
  if (!pathname) return null;
  const seg = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!seg || seg.includes('/')) return null;
  return isActiveGameId(seg) ? seg : null;
}

export function isCatalogPath(pathname?: string | null): boolean {
  if (!pathname) return false;
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  return trimmed === '/' || resolveGameFromPath(pathname) !== null;
}

export function catalogPathForGame(gameId?: string | null): string {
  return isActiveGameId(gameId) ? `/${gameId}` : '/';
}
