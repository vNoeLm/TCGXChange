import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { MAX_COLLECTION_NAME } from '../../../lib/collectionDefaults';
import { sanitizePlainText } from '../../../lib/sanitize';
import { invalidateProfileCollectionsCache } from '../profile/collections';

export const prerender = false;

const cleanName = (v: unknown) => sanitizePlainText(v, MAX_COLLECTION_NAME);

// GET: The caller's personal collection settings
export const GET: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Sign in required.' }, 401);

  const { data } = await supabaseAdmin
    .from('card_collections')
    .select('*')
    .eq('user_id', caller.user.id);

  const personalRow = (data || []).find((r: any) => r.list_defaults?.is_personal === true);

  return jsonResponse({
    success: true,
    personal: personalRow
      ? {
          name: personalRow.name || 'Personal',
          is_public: Boolean(personalRow.is_public ?? personalRow.list_defaults?.is_public ?? false),
          description: personalRow.description || personalRow.list_defaults?.description || '',
        }
      : {
          name: 'Personal',
          is_public: false,
          description: '',
        },
  });
};

// PATCH / POST: Update personal collection settings
export const PATCH: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Sign in required.' }, 401);

  const body = await request.json().catch(() => null);
  const name = body?.name !== undefined ? cleanName(body.name) || 'Personal' : undefined;
  const isPublic = typeof body?.is_public === 'boolean' ? body.is_public : undefined;
  const description = typeof body?.description === 'string' ? sanitizePlainText(body.description, 500) : undefined;

  const { data } = await supabaseAdmin
    .from('card_collections')
    .select('*')
    .eq('user_id', caller.user.id);

  const personalRow = (data || []).find((r: any) => r.list_defaults?.is_personal === true);

  if (personalRow) {
    const nextDefaults = {
      ...(personalRow.list_defaults || {}),
      is_personal: true,
      ...(isPublic !== undefined ? { is_public: isPublic } : {}),
      ...(description !== undefined ? { description } : {}),
    };
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
      list_defaults: nextDefaults,
    };
    if (name !== undefined) updates.name = name;

    const { data: updated, error } = await supabaseAdmin
      .from('card_collections')
      .update(updates)
      .eq('id', personalRow.id)
      .select('*')
      .single();

    if (error) return jsonResponse({ success: false, error: error.message }, 500);

    invalidateProfileCollectionsCache(caller.user.id);
    return jsonResponse({
      success: true,
      personal: {
        name: updated.name,
        is_public: Boolean(updated.list_defaults?.is_public),
        description: updated.list_defaults?.description || '',
      },
    });
  } else {
    const listDefaults: Record<string, any> = {
      is_personal: true,
      is_public: Boolean(isPublic),
      description: description || '',
    };
    const { data: inserted, error } = await supabaseAdmin
      .from('card_collections')
      .insert({
        user_id: caller.user.id,
        name: name || 'Personal',
        always_list: false,
        cards: {},
        list_defaults: listDefaults,
      })
      .select('*')
      .single();

    if (error) return jsonResponse({ success: false, error: error.message }, 500);

    invalidateProfileCollectionsCache(caller.user.id);
    return jsonResponse({
      success: true,
      personal: {
        name: inserted.name,
        is_public: Boolean(inserted.list_defaults?.is_public),
        description: inserted.list_defaults?.description || '',
      },
    });
  }
};

export const POST: APIRoute = PATCH;
