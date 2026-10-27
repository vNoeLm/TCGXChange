import { useEffect, useState } from 'react';
import { getCurrentProfile, isProfileAdmin } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import type { UserProfile } from '../../types';

/** fetch() against the store API with the signed-in user's token attached. */
export async function storeApi<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const { data: session } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  const token = session.session?.access_token;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export function useStoreAuth() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentProfile()
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  const isAdmin = isProfileAdmin(profile);
  return { profile, loading, isAdmin };
}
