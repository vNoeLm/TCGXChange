import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, isOwnerEmail, jsonResponse } from '../../../lib/requestAuth';
import { isProfileAdmin } from '../../../lib/auth';
import { deleteUserAccount } from '../../../lib/deleteUserAccount';
import { isStoreOrder } from '../../../lib/orderClassification';
import { canManageUserTarget, normalizeModeratorGames } from '../../../lib/roles';
import {
  loadModeratorRolesMap,
  removeUserModeratorRole,
  setUserModeratorGames,
} from '../../../lib/moderatorRolesServer';
import type { UserRole } from '../../../types';

export const prerender = false;

async function requireAdmin(request: Request) {
  const caller = await getRequestUser(request);
  if (!caller || !caller.isAdmin || caller.isBanned) return null;
  return caller;
}

function resolveCanonicalUserRole(params: {
  authUser?: any;
  profile?: any;
  modGames?: string[];
}): { role: UserRole; is_owner: boolean; is_admin: boolean; is_moderator: boolean; moderator_games: string[] } {
  const { authUser, profile, modGames = [] } = params;
  const emailConfirmed = Boolean(authUser?.email_confirmed_at || authUser?.confirmed_at);
  const isOwner =
    isOwnerEmail(authUser?.email, emailConfirmed) ||
    profile?.role === 'owner' ||
    authUser?.app_metadata?.role === 'owner';

  const isAdmin =
    isOwner ||
    isProfileAdmin(profile) ||
    authUser?.app_metadata?.is_admin === true ||
    authUser?.app_metadata?.role === 'admin';

  const normalizedModGames = isAdmin ? [] : normalizeModeratorGames(modGames);
  const isModerator = !isAdmin && normalizedModGames.length > 0;
  const role: UserRole = isOwner ? 'owner' : isAdmin ? 'admin' : isModerator ? 'moderator' : 'user';

  return {
    role,
    is_owner: isOwner,
    is_admin: isAdmin,
    is_moderator: isModerator,
    moderator_games: normalizedModGames,
  };
}

async function getTargetCanonicalRole(userId: string): Promise<UserRole> {
  const [{ data: profile }, authRes, modMap] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, role, is_admin').eq('id', userId).maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(userId).catch(() => ({ data: { user: null } })),
    loadModeratorRolesMap(),
  ]);
  const authUser = authRes?.data?.user || null;
  const modGames = modMap[userId] ?? authUser?.app_metadata?.moderator_games ?? [];
  return resolveCanonicalUserRole({ authUser, profile, modGames }).role;
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const caller = await requireAdmin(request);
    if (!caller) return jsonResponse({ success: false, error: 'Forbidden — Admin access required.' }, 403);
    const [
      authUsersRes,
      profilesRes,
      decksRes,
      modRolesMap,
    ] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 250 }),
      supabaseAdmin.from('profiles').select('id, display_name, avatar_url, role, is_admin, is_banned, created_at'),
      supabaseAdmin.from('public_decks').select('id, user_id, name, created_at').order('created_at', { ascending: false }).limit(200),
      loadModeratorRolesMap(),
    ]);

    const profileById = new Map<string, any>();
    for (const p of profilesRes.data || []) {
      profileById.set(p.id, p);
    }

    const decksCount = new Map<string, number>();
    for (const d of decksRes.data || []) {
      if (d.user_id) {
        decksCount.set(d.user_id, (decksCount.get(d.user_id) || 0) + 1);
      }
    }

    const authUsers = authUsersRes.data?.users || [];
    const seenUserIds = new Set<string>();
    const users: any[] = [];

    for (const u of authUsers) {
      seenUserIds.add(u.id);
      const prof = profileById.get(u.id);
      const modGames = modRolesMap[u.id] ?? u.app_metadata?.moderator_games ?? [];
      const roleInfo = resolveCanonicalUserRole({ authUser: u, profile: prof, modGames });
      users.push({
        id: u.id,
        email: u.email || null,
        display_name: prof?.display_name || u.user_metadata?.display_name || u.user_metadata?.username || (u.email ? u.email.split('@')[0] : 'Collector'),
        avatar_url: prof?.avatar_url || u.user_metadata?.avatar_url || null,
        role: roleInfo.role,
        is_owner: roleInfo.is_owner,
        is_admin: roleInfo.is_admin,
        is_moderator: roleInfo.is_moderator,
        moderator_games: roleInfo.moderator_games,
        is_banned: Boolean(prof?.is_banned),
        created_at: prof?.created_at || u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        decks_count: decksCount.get(u.id) || 0,
      });
    }

    for (const [id, prof] of profileById.entries()) {
      if (seenUserIds.has(id)) continue;
      const modGames = modRolesMap[id] ?? [];
      const roleInfo = resolveCanonicalUserRole({ profile: prof, modGames });
      users.push({
        id,
        email: null,
        display_name: prof.display_name || 'Collector',
        avatar_url: prof.avatar_url || null,
        role: roleInfo.role,
        is_owner: roleInfo.is_owner,
        is_admin: roleInfo.is_admin,
        is_moderator: roleInfo.is_moderator,
        moderator_games: roleInfo.moderator_games,
        is_banned: Boolean(prof.is_banned),
        created_at: prof.created_at,
        last_sign_in_at: null,
        decks_count: decksCount.get(id) || 0,
      });
    }

    const nameForUser = (id: string | null | undefined) => {
      if (!id) return 'Unknown';
      const p = profileById.get(id);
      if (p?.display_name) return p.display_name;
      const au = authUsers.find((u) => u.id === id);
      return au?.user_metadata?.display_name || au?.email || id.slice(0, 8);
    };

    const decks = (decksRes.data || []).map((d: any) => ({
      id: d.id,
      user_id: d.user_id,
      author_name: nameForUser(d.user_id),
      name: d.name,
      created_at: d.created_at,
    }));

    const { data: reportsRow } = await supabaseAdmin.from('settings').select('value').eq('key', 'moderation_reports').maybeSingle();
    let reports: any[] = [];
    if (reportsRow?.value) {
      try {
        const parsed = typeof reportsRow.value === 'string' ? JSON.parse(reportsRow.value) : reportsRow.value;
        if (Array.isArray(parsed)) reports = parsed;
      } catch {
        reports = [];
      }
    }

    return jsonResponse({
      success: true,
      currentAdminId: caller.user.id,
      currentCallerRole: caller.role,
      currentIsOwner: caller.isOwner,
      users,
      reports,
      decks,
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await requireAdmin(request);
    if (!caller) return jsonResponse({ success: false, error: 'Forbidden — Admin access required.' }, 403);

    const body = await request.json().catch(() => null);
    const action = body?.action as string | undefined;
    if (!action) return jsonResponse({ success: false, error: 'Missing action' }, 400);

    if (action === 'toggle_ban') {
      const userId = String(body.user_id || '');
      const banned = Boolean(body.banned);
      if (!userId) return jsonResponse({ success: false, error: 'user_id required' }, 400);
      if (userId === caller.user.id) {
        return jsonResponse({ success: false, error: 'You cannot ban your own account.' }, 400);
      }

      const targetRole = await getTargetCanonicalRole(userId);
      if (targetRole === 'owner') {
        return jsonResponse({ success: false, error: 'Owner accounts cannot be banned.' }, 403);
      }
      if (!canManageUserTarget(caller.role, caller.user.id, userId, targetRole)) {
        return jsonResponse({ success: false, error: 'Admins cannot ban or unban other admins or the owner.' }, 403);
      }

      const { error } = await supabaseAdmin.from('profiles').update({ is_banned: banned }).eq('id', userId);
      if (error) throw error;

      return jsonResponse({ success: true, user_id: userId, is_banned: banned });
    }

    if (action === 'set_role') {
      const userId = String(body.user_id || '');
      const requestedRole = String(body.role || 'user').toLowerCase() as UserRole;
      if (!userId) return jsonResponse({ success: false, error: 'user_id required' }, 400);
      if (!['user', 'moderator', 'admin', 'owner'].includes(requestedRole)) {
        return jsonResponse({ success: false, error: 'Invalid role specified.' }, 400);
      }

      const targetRole = await getTargetCanonicalRole(userId);
      if (userId === caller.user.id) {
        return jsonResponse({ success: false, error: 'You cannot change your own role here.' }, 400);
      }
      if (targetRole === 'owner' && !caller.isOwner) {
        return jsonResponse({ success: false, error: 'Admins cannot modify the owner account.' }, 403);
      }
      if (targetRole === 'admin' && !caller.isOwner) {
        return jsonResponse({ success: false, error: 'Admins cannot demote or modify another admin.' }, 403);
      }
      if (requestedRole === 'owner' && !caller.isOwner) {
        return jsonResponse({ success: false, error: 'Only the platform owner can assign the owner role.' }, 403);
      }

      let dbRole: 'user' | 'admin' | 'owner' = 'user';
      let isAdmin = false;
      let modGames: string[] = [];

      if (requestedRole === 'moderator') {
        modGames = normalizeModeratorGames(body.moderator_games);
        if (modGames.length === 0) {
          return jsonResponse({ success: false, error: 'Select at least one game for a moderator.' }, 400);
        }
        dbRole = 'user';
        isAdmin = false;
      } else if (requestedRole === 'admin') {
        dbRole = 'admin';
        isAdmin = true;
      } else if (requestedRole === 'owner') {
        dbRole = 'owner';
        isAdmin = true;
      } else {
        dbRole = 'user';
        isAdmin = false;
      }

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ role: dbRole, is_admin: isAdmin })
        .eq('id', userId);
      if (error) throw error;

      // Sync app_metadata.role/is_admin and moderator_games cleanly so client sessions & server checks agree.
      try {
        const { data: targetAuth } = await supabaseAdmin.auth.admin.getUserById(userId);
        const existingAppMeta = (targetAuth?.user?.app_metadata || {}) as Record<string, any>;
        const nextMeta: Record<string, any> = {
          ...existingAppMeta,
          role: requestedRole,
          is_admin: isAdmin,
        };
        if (modGames.length > 0) {
          nextMeta.moderator_games = modGames;
        } else {
          delete nextMeta.moderator_games;
        }
        await supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: nextMeta });
      } catch {}

      await setUserModeratorGames(userId, modGames);

      return jsonResponse({
        success: true,
        user_id: userId,
        role: requestedRole,
        is_owner: requestedRole === 'owner',
        is_admin: isAdmin,
        is_moderator: requestedRole === 'moderator',
        moderator_games: modGames,
      });
    }

    if (action === 'delete_user') {
      const userId = String(body.user_id || '');
      if (!userId) return jsonResponse({ success: false, error: 'user_id required' }, 400);
      if (userId === caller.user.id) {
        return jsonResponse({ success: false, error: 'You cannot delete your own account.' }, 400);
      }

      const targetRole = await getTargetCanonicalRole(userId);
      if (targetRole === 'owner') {
        return jsonResponse({ success: false, error: 'Owner accounts cannot be deleted here.' }, 403);
      }
      if (!canManageUserTarget(caller.role, caller.user.id, userId, targetRole)) {
        return jsonResponse({ success: false, error: 'Admins cannot delete other admins or the owner.' }, 403);
      }

      const result = await deleteUserAccount(userId);
      if (result.blocked) return jsonResponse({ success: false, error: result.blocked }, 409);
      if (!result.deleted) {
        console.error('Admin account deletion failed for', userId, result.errors);
        return jsonResponse({ success: false, error: 'The account could not be deleted completely.', details: result.errors }, 500);
      }

      await removeUserModeratorRole(userId);
      return jsonResponse({ success: true, deleted_user_id: userId });
    }

    if (action === 'delete_order') {
      const orderId = String(body.order_id || '');
      if (!orderId) return jsonResponse({ success: false, error: 'order_id required' }, 400);

      const { data: settingsRow } = await supabaseAdmin.from('settings').select('value').eq('key', 'store_orders').maybeSingle();
      let existing: any[] = [];
      if (settingsRow?.value) {
        try {
          existing = typeof settingsRow.value === 'string' ? JSON.parse(settingsRow.value) : settingsRow.value;
          if (!Array.isArray(existing)) existing = [];
        } catch {
          existing = [];
        }
      }
      const next = existing.filter((o: any) => o.id !== orderId && o.order_number !== orderId);
      await supabaseAdmin.from('settings').upsert({ key: 'store_orders', value: JSON.stringify(next) });
      try {
        await supabaseAdmin.from('orders').delete().or(`id.eq.${orderId},order_number.eq.${orderId}`);
      } catch {}

      const { data: usersList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 250 });
      for (const u of usersList?.users || []) {
        const saved = u.user_metadata?.saved_orders;
        if (Array.isArray(saved) && saved.some((o: any) => o.id === orderId || o.order_number === orderId)) {
          const filtered = saved.filter((o: any) => o.id !== orderId && o.order_number !== orderId);
          try {
            await supabaseAdmin.auth.admin.updateUserById(u.id, {
              user_metadata: { ...u.user_metadata, saved_orders: filtered },
            });
          } catch {}
        }
      }

      return jsonResponse({ success: true, deleted_order_id: orderId });
    }

    if (action === 'purge_orders') {
      const mode = (body.mode as 'cancelled_and_legacy' | 'all') || 'cancelled_and_legacy';
      const shouldRemove = (o: any) => {
        if (mode === 'all') return true;
        const num = String(o?.order_number || o?.id || '');
        return o?.status === 'Cancelled' || !isStoreOrder(o) || num.startsWith('TEST-');
      };

      const { data: settingsRow } = await supabaseAdmin.from('settings').select('value').eq('key', 'store_orders').maybeSingle();
      let existing: any[] = [];
      if (settingsRow?.value) {
        try {
          existing = typeof settingsRow.value === 'string' ? JSON.parse(settingsRow.value) : settingsRow.value;
          if (!Array.isArray(existing)) existing = [];
        } catch {
          existing = [];
        }
      }
      const remaining = existing.filter((o: any) => !shouldRemove(o));
      const removedCount = existing.length - remaining.length;
      await supabaseAdmin.from('settings').upsert({ key: 'store_orders', value: JSON.stringify(remaining) });

      if (mode === 'all') {
        try {
          await supabaseAdmin.from('orders').delete().neq('order_number', '__dummy__');
        } catch {}
      }

      const { data: usersList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 250 });
      for (const u of usersList?.users || []) {
        const saved = u.user_metadata?.saved_orders;
        if (Array.isArray(saved) && saved.some(shouldRemove)) {
          const filtered = saved.filter((o: any) => !shouldRemove(o));
          try {
            await supabaseAdmin.auth.admin.updateUserById(u.id, {
              user_metadata: { ...u.user_metadata, saved_orders: filtered },
            });
          } catch {}
        }
      }

      return jsonResponse({ success: true, removedCount, remainingCount: remaining.length });
    }

    if (action === 'resolve_report' || action === 'dismiss_report' || action === 'delete_report') {
      const reportId = String(body.report_id || '');
      if (!reportId) return jsonResponse({ success: false, error: 'report_id required' }, 400);

      const { data: row } = await supabaseAdmin.from('settings').select('value').eq('key', 'moderation_reports').maybeSingle();
      let list: any[] = [];
      try {
        list = typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value || [];
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }

      if (action === 'delete_report') {
        list = list.filter((r: any) => r.id !== reportId);
      } else {
        const newStatus = action === 'resolve_report' ? 'resolved' : 'dismissed';
        list = list.map((r: any) =>
          r.id === reportId
            ? { ...r, status: newStatus, resolved_at: new Date().toISOString(), resolved_by: caller.user.email || caller.user.id }
            : r
        );
      }

      await supabaseAdmin.from('settings').upsert({ key: 'moderation_reports', value: JSON.stringify(list) });
      return jsonResponse({ success: true, report_id: reportId });
    }

    if (action === 'delete_deck') {
      const deckId = String(body.deck_id || '');
      if (!deckId) return jsonResponse({ success: false, error: 'deck_id required' }, 400);
      const { error } = await supabaseAdmin.from('public_decks').delete().eq('id', deckId);
      if (error) throw error;
      return jsonResponse({ success: true, deleted_deck_id: deckId });
    }

    return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};
