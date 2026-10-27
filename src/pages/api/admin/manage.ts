import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { OWNER_ID } from '../../../lib/constants';
import { isProfileAdmin } from '../../../lib/auth';
import { deleteUserAccount } from '../../../lib/deleteUserAccount';

export const prerender = false;

async function requireAdmin(request: Request) {
  const caller = await getRequestUser(request);
  if (!caller || !caller.isAdmin) return null;
  return caller;
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const caller = await requireAdmin(request);
    if (!caller) return jsonResponse({ success: false, error: 'Forbidden — Admin access required.' }, 403);

    const [
      authUsersRes,
      profilesRes,
      inventoryRes,
      decksRes,
      userReviewsRes,
      sellerReviewsRes,
      settingsOrdersRes,
      holdsRes,
    ] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 250 }),
      supabaseAdmin.from('profiles').select('id, display_name, avatar_url, role, is_admin, is_banned, created_at'),
      supabaseAdmin
        .from('marketplace_listings')
        .select('id, seller_id, card_id, condition, is_foil, quantity, price_huf, status, created_at, cards(name, card_number, game, image_path, sets(name, code))')
        .order('created_at', { ascending: false })
        .limit(500),
      supabaseAdmin.from('public_decks').select('id, user_id, name, created_at').order('created_at', { ascending: false }).limit(200),
      supabaseAdmin.from('user_reviews').select('*').order('created_at', { ascending: false }).limit(250),
      supabaseAdmin.from('seller_reviews').select('*').order('created_at', { ascending: false }).limit(250),
      supabaseAdmin.from('settings').select('value').eq('key', 'store_orders').maybeSingle(),
      supabaseAdmin.from('hold_requests').select('*').order('created_at', { ascending: false }).limit(300),
    ]);

    const profileById = new Map<string, any>();
    for (const p of profilesRes.data || []) {
      profileById.set(p.id, p);
    }

    const activeListingsCount = new Map<string, number>();
    for (const item of inventoryRes.data || []) {
      const sellerId = item.seller_id;
      if (item.status !== 'Sold' && (item.quantity ?? 0) > 0 && sellerId) {
        activeListingsCount.set(sellerId, (activeListingsCount.get(sellerId) || 0) + 1);
      }
    }

    const decksCount = new Map<string, number>();
    for (const d of decksRes.data || []) {
      if (d.user_id) {
        decksCount.set(d.user_id, (decksCount.get(d.user_id) || 0) + 1);
      }
    }

    let storeOrders: any[] = [];
    if (settingsOrdersRes.data?.value) {
      try {
        const parsed = typeof settingsOrdersRes.data.value === 'string'
          ? JSON.parse(settingsOrdersRes.data.value)
          : settingsOrdersRes.data.value;
        if (Array.isArray(parsed)) storeOrders = parsed;
      } catch {
        storeOrders = [];
      }
    }

    const authUsers = authUsersRes.data?.users || [];
    const seenUserIds = new Set<string>();
    const users: any[] = [];

    for (const u of authUsers) {
      seenUserIds.add(u.id);
      const prof = profileById.get(u.id);
      users.push({
        id: u.id,
        email: u.email || null,
        display_name: prof?.display_name || u.user_metadata?.display_name || u.user_metadata?.username || (u.email ? u.email.split('@')[0] : 'Collector'),
        avatar_url: prof?.avatar_url || u.user_metadata?.avatar_url || null,
        role: prof?.role || 'user',
        is_admin: isProfileAdmin(prof),
        is_banned: Boolean(prof?.is_banned),
        created_at: prof?.created_at || u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        active_listings: activeListingsCount.get(u.id) || 0,
        decks_count: decksCount.get(u.id) || 0,
      });
    }

    for (const [id, prof] of profileById.entries()) {
      if (seenUserIds.has(id)) continue;
      users.push({
        id,
        email: null,
        display_name: prof.display_name || 'Collector',
        avatar_url: prof.avatar_url || null,
        role: prof.role || 'user',
        is_admin: isProfileAdmin(prof),
        is_banned: Boolean(prof.is_banned),
        created_at: prof.created_at,
        last_sign_in_at: null,
        active_listings: activeListingsCount.get(id) || 0,
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

    // Merge user_reviews and legacy seller_reviews
    const reviewMap = new Map<string, any>();
    for (const r of userReviewsRes.data || []) {
      reviewMap.set(r.id, {
        id: r.id,
        order_number: r.order_number,
        reviewer_id: r.reviewer_id,
        reviewer_name: r.reviewer_name || nameForUser(r.reviewer_id),
        reviewee_id: r.reviewee_id,
        reviewee_name: nameForUser(r.reviewee_id),
        direction: r.direction || 'buyer_to_seller',
        rating: Number(r.rating),
        comment: r.comment || null,
        created_at: r.created_at,
      });
    }
    for (const r of sellerReviewsRes.data || []) {
      if (reviewMap.has(r.id)) continue;
      reviewMap.set(r.id, {
        id: r.id,
        order_number: r.order_number,
        reviewer_id: r.buyer_id,
        reviewer_name: r.buyer_name || nameForUser(r.buyer_id),
        reviewee_id: r.seller_id,
        reviewee_name: nameForUser(r.seller_id),
        direction: 'buyer_to_seller',
        rating: Number(r.rating),
        comment: r.comment || null,
        created_at: r.created_at,
      });
    }
    const reviews = Array.from(reviewMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const allHoldRows = holdsRes.data || [];
    const representedHoldIds = new Set<string>();
    const combinedOrders: any[] = [];

    for (const o of storeOrders) {
      if (o.hold_request_id) representedHoldIds.add(String(o.hold_request_id));
      if (o.id) representedHoldIds.add(String(o.id));
      combinedOrders.push({
        ...o,
        total_huf: o.total_price_huf ?? o.total_huf ?? 0,
        buyer_name: o.shipping_name || o.customer_info?.name || nameForUser(o.user_id),
        seller_name: o.seller_name || nameForUser(o.seller_id),
      });
    }

    // Include completed hold_requests as completed orders if not already in store_orders
    for (const h of allHoldRows) {
      const st = String(h.status || '').toLowerCase();
      if (st === 'completed' && !representedHoldIds.has(String(h.id))) {
        const unitPrice = Number(h.negotiated_price_huf ?? h.price_huf ?? 0);
        const qty = Number(h.quantity || 1);
        combinedOrders.push({
          id: h.id,
          hold_request_id: h.id,
          order_number: h.order_number || `HOLD-${String(h.id).slice(0, 8).toUpperCase()}`,
          status: 'Completed',
          total_huf: unitPrice * qty,
          user_id: h.buyer_id,
          buyer_name: h.buyer_name || nameForUser(h.buyer_id),
          seller_id: h.seller_id,
          seller_name: nameForUser(h.seller_id),
          items: [
            {
              card_name: h.card_name || 'Card',
              card_number: h.card_number || '',
              quantity: qty,
              price_huf: unitPrice,
            },
          ],
          created_at: h.updated_at || h.created_at,
        });
      }
    }

    const enrichedOrders = combinedOrders.sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );

    const listings = (inventoryRes.data || [])
      .filter((i: any) => i.status !== 'Sold' && (i.quantity ?? 0) > 0)
      .map((i: any) => {
        const card = Array.isArray(i.cards) ? i.cards[0] : i.cards;
        const setObj = Array.isArray(card?.sets) ? card.sets[0] : card?.sets;
        const sellerId = i.seller_id || OWNER_ID;
        return {
          id: i.id,
          user_id: sellerId,
          seller_name: nameForUser(sellerId),
          card_id: i.card_id,
          card_name: card?.name || i.card_id,
          card_number: card?.card_number || '',
          set_name: setObj?.name || setObj?.code || '',
          game: card?.game || 'riftbound',
          image_path: card?.image_path || null,
          condition: i.condition,
          is_foil: Boolean(i.is_foil),
          quantity: i.quantity,
          price_huf: i.price_huf,
          status: i.status,
          created_at: i.created_at,
        };
      });

    const decks = (decksRes.data || []).map((d: any) => ({
      id: d.id,
      user_id: d.user_id,
      author_name: nameForUser(d.user_id),
      name: d.name,
      created_at: d.created_at,
    }));

    // Hold Requests only include active/in-progress holds (not completed/cancelled/rejected sales)
    const holds = allHoldRows
      .filter((h: any) => {
        const st = String(h.status || '').toLowerCase();
        return !['completed', 'cancelled', 'rejected'].includes(st);
      })
      .map((h: any) => ({
        id: h.id,
        buyer_id: h.buyer_id,
        buyer_name: h.buyer_name || nameForUser(h.buyer_id),
        seller_id: h.seller_id,
        seller_name: nameForUser(h.seller_id),
        status: h.status,
        quantity: h.quantity || 1,
        price_huf: h.negotiated_price_huf || h.price_huf || 0,
        card_name: h.card_name || 'Card',
        card_number: h.card_number || '',
        created_at: h.created_at,
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
      users,
      reviews,
      reports,
      orders: enrichedOrders,
      holds,
      listings,
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
      if (userId === caller.user.id) return jsonResponse({ success: false, error: 'You cannot ban your own owner account.' }, 400);

      const { error } = await supabaseAdmin.from('profiles').update({ is_banned: banned }).eq('id', userId);
      if (error) throw error;

      // If banning user, take their open stock off the marketplace immediately: single listings,
      // bulk lots, running auctions and open trades.
      if (banned) {
        await Promise.allSettled([
          supabaseAdmin
            .from('marketplace_listings')
            .update({ status: 'Sold', quantity: 0, updated_at: new Date().toISOString() })
            .eq('seller_id', userId),
          supabaseAdmin
            .from('marketplace_bulk_listings')
            .update({ status: 'sold', updated_at: new Date().toISOString() })
            .eq('seller_id', userId),
          supabaseAdmin
            .from('marketplace_auctions')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('seller_id', userId)
            .eq('status', 'active'),
          supabaseAdmin
            .from('marketplace_trades')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('trader_id', userId)
            .eq('status', 'open'),
        ]);
      }

      return jsonResponse({ success: true, user_id: userId, is_banned: banned });
    }

    if (action === 'set_role') {
      const userId = String(body.user_id || '');
      const role = String(body.role || 'user');
      const isAdmin = isProfileAdmin({ is_admin: body.is_admin, role });
      if (!userId) return jsonResponse({ success: false, error: 'user_id required' }, 400);
      if (userId === caller.user.id && !isAdmin) {
        return jsonResponse({ success: false, error: 'You cannot remove admin rights from your own account.' }, 400);
      }

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ role, is_admin: isAdmin })
        .eq('id', userId);
      if (error) throw error;

      return jsonResponse({ success: true, user_id: userId, role, is_admin: isAdmin });
    }

    if (action === 'delete_user') {
      const userId = String(body.user_id || '');
      if (!userId) return jsonResponse({ success: false, error: 'user_id required' }, 400);
      if (userId === caller.user.id) {
        return jsonResponse({ success: false, error: 'You cannot delete your own owner account.' }, 400);
      }

      // The same removal as a user's own deletion: messages, holds, reviews, collections and the
      // profile, with finished store orders detached from the person rather than destroyed.
      const result = await deleteUserAccount(userId);
      if (result.blocked) return jsonResponse({ success: false, error: result.blocked }, 409);
      if (!result.deleted) {
        console.error('Admin account deletion failed for', userId, result.errors);
        return jsonResponse({ success: false, error: 'The account could not be deleted completely.', details: result.errors }, 500);
      }

      return jsonResponse({ success: true, deleted_user_id: userId });
    }

    if (action === 'delete_review') {
      const reviewId = String(body.review_id || '');
      if (!reviewId) return jsonResponse({ success: false, error: 'review_id required' }, 400);

      await Promise.allSettled([
        supabaseAdmin.from('user_reviews').delete().eq('id', reviewId),
        supabaseAdmin.from('seller_reviews').delete().eq('id', reviewId),
      ]);

      // Also clean from legacy settings blob if present
      const { data: blob } = await supabaseAdmin.from('settings').select('value').eq('key', 'seller_reviews').maybeSingle();
      if (blob?.value) {
        try {
          const parsed = typeof blob.value === 'string' ? JSON.parse(blob.value) : blob.value;
          if (Array.isArray(parsed)) {
            const next = parsed.filter((r: any) => r?.id !== reviewId);
            if (next.length !== parsed.length) {
              await supabaseAdmin.from('settings').upsert({ key: 'seller_reviews', value: JSON.stringify(next) });
            }
          }
        } catch {
          // ignore
        }
      }

      return jsonResponse({ success: true, deleted_review_id: reviewId });
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
      const matchedHoldIds = existing
        .filter((o: any) => o.id === orderId || o.order_number === orderId)
        .map((o: any) => o.hold_request_id)
        .filter(Boolean);
      const next = existing.filter((o: any) => o.id !== orderId && o.order_number !== orderId);
      await supabaseAdmin.from('settings').upsert({ key: 'store_orders', value: JSON.stringify(next) });
      try {
        await supabaseAdmin.from('orders').delete().or(`id.eq.${orderId},order_number.eq.${orderId}`);
      } catch {}

      // Also remove matching completed hold_request if this order came from a hold
      const holdIdsToDelete = Array.from(new Set([orderId, ...matchedHoldIds]));
      for (const hid of holdIdsToDelete) {
        try {
          const { data: matchingHolds } = await supabaseAdmin.from('hold_requests').select('id').or(`id.eq.${hid},order_number.eq.${hid}`);
          for (const mh of matchingHolds || []) {
            try { await supabaseAdmin.from('messages').delete().eq('hold_request_id', mh.id); } catch {}
            try { await supabaseAdmin.from('hold_requests').delete().eq('id', mh.id); } catch {}
          }
        } catch {}
      }

      // Clean from all users' saved_orders metadata if present
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
        return o?.status === 'Cancelled' || num.startsWith('ORD-');
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
        // Also permanently delete all completed hold requests and their messages
        try {
          const { data: compHolds } = await supabaseAdmin
            .from('hold_requests')
            .select('id')
            .or('status.eq.Completed,status.eq.completed,status.eq.COMPLETED');
          const compIds = (compHolds || []).map((h: any) => h.id);
          if (compIds.length > 0) {
            for (const hid of compIds) {
              try { await supabaseAdmin.from('messages').delete().eq('hold_request_id', hid); } catch {}
              try { await supabaseAdmin.from('hold_requests').delete().eq('id', hid); } catch {}
            }
          }
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

    if (action === 'delete_hold') {
      const holdId = String(body.hold_id || '');
      if (!holdId) return jsonResponse({ success: false, error: 'hold_id required' }, 400);
      try {
        await supabaseAdmin.from('messages').delete().eq('hold_request_id', holdId);
      } catch {}
      const { error } = await supabaseAdmin.from('hold_requests').delete().eq('id', holdId);
      if (error) throw error;
      return jsonResponse({ success: true, deleted_hold_id: holdId });
    }

    if (action === 'delete_listing') {
      const listingId = String(body.listing_id || '');
      if (!listingId) return jsonResponse({ success: false, error: 'listing_id required' }, 400);
      const { error } = await supabaseAdmin.from('marketplace_listings').delete().eq('id', listingId);
      if (error) throw error;
      return jsonResponse({ success: true, deleted_listing_id: listingId });
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
