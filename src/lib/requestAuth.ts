import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabaseServer';
import { isProfileAdmin } from './auth';
import { normalizeModeratorGames } from './roles';
import { loadModeratorRolesMap } from './moderatorRolesServer';
import type { UserRole } from '../types';

const DEFAULT_OWNER_EMAILS = ['vnoel05@gmail.com', 'support@tcgxchange.net'];

export function getAdminEmails(): Set<string> {
  const envAdmin = (process.env.ADMIN_EMAILS || (import.meta as any).env?.ADMIN_EMAILS || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_OWNER_EMAILS.map((e) => e.toLowerCase()), ...envAdmin]);
}

export function isOwnerEmail(email: string | null | undefined, isEmailConfirmed: boolean): boolean {
  if (!email || !isEmailConfirmed) return false;
  return getAdminEmails().has(email.toLowerCase());
}

export interface RequestUser {
  user: User;
  role: UserRole;
  isOwner: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  moderatorGames: string[];
  /** Suspended accounts may still read the catalog and store, but not use the marketplace. */
  isBanned: boolean;
}

/**
 * The signed-in user behind an API request (from its `Authorization: Bearer <token>` header) and
 * whether they are owner, admin, game moderator, or suspended, or null when there is no valid sign-in.
 */
export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(header.slice('Bearer '.length).trim());
  if (error || !data?.user) return null;

  const user = data.user;
  const isEmailConfirmed = Boolean(user.email_confirmed_at || (user as any).confirmed_at);

  const [{ data: profile }, modMap] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('is_admin, role, is_banned')
      .eq('id', user.id)
      .maybeSingle(),
    loadModeratorRolesMap(),
  ]);

  const isBanned = Boolean(profile?.is_banned);
  const isOwner =
    isOwnerEmail(user.email, isEmailConfirmed) ||
    profile?.role === 'owner' ||
    user.app_metadata?.role === 'owner';

  const isAdmin =
    isOwner ||
    isProfileAdmin(profile) ||
    user.app_metadata?.is_admin === true ||
    user.app_metadata?.role === 'admin';

  const moderatorGames = isAdmin
    ? []
    : normalizeModeratorGames(modMap[user.id] ?? user.app_metadata?.moderator_games);

  const isModerator = !isAdmin && !isBanned && moderatorGames.length > 0;
  const role: UserRole = isOwner
    ? 'owner'
    : isAdmin
    ? 'admin'
    : isModerator
    ? 'moderator'
    : ((profile?.role as UserRole) || 'user');

  return { user, role, isOwner, isAdmin, isModerator, moderatorGames, isBanned };
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** A plain 403 for a suspended account, e.g. from middleware. */
export const bannedResponse = () =>
  jsonResponse(
    {
      success: false,
      error:
        'Your account is suspended. The marketplace, seller hub and messages are unavailable while the suspension is in place.',
    },
    403
  );
