import { supabaseAdmin } from './supabaseServer';
import { normalizeModeratorGames } from './roles';

export const MODERATOR_ROLES_KEY = 'moderator_roles';
export const CARD_UPDATE_REQUESTS_KEY = 'card_update_requests';
export const CARD_CONTENT_VERSION_KEY = 'card_content_version';

export async function loadModeratorRolesMap(): Promise<Record<string, string[]>> {
  try {
    const { data } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', MODERATOR_ROLES_KEY)
      .maybeSingle();
    if (!data?.value) return {};
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string[]> = {};
    for (const [uid, games] of Object.entries(parsed)) {
      const normalized = normalizeModeratorGames(games);
      if (uid && normalized.length > 0) {
        clean[uid] = normalized;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export async function saveModeratorRolesMap(map: Record<string, string[]>): Promise<void> {
  await supabaseAdmin.from('settings').upsert({
    key: MODERATOR_ROLES_KEY,
    value: JSON.stringify(map),
    updated_at: new Date().toISOString(),
  });
}

export async function setUserModeratorGames(userId: string, gamesInput: unknown): Promise<string[]> {
  const games = normalizeModeratorGames(gamesInput);
  const map = await loadModeratorRolesMap();
  if (games.length > 0) {
    map[userId] = games;
  } else {
    delete map[userId];
  }
  await saveModeratorRolesMap(map);

  // Sync onto Supabase Auth app_metadata as well so client session profiles read it immediately.
  try {
    const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(userId);
    const existingAppMeta = (userRes?.user?.app_metadata || {}) as Record<string, any>;
    const nextMeta: Record<string, any> = { ...existingAppMeta, moderator_games: games };
    if (games.length === 0) {
      delete nextMeta.moderator_games;
    }
    await supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: nextMeta });
  } catch {
    // Non-fatal if user is only in profiles table without an auth row
  }

  return games;
}

export async function removeUserModeratorRole(userId: string): Promise<void> {
  const map = await loadModeratorRolesMap();
  if (userId in map) {
    delete map[userId];
    await saveModeratorRolesMap(map);
  }
}

export async function bumpCardContentVersion(): Promise<string> {
  const version = String(Date.now());
  try {
    await supabaseAdmin.from('settings').upsert({
      key: CARD_CONTENT_VERSION_KEY,
      value: version,
      updated_at: new Date().toISOString(),
    });
  } catch {}
  return version;
}
