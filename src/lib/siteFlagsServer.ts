import { supabaseAdmin } from './supabaseServer';
import { DEFAULT_SITE_FLAGS, normalizeSiteFlags, type SiteFeatureFlags } from './siteFlags';

export const SITE_FLAGS_SETTINGS_KEY = 'site_feature_flags';
const CACHE_TTL_MS = 15_000;

let serverCache: { flags: SiteFeatureFlags; expiresAt: number } | null = null;

export function invalidateSiteFlagsCache() {
  serverCache = null;
}

/** Reads live site visibility flags from Supabase settings (with short in-memory cache). */
export async function getSiteFlagsServer(force = false): Promise<SiteFeatureFlags> {
  const now = Date.now();
  if (!force && serverCache && serverCache.expiresAt > now) {
    return serverCache.flags;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', SITE_FLAGS_SETTINGS_KEY)
      .maybeSingle();

    if (error || !data?.value) {
      serverCache = { flags: DEFAULT_SITE_FLAGS, expiresAt: now + CACHE_TTL_MS };
      return DEFAULT_SITE_FLAGS;
    }

    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const normalized = normalizeSiteFlags(parsed);
    serverCache = { flags: normalized, expiresAt: now + CACHE_TTL_MS };
    return normalized;
  } catch {
    return serverCache?.flags || DEFAULT_SITE_FLAGS;
  }
}

export async function saveSiteFlagsServer(patch: Partial<SiteFeatureFlags>): Promise<SiteFeatureFlags> {
  const current = await getSiteFlagsServer(true);
  const next = normalizeSiteFlags({ ...current, ...patch });
  const { error } = await supabaseAdmin
    .from('settings')
    .upsert({ key: SITE_FLAGS_SETTINGS_KEY, value: JSON.stringify(next) }, { onConflict: 'key' });

  if (error) throw error;
  serverCache = { flags: next, expiresAt: Date.now() + CACHE_TTL_MS };
  return next;
}
