import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { UserProfile, SavedDeck } from '../types';

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

export async function signUpWithEmail(email: string, password: string, displayName?: string, country = 'HU') {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: displayName || splitEmail(email),
        country: (country || 'HU').toUpperCase(),
      },
    },
  });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

function splitEmail(email: string): string {
  return email.split('@')[0] || 'User';
}

/**
 * Like `supabase.auth.onAuthStateChange`, but only fires when *who* is signed in changes (a sign
 * in, a sign out, a different account) or their account details are updated. supabase-js also
 * re-announces SIGNED_IN for the same user every time the tab becomes visible again, and sends
 * TOKEN_REFRESHED about hourly - pages that reloaded everything on those did it on every tab
 * switch. The first report (INITIAL_SESSION) is skipped too: it's the session the page is already
 * loading on mount. Returns the unsubscribe function.
 */
export function onSignedInUserChange(callback: (session: Session | null) => void): () => void {
  let lastUserId: string | null | undefined;
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const userId = session?.user.id ?? null;
    if (event === 'INITIAL_SESSION') {
      lastUserId = userId;
      return;
    }
    if (userId === lastUserId && event !== 'USER_UPDATED') return;
    lastUserId = userId;
    callback(session);
  });
  return () => subscription.unsubscribe();
}

/*
 * `auth.getUser()` is a network round trip to Supabase Auth, and the profile a query on top of it -
 * and a single page asks for them from the header, the page itself, the unread-messages badge and
 * several lib helpers at once. The profile page alone was making 9 identical user calls and 5
 * identical profile queries on load. So each is fetched once per signed-in user and shared:
 * concurrent callers await the same request. Signing in/out, switching account or updating it drops
 * both, and a failed lookup is never kept. The site is a multi-page app, so this never outlives the
 * page anyway.
 */
type AuthUser = NonNullable<Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user']>;
let userRequest: { userId: string; promise: Promise<AuthUser | null> } | null = null;
let profileRequest: { user: AuthUser; promise: Promise<UserProfile | null> } | null = null;

function forgetCurrentUser() {
  userRequest = null;
  profileRequest = null;
}

if (typeof window !== 'undefined') {
  onSignedInUserChange(forgetCurrentUser);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  // Read locally (no request); it's only used to key the cache and to skip the call when signed out.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  if (userRequest?.userId !== session.user.id) {
    const promise = supabase.auth.getUser().then(({ data: { user }, error }) => (error || !user ? null : user));
    const request = { userId: session.user.id, promise };
    userRequest = request;
    promise.then((user) => {
      if (!user && userRequest === request) userRequest = null;
    });
  }
  return userRequest.promise;
}

export async function getCurrentProfile(): Promise<UserProfile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  if (profileRequest?.user !== user) {
    profileRequest = { user, promise: loadProfile(user) };
  }
  return profileRequest.promise;
}

async function loadProfile(user: AuthUser): Promise<UserProfile> {
  // Attempt to fetch profile record from database
  let dbRole: UserProfile['role'] | null = null;
  let dbDisplayName: string | null = null;
  let dbAvatarUrl: string | null = null;
  let dbCountry: string | null = null;
  let dbIsAdmin = false;
  let dbIsBanned = false;

  try {
    let { data, error } = await supabase
      .from('profiles')
      .select('role, display_name, avatar_url, is_admin, country, is_banned')
      .eq('id', user.id)
      .maybeSingle();

    // Before the country migration the select fails as a whole; retry without it so role and
    // display name still load.
    if (error) {
      const fallback = await supabase
        .from('profiles')
        .select('role, display_name, avatar_url, is_admin, is_banned')
        .eq('id', user.id)
        .maybeSingle();
      data = fallback.data as typeof data;
      error = fallback.error;
    }

    if (!error && data) {
      dbRole = data.role as UserProfile['role'];
      dbDisplayName = data.display_name;
      dbAvatarUrl = data.avatar_url;
      dbCountry = (data as any).country || null;
      dbIsAdmin = Boolean(data.is_admin);
      dbIsBanned = Boolean((data as any).is_banned);
    }
  } catch (e) {
    // ignore network/db error and fallback to metadata
  }

  const isPlatformOwner = user.email === 'vnoel05@gmail.com' ||
                          user.email === 'support@tcgxchange.net' ||
                          user.app_metadata?.role === 'owner' ||
                          user.user_metadata?.role === 'owner' ||
                          dbRole === 'owner';

  const isPlatformAdmin = isPlatformOwner ||
                          dbIsAdmin ||
                          dbRole === 'admin' ||
                          user.app_metadata?.is_admin === true ||
                          user.app_metadata?.role === 'admin' ||
                          user.user_metadata?.is_admin === true ||
                          user.user_metadata?.role === 'admin';

  const role: UserProfile['role'] = isPlatformOwner ? 'owner' : (isPlatformAdmin ? 'admin' : (dbRole || 'user'));

  return {
    id: user.id,
    email: user.email || null,
    display_name: dbDisplayName || (user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.display_name || splitEmail(user.email || 'User')),
    avatar_url: dbAvatarUrl || (user.user_metadata?.avatar_url || user.user_metadata?.picture || null),
    banner_url: user.user_metadata?.banner_url || null,
    country: (dbCountry || user.user_metadata?.country || 'HU').toUpperCase(),
    role,
    is_admin: isPlatformAdmin,
    is_owner: isPlatformOwner,
    is_banned: dbIsBanned,
  };
}

let cachedOwnerProfile: UserProfile | null = null;
export async function getStoreOwnerProfile(): Promise<UserProfile> {
  if (cachedOwnerProfile) return cachedOwnerProfile;

  try {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, role, is_admin')
      .eq('role', 'owner')
      .maybeSingle();

    if (data) {
      cachedOwnerProfile = {
        id: data.id,
        // Email addresses are not readable from the browser; nothing here needs the owner's.
        email: null,
        display_name: data.display_name || 'Noel :3',
        avatar_url: data.avatar_url,
        role: 'owner',
        is_admin: true,
        is_owner: true,
      };
      return cachedOwnerProfile;
    }
  } catch (e) {}

  cachedOwnerProfile = {
    id: 'd47ca466-6520-46ec-aff2-718732f1baf7',
    email: 'support@tcgxchange.net',
    display_name: 'Noel :3',
    avatar_url: null,
    role: 'owner',
    is_admin: true,
    is_owner: true,
  };
  return cachedOwnerProfile;
}

export async function updateProfile(updates: Partial<UserProfile>) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const authData: Record<string, any> = {};
  if (updates.display_name !== undefined) {
    authData.display_name = updates.display_name;
    authData.full_name = updates.display_name;
    authData.name = updates.display_name;
  }
  if (updates.avatar_url !== undefined) {
    authData.avatar_url = updates.avatar_url;
  }
  if (updates.banner_url !== undefined) {
    authData.banner_url = updates.banner_url;
  }
  if (updates.country !== undefined) {
    authData.country = updates.country;
  }

  // 1. Update public.profiles + auth.users + user_banners via server API
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (token) {
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          display_name: updates.display_name,
          avatar_url: updates.avatar_url,
          banner_url: updates.banner_url,
          country: updates.country,
          social_profiles: updates.social_profiles,
        }),
      });
    } catch {}
  }

  // 2. Refresh local Supabase Auth session metadata
  const { data: authResult, error: authError } = await supabase.auth.updateUser({
    data: authData,
  });
  forgetCurrentUser();
  cachedOwnerProfile = null;

  return { data: authResult, error: authError };
}

/**
 * Compresses any user-selected image file client-side to a 160x160 center-cropped WebP (~6–12 KB)
 * and uploads it to `avatars/<userId>.webp` (overwriting any previous custom avatar).
 */
export async function uploadCustomAvatar(file: File): Promise<{ avatar_url: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const size = 160;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      // Center-crop square
      const minSide = Math.min(img.width, img.height);
      const sx = Math.floor((img.width - minSide) / 2);
      const sy = Math.floor((img.height - minSide) / 2);
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
      let out = canvas.toDataURL('image/webp', 0.82);
      if (!out.startsWith('data:image/webp')) {
        out = canvas.toDataURL('image/jpeg', 0.82);
      }
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read image file.'));
    };
    img.src = objectUrl;
  });

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Not signed in.');

  const res = await fetch('/api/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ dataUrl }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || 'Avatar upload failed.');
  }
  await supabase.auth.updateUser({ data: { avatar_url: json.avatar_url } }).catch(() => null);
  forgetCurrentUser();
  cachedOwnerProfile = null;
  return { avatar_url: json.avatar_url };
}

// ─── Cloud Saved Decks ──────────────────────────────────────────────

export async function fetchUserSavedDecks(): Promise<SavedDeck[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('saved_decks')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching saved decks:', error);
    return [];
  }
  return (data || []) as SavedDeck[];
}

export async function saveDeckToCloud(name: string, deckData: any, description?: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Must be logged in to save decks to cloud');

  const { data, error } = await supabase
    .from('saved_decks')
    .insert({
      user_id: user.id,
      name,
      deck_data: deckData,
      description: description || null,
    })
    .select()
    .single();

  return { data, error };
}

export async function deleteSavedDeck(id: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('saved_decks')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  return { error };
}

// ─── Cloud Collection Sync ──────────────────────────────────────────

import {
  saveUserCollection,
  loadUserCollection,
  loadUserCollectionRecord,
  saveCollectionBackup,
  loadCollectionBackupRecord,
} from './userCollections';

export async function saveCollectionToCloud(collection: Record<string, number>) {
  const res = await saveUserCollection(collection);
  return { data: res.success, error: res.error, updatedAt: res.updatedAt };
}

export async function loadCollectionFromCloud(): Promise<Record<string, number> | null> {
  return loadUserCollection();
}

/** The saved collection with the time it was saved; null if it could not be read. */
export async function loadCollectionRecordFromCloud() {
  return loadUserCollectionRecord();
}

/**
 * A separate, deliberate backup: unaffected by the automatic sync, by another device, and by
 * Reset. See lib/userCollections.ts.
 */
export async function saveCollectionBackupToCloud(collection: Record<string, number>) {
  return saveCollectionBackup(collection);
}

export async function loadCollectionBackupFromCloud() {
  return loadCollectionBackupRecord();
}

// ─── User Orders ──────────────────────────────────────────────────

export { fetchUserOrders } from './orders';

/**
 * Authoritative admin capability check.
 * Platform owner has the exact same administrative capabilities as admin;
 * owner is only a visible badge on the profile.
 */
export function isProfileAdmin(profile: { is_admin?: boolean; role?: string } | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(profile.is_admin || profile.role === 'admin' || profile.role === 'owner');
}

