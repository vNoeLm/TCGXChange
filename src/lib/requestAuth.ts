import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabaseServer';
import { isProfileAdmin } from './auth';

const DEFAULT_OWNER_EMAILS = ['vnoel05@gmail.com', 'support@tcgxchange.net'];

function getAdminEmails(): Set<string> {
  const envAdmin = (process.env.ADMIN_EMAILS || (import.meta as any).env?.ADMIN_EMAILS || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_OWNER_EMAILS.map((e) => e.toLowerCase()), ...envAdmin]);
}

export interface RequestUser {
  user: User;
  isAdmin: boolean;
  /** Suspended accounts may still read the catalog and store, but not use the marketplace. */
  isBanned: boolean;
}

/**
 * The signed-in user behind an API request (from its `Authorization: Bearer <token>` header) and
 * whether they are an admin or suspended, or null when there is no valid sign-in.
 *
 * API routes that use the service role bypass row-level security, so each one has to decide for
 * itself who is allowed; this is the one place that answers "who is calling".
 */
export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(header.slice('Bearer '.length).trim());
  if (error || !data?.user) return null;

  const user = data.user;
  const isEmailConfirmed = Boolean(user.email_confirmed_at || (user as any).confirmed_at);
  const adminEmails = getAdminEmails();

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin, role, is_banned')
    .eq('id', user.id)
    .maybeSingle();

  const isAdmin =
    Boolean(user.email && isEmailConfirmed && adminEmails.has(user.email.toLowerCase())) ||
    isProfileAdmin(profile);

  return { user, isAdmin, isBanned: Boolean(profile?.is_banned) };
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
