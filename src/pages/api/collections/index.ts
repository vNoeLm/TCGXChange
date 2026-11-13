import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { MAX_COLLECTIONS, MAX_COLLECTION_NAME, normalizeListDefaults } from '../../../lib/collectionDefaults';
import { loadCollection, rowToCollection } from '../../../lib/collectionsServer';
import { sanitizePlainText } from '../../../lib/sanitize';
import { invalidateProfileCollectionsCache } from '../profile/collections';

export const prerender = false;

const tableMissing = (error: any) => Boolean(error && (error.code === '42P01' || error.code === 'PGRST205'));
const MIGRATION_MSG = 'Named collections need the database update (card_collections migration) first.';

const cleanName = (v: unknown) => sanitizePlainText(v, MAX_COLLECTION_NAME);

// GET: the caller's named collections, oldest first
export const GET: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Sign in to use collections.' }, 401);
  const { data, error } = await supabaseAdmin
    .from('card_collections')
    .select('*')
    .eq('user_id', caller.user.id)
    .order('created_at', { ascending: true });
  if (error) {
    if (tableMissing(error)) return jsonResponse({ success: true, collections: [], needs_migration: true });
    return jsonResponse({ success: false, error: error.message }, 500);
  }
  const allRows = data || [];
  const personalRow = allRows.find((r: any) => r.list_defaults?.is_personal === true);
  const namedRows = allRows.filter((r: any) => !r.list_defaults?.is_personal);
  const personal = personalRow ? {
    name: personalRow.name || 'Personal',
    is_public: Boolean(personalRow.is_public ?? personalRow.list_defaults?.is_public ?? false),
    description: personalRow.description || personalRow.list_defaults?.description || '',
  } : null;
  return jsonResponse({ success: true, collections: namedRows.map(rowToCollection), personal });
};

// POST { name, is_public? }: create a collection
export const POST: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Sign in to use collections.' }, 401);
  const body = await request.json().catch(() => null);
  const name = cleanName(body?.name);
  if (!name) return jsonResponse({ success: false, error: 'Give the collection a name.' }, 400);
  if (name.toLowerCase() === 'personal') return jsonResponse({ success: false, error: '"Personal" is your main collection - pick another name.' }, 400);

  const { count, error: countErr } = await supabaseAdmin
    .from('card_collections')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', caller.user.id);
  if (tableMissing(countErr)) return jsonResponse({ success: false, error: MIGRATION_MSG }, 503);
  if ((count || 0) >= MAX_COLLECTIONS) return jsonResponse({ success: false, error: `You can have up to ${MAX_COLLECTIONS} collections.` }, 400);

  const isPublic = Boolean(body?.is_public);
  const listDefaults = {
    ...normalizeListDefaults(body?.list_defaults),
    is_public: isPublic,
  };

  const { data, error } = await supabaseAdmin
    .from('card_collections')
    .insert({
      user_id: caller.user.id,
      name,
      always_list: false,
      list_defaults: listDefaults,
    })
    .select('*')
    .single();
  if (error) return jsonResponse({ success: false, error: tableMissing(error) ? MIGRATION_MSG : error.message }, tableMissing(error) ? 503 : 500);
  invalidateProfileCollectionsCache(caller.user.id);
  return jsonResponse({ success: true, collection: rowToCollection(data) }, 201);
};

// PATCH { id, name?, is_public? }: rename or change visibility
export const PATCH: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Sign in to use collections.' }, 401);
  const body = await request.json().catch(() => null);
  const coll = body?.id ? await loadCollection(caller.user.id, String(body.id)) : null;
  if (!coll) return jsonResponse({ success: false, error: 'Collection not found.' }, 404);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), always_list: false };
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return jsonResponse({ success: false, error: 'Give the collection a name.' }, 400);
    if (name.toLowerCase() === 'personal') return jsonResponse({ success: false, error: '"Personal" is your main collection - pick another name.' }, 400);
    updates.name = name;
  }
  const nextDefaults = body.list_defaults !== undefined ? normalizeListDefaults(body.list_defaults) : { ...coll.list_defaults };
  if (typeof body.is_public === 'boolean') {
    nextDefaults.is_public = body.is_public;
  }
  if (body.list_defaults !== undefined || typeof body.is_public === 'boolean') {
    updates.list_defaults = nextDefaults;
  }

  const { data, error } = await supabaseAdmin
    .from('card_collections')
    .update(updates)
    .eq('id', coll.id)
    .eq('user_id', caller.user.id)
    .select('*')
    .single();
  if (error) return jsonResponse({ success: false, error: error.message }, 500);

  invalidateProfileCollectionsCache(caller.user.id);
  return jsonResponse({ success: true, collection: rowToCollection(data) });
};

// DELETE ?id= : delete a collection
export const DELETE: APIRoute = async ({ request, url }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Sign in to use collections.' }, 401);
  const id = url.searchParams.get('id') || '';
  const coll = id ? await loadCollection(caller.user.id, id) : null;
  if (!coll) return jsonResponse({ success: false, error: 'Collection not found.' }, 404);
  const { error } = await supabaseAdmin.from('card_collections').delete().eq('id', coll.id).eq('user_id', caller.user.id);
  if (error) return jsonResponse({ success: false, error: error.message }, 500);
  invalidateProfileCollectionsCache(caller.user.id);
  return jsonResponse({ success: true });
};
