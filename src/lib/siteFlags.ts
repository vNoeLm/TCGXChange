import { useEffect, useState } from 'react';
import { P2P_PUBLIC_LAUNCH } from './p2pConstants';
import { STORE_PUBLIC_LAUNCH } from './storeConstants';

export interface SiteFeatureFlags {
  /** Public access to /marketplace, /messages, card P2P offers, and profile Cards For Sale. */
  p2p_public: boolean;
  /** Public access to /store, /support, and store links. */
  store_public: boolean;
  /** Public visibility of commercial / official company footer & legal links (ÁSZF, Impresszum, Elállás, Szállítás, Termék igénylése). */
  official_company_info: boolean;
}

export const DEFAULT_SITE_FLAGS: SiteFeatureFlags = {
  p2p_public: P2P_PUBLIC_LAUNCH,
  store_public: STORE_PUBLIC_LAUNCH,
  official_company_info: false,
};

export const SITE_FLAGS_EVENT = 'tcg-site-flags-changed';
const SESSION_CACHE_KEY = 'tcg_site_flags_v1';

declare global {
  interface Window {
    __SITE_FLAGS__?: Partial<SiteFeatureFlags>;
  }
}

export function normalizeSiteFlags(raw: unknown): SiteFeatureFlags {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    p2p_public: typeof obj.p2p_public === 'boolean' ? obj.p2p_public : DEFAULT_SITE_FLAGS.p2p_public,
    store_public: typeof obj.store_public === 'boolean' ? obj.store_public : DEFAULT_SITE_FLAGS.store_public,
    official_company_info:
      typeof obj.official_company_info === 'boolean'
        ? obj.official_company_info
        : DEFAULT_SITE_FLAGS.official_company_info,
  };
}

let cachedFlags: SiteFeatureFlags | null = null;
let inflightFetch: Promise<SiteFeatureFlags> | null = null;

/** Synchronous read of best-known flags (hydrated SSR window global -> sessionStorage -> defaults). */
export function getSiteFlags(): SiteFeatureFlags {
  if (cachedFlags) return cachedFlags;
  if (typeof window !== 'undefined') {
    if (window.__SITE_FLAGS__) {
      cachedFlags = normalizeSiteFlags(window.__SITE_FLAGS__);
      return cachedFlags;
    }
    try {
      const saved = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (saved) {
        cachedFlags = normalizeSiteFlags(JSON.parse(saved));
        return cachedFlags;
      }
    } catch {}
  }
  return DEFAULT_SITE_FLAGS;
}

export function publishSiteFlags(next: SiteFeatureFlags) {
  const normalized = normalizeSiteFlags(next);
  cachedFlags = normalized;
  if (typeof window !== 'undefined') {
    window.__SITE_FLAGS__ = normalized;
    try {
      sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(normalized));
    } catch {}
    window.dispatchEvent(new CustomEvent<SiteFeatureFlags>(SITE_FLAGS_EVENT, { detail: normalized }));
  }
}

/** Fetches live site flags from /api/site-flags (deduplicated across components). */
export async function fetchSiteFlags(force = false): Promise<SiteFeatureFlags> {
  if (!force && inflightFetch) return inflightFetch;
  const req = fetch('/api/site-flags', { cache: force ? 'no-store' : 'default' })
    .then(async (res) => {
      if (!res.ok) return getSiteFlags();
      const json = await res.json().catch(() => null);
      if (json?.success && json.flags) {
        const normalized = normalizeSiteFlags(json.flags);
        publishSiteFlags(normalized);
        return normalized;
      }
      return getSiteFlags();
    })
    .catch(() => getSiteFlags())
    .finally(() => {
      if (inflightFetch === req) inflightFetch = null;
    });
  inflightFetch = req;
  return req;
}

let didInitialRefresh = false;

/** React hook returning live site visibility flags and staying in sync when admin toggles them. */
export function useSiteFlags(): SiteFeatureFlags {
  const [flags, setFlags] = useState<SiteFeatureFlags>(() => getSiteFlags());

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<SiteFeatureFlags>).detail;
      if (detail) setFlags(normalizeSiteFlags(detail));
    };
    window.addEventListener(SITE_FLAGS_EVENT, onChange);

    if (!didInitialRefresh) {
      didInitialRefresh = true;
      fetchSiteFlags().then(setFlags);
    } else {
      setFlags(getSiteFlags());
    }

    return () => window.removeEventListener(SITE_FLAGS_EVENT, onChange);
  }, []);

  return flags;
}
