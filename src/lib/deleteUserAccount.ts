import { supabaseAdmin } from './supabaseServer';

/** Statuses that mean a store order or marketplace deal is finished, so deleting the account cannot strand it. */
const CLOSED_STATUSES = new Set(['completed', 'delivered', 'cancelled', 'canceled', 'refunded', 'rejected', 'declined', 'sold']);
const isClosed = (status: unknown) => CLOSED_STATUSES.has(String(status || '').trim().toLowerCase());

export interface DeleteAccountResult {
  deleted: boolean;
  /** Set when deletion must wait, e.g. an order is still open. */
  blocked?: string;
  errors: string[];
}

/**
 * Removes an account and the data that belongs to it, then the auth user itself.
 *
 * Order matters: messages reference conversations and hold requests without a cascade, so they go
 * first. Past store orders are kept (accounting and consumer-law records) but detached from the
 * person and stripped of shipping details. Anything still open blocks the deletion instead of
 * being erased under the other side's feet.
 */
export async function deleteUserAccount(userId: string): Promise<DeleteAccountResult> {
  const errors: string[] = [];
  const step = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const { error } = await run();
      if (error) errors.push(`${label}: ${error.message}`);
    } catch (e: any) {
      errors.push(`${label}: ${e?.message || String(e)}`);
    }
  };

  const { data: orderRows, error: orderError } = await supabaseAdmin.from('orders').select('id, status').eq('user_id', userId);
  if (orderError) {
    return { deleted: false, blocked: 'Could not check your store orders. Please try again or contact support.', errors };
  }
  const openOrders = (orderRows || []).filter((row: any) => !isClosed(row.status));
  // The admin order list is also mirrored in settings; a fresh order may be there before the table.
  const storeOrders = await readSettingsList('store_orders');
  const openMirrored = storeOrders.some((row: any) => row?.user_id === userId && !isClosed(row.status));
  if (openOrders.length > 0 || openMirrored) {
    return {
      deleted: false,
      blocked: 'You still have an open store order. Wait until it is completed (or contact support) and then delete your account.',
      errors,
    };
  }

  const { data: holdRows, error: holdError } = await supabaseAdmin
    .from('hold_requests')
    .select('id, status')
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);
  if (holdError) {
    return { deleted: false, blocked: 'Could not check your marketplace deals. Please try again or contact support.', errors };
  }
  const openHolds = (holdRows || []).filter((row: any) => !isClosed(row.status));
  if (openHolds.length > 0) {
    return {
      deleted: false,
      blocked: 'You have an open marketplace deal. Finish or cancel it first, then delete your account.',
      errors,
    };
  }

  const conversationIds = (
    await supabaseAdmin.from('conversations').select('id').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
  ).data?.map((row: any) => row.id) || [];
  const holdIds = (holdRows || []).map((row: any) => row.id);

  // Messages reference both a conversation and (for older threads) a hold request, without a
  // cascade, so they have to go before either.
  if (conversationIds.length > 0) {
    await step('messages by conversation', () => supabaseAdmin.from('hold_request_messages').delete().in('conversation_id', conversationIds));
  }
  if (holdIds.length > 0) {
    await step('messages by hold', () => supabaseAdmin.from('hold_request_messages').delete().in('hold_request_id', holdIds));
  }
  await step('messages by sender', () => supabaseAdmin.from('hold_request_messages').delete().eq('sender_id', userId));

  if (holdIds.length > 0) {
    await step('hold requests', () => supabaseAdmin.from('hold_requests').delete().in('id', holdIds));
  }
  if (conversationIds.length > 0) {
    await step('conversations', () => supabaseAdmin.from('conversations').delete().in('id', conversationIds));
  }

  await step('user reviews', () =>
    supabaseAdmin.from('user_reviews').delete().or(`reviewer_id.eq.${userId},reviewee_id.eq.${userId}`));
  await step('seller reviews', () =>
    supabaseAdmin.from('seller_reviews').delete().or(`buyer_id.eq.${userId},seller_id.eq.${userId}`));

  // Earlier reviews also live in the settings blob; drop the ones written by or about this account.
  await scrubSettingsList('seller_reviews', (row) => (row?.buyer_id === userId || row?.seller_id === userId ? null : row));

  // Orders stay for accounting, but they no longer point at a person and their delivery details go.
  await step('orders', () =>
    supabaseAdmin
      .from('orders')
      .update({ user_id: null, shipping_name: null, shipping_address: null, customer_info: {}, notes: null })
      .eq('user_id', userId));
  await scrubSettingsList('store_orders', (row) =>
    row?.user_id === userId
      ? { ...row, user_id: null, buyer_name: null, shipping_name: null, shipping_address: null, customer_info: {}, notes: null }
      : row);

  // Tables that reference auth.users directly rather than profiles.
  await step('collection', () => supabaseAdmin.from('user_collections').delete().eq('user_id', userId));
  await step('card collection', () => supabaseAdmin.from('card_collections').delete().eq('user_id', userId));
  await step('wishlists', () => supabaseAdmin.from('wishlists').delete().eq('user_id', userId));
  await step('decks', () => supabaseAdmin.from('public_decks').delete().eq('user_id', userId));
  await step('shipping settings', () => supabaseAdmin.from('seller_shipping').delete().eq('seller_id', userId));

  // Deleting the profile cascades to listings, trades, bulk lots, auctions, likes and saves.
  await step('profile', () => supabaseAdmin.from('profiles').delete().eq('id', userId));

  // Uploaded files: the avatar (avatars/<id>.<ext>) and the listing photos (marketplace/<id>/).
  await step('avatar', () => removeStorageFiles('avatars', `${userId}.`));
  await step('listing photos', () => removeStorageFiles(`marketplace/${userId}`));

  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) errors.push(`auth user: ${error.message}`);
  } catch (e: any) {
    errors.push(`auth user: ${e?.message || String(e)}`);
  }

  const { data: remaining, error: remainingError } = await supabaseAdmin.auth.admin
    .getUserById(userId)
    .catch(() => ({ data: { user: null }, error: null } as any));
  const deleted = Boolean(remainingError) || !remaining?.user;
  return { deleted, errors };
}

/** Removes every file in a storage folder, or only those whose name starts with `namePrefix`. */
async function removeStorageFiles(folder: string, namePrefix?: string): Promise<{ error: { message: string } | null }> {
  const bucket = supabaseAdmin.storage.from('card-images');
  const { data: files, error } = await bucket.list(folder, { limit: 1000 });
  if (error) return { error };
  const targets = (files || [])
    .filter((file: any) => !namePrefix || String(file.name).startsWith(namePrefix))
    .map((file: any) => `${folder}/${file.name}`);
  if (targets.length === 0) return { error: null };
  return bucket.remove(targets);
}

/** Reads one settings JSON array, returning [] when the row is missing or not a JSON array. */
async function readSettingsList(key: string): Promise<any[]> {
  try {
    const { data } = await supabaseAdmin.from('settings').select('value').eq('key', key).maybeSingle();
    if (!data?.value) return [];
    const parsed = JSON.parse(data.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Rewrites one settings JSON array (reviews or the store order mirror), keeping only what `scrub` returns. */
async function scrubSettingsList(key: string, scrub: (row: any) => any | null): Promise<void> {
  try {
    const { data } = await supabaseAdmin.from('settings').select('value').eq('key', key).maybeSingle();
    if (!data?.value) return;
    let list: any[];
    try {
      list = JSON.parse(data.value);
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    let changed = false;
    const next: any[] = [];
    for (const row of list) {
      const kept = scrub(row);
      if (kept !== row) changed = true;
      if (kept !== null) next.push(kept);
    }
    if (changed) await supabaseAdmin.from('settings').upsert({ key, value: JSON.stringify(next) });
  } catch {
    // A missing settings row (or a non-JSON legacy value) is nothing to clean.
  }
}
