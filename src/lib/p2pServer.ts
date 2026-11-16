import { supabaseAdmin } from './supabaseServer';
import { bannedResponse, getRequestUser, jsonResponse, type RequestUser } from './requestAuth';
import { isP2PEnabledFor, P2P_MAX_POST_IMAGES, P2P_PENDING_HOLD_HOURS } from './p2pConstants';
import { sanitizeUrl } from './sanitize';
import type { ReviewDirection } from './reviewCategories';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_RE.test(val.trim());
}

export function isMissingSchemaError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || err.details || '');
  return (
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    code === '42P01' ||
    code === '42703' ||
    /Could not find the table|does not exist|schema cache/i.test(msg)
  );
}

/** Ensures caller is authenticated, unbanned, email-verified (when required), and allowed to access P2P. */
export async function requireP2PUser(
  request: Request,
  opts: { requireEmailConfirmed?: boolean } = {}
): Promise<{ caller: RequestUser; response?: never } | { caller?: never; response: Response }> {
  const caller = await getRequestUser(request);
  if (!caller) {
    return { response: jsonResponse({ success: false, error: 'Authentication required.' }, 401) };
  }
  if (caller.isBanned) {
    return { response: bannedResponse() };
  }
  if (!isP2PEnabledFor(caller.isAdmin)) {
    return { response: jsonResponse({ success: false, error: 'P2P Marketplace is not available yet.' }, 403) };
  }
  if (opts.requireEmailConfirmed !== false && !caller.isAdmin) {
    const confirmed = Boolean(caller.user.email_confirmed_at || (caller.user as any).confirmed_at);
    if (!confirmed) {
      return {
        response: jsonResponse(
          { success: false, error: 'Please verify your email address before posting or holding items.' },
          403
        ),
      };
    }
  }
  return { caller };
}

/** Resolves read access for public vs. admin-gated P2P endpoints. */
export async function resolveP2PViewer(request: Request): Promise<{
  caller: RequestUser | null;
  allowed: boolean;
}> {
  const caller = await getRequestUser(request);
  return {
    caller,
    allowed: isP2PEnabledFor(caller?.isAdmin),
  };
}

export function sanitizeImageUrls(raw: unknown, maxCount = P2P_MAX_POST_IMAGES): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const clean = sanitizeUrl(item);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
      if (out.length >= maxCount) break;
    }
  }
  return out;
}

export interface ProfileMini {
  id: string;
  display_name: string;
  avatar_url: string | null;
  country: string;
}

export async function fetchProfilesMap(userIds: string[]): Promise<Map<string, ProfileMini>> {
  const map = new Map<string, ProfileMini>();
  const unique = Array.from(new Set(userIds.filter((id) => isUuid(id))));
  if (unique.length === 0) return map;

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, avatar_url, country')
    .in('id', unique);

  for (const row of data || []) {
    map.set(row.id, {
      id: row.id,
      display_name: row.display_name || 'Collector',
      avatar_url: row.avatar_url || null,
      country: row.country || 'HU',
    });
  }
  return map;
}

export async function fetchUserRatingMap(
  userIds: string[],
  direction: ReviewDirection = 'buyer_to_seller'
): Promise<Map<string, { avg: number; count: number }>> {
  const map = new Map<string, { avg: number; count: number }>();
  const unique = Array.from(new Set(userIds.filter((id) => isUuid(id))));
  if (unique.length === 0) return map;

  try {
    const { data, error } = await supabaseAdmin
      .from('user_reviews')
      .select('reviewee_id, rating')
      .in('reviewee_id', unique)
      .eq('direction', direction);

    if (error || !data) return map;

    const acc = new Map<string, { sum: number; count: number }>();
    for (const row of data) {
      const val = Number(row.rating);
      if (!Number.isFinite(val)) continue;
      const prev = acc.get(row.reviewee_id) || { sum: 0, count: 0 };
      prev.sum += val;
      prev.count += 1;
      acc.set(row.reviewee_id, prev);
    }

    for (const [id, v] of acc.entries()) {
      map.set(id, {
        avg: Math.round((v.sum / v.count) * 10) / 10,
        count: v.count,
      });
    }
  } catch {}
  return map;
}

let lastExpirySweepMs = 0;

/** Best-effort sweep expiring pending holds past 48h without crashing pre-migration DBs. */
export async function expireStalePendingHolds(): Promise<void> {
  const now = Date.now();
  if (now - lastExpirySweepMs < 60_000) return;
  lastExpirySweepMs = now;

  try {
    const cutoffIso = new Date(now - P2P_PENDING_HOLD_HOURS * 3600 * 1000).toISOString();
    await supabaseAdmin
      .from('hold_requests')
      .update({ status: 'expired', updated_at: new Date(now).toISOString() })
      .eq('status', 'pending')
      .lt('created_at', cutoffIso);
  } catch {}
}

export function generateHoldOrderNumber(): string {
  return `P2P-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
