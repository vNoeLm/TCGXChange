import { GAMES } from './constants';
import type { UserRole } from '../types';

export const MODERATOR_GAMES = GAMES.map((g) => ({
  id: g.id,
  name: g.name,
  shortName:
    g.id === 'riftbound'
      ? 'Riftbound'
      : g.id === 'onepiece'
      ? 'One Piece'
      : g.id === 'lorcana'
      ? 'Lorcana'
      : g.id === 'starwars'
      ? 'Star Wars'
      : g.id === 'fab'
      ? 'FaB'
      : g.id === 'mtg'
      ? 'MTG'
      : g.name,
}));

export const VALID_MODERATOR_GAME_IDS = new Set<string>(GAMES.map((g) => g.id));

export function normalizeModeratorGames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const id = String(item || '').trim().toLowerCase();
    if (!id || !VALID_MODERATOR_GAME_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function getGameShortName(gameId: string): string {
  const norm = (gameId || '').trim().toLowerCase();
  const found = MODERATOR_GAMES.find((g) => g.id === norm);
  if (found) return found.shortName;
  return norm ? norm.charAt(0).toUpperCase() + norm.slice(1) : 'Unknown';
}

export function getGameDisplayName(gameId: string): string {
  const norm = (gameId || '').trim().toLowerCase();
  const found = GAMES.find((g) => g.id === norm);
  return found ? found.name : getGameShortName(norm);
}

export function formatModeratorRoleLabel(gameId: string, lang: 'en' | 'hu' = 'en'): string {
  const name = getGameShortName(gameId);
  return lang === 'hu' ? `${name} Moderátor` : `${name} Moderator`;
}

export interface RoleCheckSubject {
  role?: string | null;
  is_owner?: boolean | null;
  is_admin?: boolean | null;
  is_moderator?: boolean | null;
  moderator_games?: unknown;
  is_banned?: boolean | null;
}

export function getEffectiveRole(subject: RoleCheckSubject | null | undefined): UserRole {
  if (!subject) return 'user';
  if (subject.is_owner || subject.role === 'owner') return 'owner';
  if (subject.is_admin || subject.role === 'admin') return 'admin';
  const games = normalizeModeratorGames(subject.moderator_games);
  if (subject.is_moderator || subject.role === 'moderator' || games.length > 0) return 'moderator';
  return 'user';
}

export function isProfileOwner(subject: RoleCheckSubject | null | undefined): boolean {
  return getEffectiveRole(subject) === 'owner';
}

export function isProfileModerator(subject: RoleCheckSubject | null | undefined): boolean {
  return getEffectiveRole(subject) === 'moderator';
}

export function canModerateGame(
  subject: RoleCheckSubject | null | undefined,
  gameId: string | null | undefined
): boolean {
  if (!subject || subject.is_banned) return false;
  const eff = getEffectiveRole(subject);
  if (eff === 'owner' || eff === 'admin') return true;
  if (eff !== 'moderator') return false;
  const target = (gameId || 'riftbound').trim().toLowerCase();
  return normalizeModeratorGames(subject.moderator_games).includes(target);
}

/**
 * Authoritative user-management hierarchy check:
 * - Owner can manage everyone (admin, moderator, user), except deleting/banning/demoting self.
 * - Admin can manage moderators and regular users, NEVER other admins or owner.
 * - Moderators and regular users cannot manage accounts.
 */
export function canManageUserTarget(
  callerRole: UserRole,
  callerId: string,
  targetId: string,
  targetRole: UserRole
): boolean {
  if (callerId === targetId) return false;
  if (callerRole === 'owner') return true;
  if (callerRole === 'admin') {
    return targetRole !== 'admin' && targetRole !== 'owner';
  }
  return false;
}
