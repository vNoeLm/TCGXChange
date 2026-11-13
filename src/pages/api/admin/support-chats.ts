import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import {
  MAX_MESSAGE_LENGTH,
  computeLatestActivityAt,
} from '../../../lib/messages';
import { emitConversationRealtime, getOrCreateConversation } from '../../../lib/conversationsServer';
import { OWNER_ID } from '../../../lib/constants';
import type { ChatMessage, Order } from '../../../types';

export const prerender = false;

const SETTINGS_KEY = 'store_orders';

function isCustomerMessage(m: any, customerId: string): boolean {
  if (!m || m.message_type === 'system') return false;
  if (m.metadata?.via_admin_support) return false;
  return m.sender_id === customerId;
}

async function loadAllStoreOrders(): Promise<Order[]> {
  const byNumber = new Map<string, Order>();

  try {
    const { data } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();

    if (data?.value) {
      const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (Array.isArray(parsed)) {
        for (const o of parsed) {
          if (o?.order_number) byNumber.set(o.order_number, o);
        }
      }
    }
  } catch (e) {
    console.warn('support-chats: failed reading settings store_orders:', e);
  }

  try {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(400);

    if (Array.isArray(data)) {
      for (const o of data as Order[]) {
        if (o?.order_number && !byNumber.has(o.order_number)) {
          byNumber.set(o.order_number, o);
        }
      }
    }
  } catch (e) {
    console.warn('support-chats: failed reading public.orders:', e);
  }

  return Array.from(byNumber.values()).sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

async function getAdminContext() {
  const { data: adminProfiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, avatar_url, role, is_admin')
    .or('role.eq.owner,is_admin.eq.true')
    .order('created_at', { ascending: true });

  const adminList = adminProfiles || [];
  const ownerProfile = adminList.find((p: any) => p.role === 'owner') || adminList[0];
  const storeOwnerId = ownerProfile?.id || OWNER_ID;
  const adminIds = Array.from(new Set<string>([OWNER_ID, storeOwnerId, ...adminList.map((a: any) => a.id)]));
  const adminMap = new Map<string, any>();
  adminList.forEach((a: any) => adminMap.set(a.id, a));

  return { storeOwnerId, adminIds, adminMap };
}

function resolveCustomerId(conv: { buyer_id: string; seller_id: string }, storeOwnerId: string, adminSet: Set<string>): string {
  if (conv.seller_id === storeOwnerId) return conv.buyer_id;
  if (conv.buyer_id === storeOwnerId) return conv.seller_id;
  if (adminSet.has(conv.seller_id) && !adminSet.has(conv.buyer_id)) return conv.buyer_id;
  if (adminSet.has(conv.buyer_id) && !adminSet.has(conv.seller_id)) return conv.seller_id;
  return conv.buyer_id;
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: false, error: 'Unauthorized: please sign in.' }, 401);
    }
    if (caller.isBanned || !caller.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden: admin access required.' }, 403);
    }

    const url = new URL(request.url);
    const requestedConvId = url.searchParams.get('conversation_id')?.trim() || null;

    const [{ storeOwnerId, adminIds }, allOrders] = await Promise.all([
      getAdminContext(),
      loadAllStoreOrders(),
    ]);
    const adminSet = new Set(adminIds);

    const { data: convRows, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select('id, buyer_id, seller_id, created_at')
      .order('created_at', { ascending: false })
      .limit(400);

    if (convErr) {
      return jsonResponse({ success: false, error: convErr.message || 'Failed to load conversations.' }, 500);
    }

    const relevantConvs = (convRows || []).filter((c: any) => {
      if (requestedConvId && c.id === requestedConvId) return true;
      return adminSet.has(c.seller_id) || adminSet.has(c.buyer_id);
    });

    if (relevantConvs.length === 0) {
      return jsonResponse({
        success: true,
        conversations: [],
        totalUnread: 0,
        messages: [],
        threadOrders: [],
        threadHolds: [],
      });
    }

    const convIds = relevantConvs.map((c: any) => c.id);

    const [holdRes, msgSummaryRes] = await Promise.all([
      supabaseAdmin
        .from('hold_requests')
        .select('conversation_id, buyer_id, seller_id, buyer_name, card_name, image_path, items, status, created_at, updated_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('hold_request_messages')
        .select('id, conversation_id, sender_id, body, message_type, metadata, read_at, created_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: true }),
    ]);

    const latestHoldByConv = new Map<string, any>();
    const latestHoldActivityByConv = new Map<string, string>();
    (holdRes.data || []).forEach((r: any) => {
      if (!latestHoldByConv.has(r.conversation_id)) latestHoldByConv.set(r.conversation_id, r);
      const act = computeLatestActivityAt([latestHoldActivityByConv.get(r.conversation_id), r.updated_at, r.created_at]);
      if (act) latestHoldActivityByConv.set(r.conversation_id, act);
    });

    const lastMsgByConv = new Map<string, any>();
    const msgsByConv = new Map<string, any[]>();
    (msgSummaryRes.data || []).forEach((m: any) => {
      lastMsgByConv.set(m.conversation_id, m);
      const arr = msgsByConv.get(m.conversation_id) || [];
      arr.push(m);
      msgsByConv.set(m.conversation_id, arr);
    });

    const customerIds = Array.from(
      new Set(
        relevantConvs.map((c: any) => resolveCustomerId(c, storeOwnerId, adminSet)).filter(Boolean)
      )
    );

    const profileMap = new Map<string, { display_name: string; avatar_url: string | null; email?: string | null; role?: string | null; is_admin?: boolean }>();
    if (customerIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, display_name, avatar_url, email, role, is_admin')
        .in('id', customerIds);
      (profiles || []).forEach((p: any) => {
        profileMap.set(p.id, {
          display_name: p.display_name || p.email?.split('@')[0] || 'Customer',
          avatar_url: p.avatar_url || null,
          email: p.email || null,
          role: p.role || null,
          is_admin: Boolean(p.is_admin),
        });
      });
    }

    const ordersByUser = new Map<string, Order[]>();
    for (const o of allOrders) {
      const uid = o.user_id && o.user_id !== 'guest' ? o.user_id : null;
      if (!uid) continue;
      const arr = ordersByUser.get(uid) || [];
      arr.push(o);
      ordersByUser.set(uid, arr);
    }

    const summaries: any[] = [];
    let totalUnread = 0;

    for (const conv of relevantConvs) {
      const last = lastMsgByConv.get(conv.id);
      const latestHold = latestHoldByConv.get(conv.id);
      const convMsgs = msgsByConv.get(conv.id) || [];

      if (!last && !latestHold && conv.id !== requestedConvId) {
        continue;
      }

      const customerId = resolveCustomerId(conv, storeOwnerId, adminSet);
      const customerProf = profileMap.get(customerId);
      const customerOrders = ordersByUser.get(customerId) || [];
      const latestOrder = customerOrders[0] || null;

      let unreadCount = 0;
      for (const m of convMsgs) {
        if (!m.read_at && isCustomerMessage(m, customerId)) {
          unreadCount += 1;
        }
      }

      if (requestedConvId && conv.id === requestedConvId) {
        unreadCount = 0;
      }
      totalUnread += unreadCount;

      const latestActivityAt = computeLatestActivityAt([
        last?.created_at,
        latestHoldActivityByConv.get(conv.id),
        conv.created_at,
      ]);

      let label = latestOrder?.order_number
        ? `Rendelés · #${latestOrder.order_number}`
        : 'Ügyfélszolgálat';

      if (last?.body) {
        const ordMatch = last.body.match(/Store Order #?([A-Z0-9-]+)/i) || last.body.match(/#?(ORD-[A-Z0-9-]+)/i);
        if (ordMatch) {
          label = `Rendelés · #${ordMatch[1]}`;
        }
      }

      summaries.push({
        conversation_id: conv.id,
        customer_id: customerId,
        customer_name: customerProf?.display_name || latestOrder?.shipping_name || latestHold?.buyer_name || 'Customer',
        customer_email: customerProf?.email || latestOrder?.customer_info?.email || null,
        customer_avatar: customerProf?.avatar_url || null,
        customer_is_team: Boolean(customerProf?.is_admin || customerProf?.role === 'owner'),
        has_orders: customerOrders.length > 0 || convMsgs.some((m: any) => Boolean(m.metadata?.store_order)),
        order_count: customerOrders.length,
        latest_order_number: latestOrder?.order_number || null,
        label,
        last_message: last?.body || null,
        last_message_at: last?.created_at || latestActivityAt || conv.created_at,
        unread_count: unreadCount,
      });
    }

    summaries.sort(
      (a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
    );

    let messages: ChatMessage[] = [];
    let threadOrders: Order[] = [];
    let threadHolds: any[] = [];
    let activeCustomer: any = null;

    if (requestedConvId) {
      const targetConv = relevantConvs.find((c: any) => c.id === requestedConvId);
      if (targetConv) {
        const customerId = resolveCustomerId(targetConv, storeOwnerId, adminSet);
        const custProf = profileMap.get(customerId);
        activeCustomer = {
          id: customerId,
          display_name: custProf?.display_name || 'Customer',
          email: custProf?.email || null,
          avatar_url: custProf?.avatar_url || null,
          is_team: Boolean(custProf?.is_admin || custProf?.role === 'owner'),
        };

        const [msgDetailRes, holdDetailRes] = await Promise.all([
          supabaseAdmin
            .from('hold_request_messages')
            .select('*')
            .eq('conversation_id', requestedConvId)
            .order('created_at', { ascending: true }),
          supabaseAdmin
            .from('hold_requests')
            .select('*')
            .eq('conversation_id', requestedConvId)
            .order('created_at', { ascending: false }),
        ]);

        messages = (msgDetailRes.data || []) as ChatMessage[];
        threadHolds = holdDetailRes.data || [];

        // Mark unread customer messages read when opened by an admin
        const unreadCustomerMsgIds = messages
          .filter((m) => !m.read_at && isCustomerMessage(m, customerId))
          .map((m) => m.id);

        if (unreadCustomerMsgIds.length > 0) {
          const nowIso = new Date().toISOString();
          await supabaseAdmin
            .from('hold_request_messages')
            .update({ read_at: nowIso })
            .in('id', unreadCustomerMsgIds);

          messages = messages.map((m) =>
            unreadCustomerMsgIds.includes(m.id) ? { ...m, read_at: nowIso } : m
          );
        }

        // Gather linked store orders
        const msgOrderNums = new Set<string>();
        messages.forEach((m) => {
          if (m.metadata?.order_number) msgOrderNums.add(String(m.metadata.order_number));
        });
        threadOrders = allOrders.filter(
          (o) =>
            o.user_id === customerId ||
            (custProf?.email && o.customer_info?.email?.toLowerCase() === custProf.email.toLowerCase()) ||
            msgOrderNums.has(o.order_number)
        );
      }
    }

    return jsonResponse({
      success: true,
      conversations: summaries,
      totalUnread,
      messages,
      threadOrders,
      threadHolds,
      activeCustomer,
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Internal server error.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: false, error: 'Unauthorized: please sign in.' }, 401);
    }
    if (caller.isBanned || !caller.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden: admin access required.' }, 403);
    }

    const payload = await request.json().catch(() => null);
    const conversationId = String(payload?.conversation_id || '').trim();
    const rawBody = typeof payload?.body === 'string' ? payload.body : '';
    const rawMeta = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

    if (!conversationId) {
      return jsonResponse({ success: false, error: 'Missing conversation_id.' }, 400);
    }

    const { data: conv, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select('id, buyer_id, seller_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (convErr || !conv) {
      return jsonResponse({ success: false, error: 'Conversation not found.' }, 404);
    }

    const cleaned = sanitizePlainText(rawBody, MAX_MESSAGE_LENGTH);
    const hasImages = Array.isArray(rawMeta?.images) && rawMeta.images.length > 0;
    if (!cleaned && !hasImages) {
      return jsonResponse({ success: false, error: 'Message cannot be empty.' }, 400);
    }

    const { adminIds, adminMap } = await getAdminContext();
    const callerProfile = adminMap.get(caller.user.id);
    const adminName = callerProfile?.display_name || caller.user.email?.split('@')[0] || 'Support';

    const msgMetadata: Record<string, any> = {
      ...rawMeta,
      via_admin_support: true,
      admin_id: caller.user.id,
      admin_name: adminName,
    };

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('hold_request_messages')
      .insert({
        conversation_id: conversationId,
        sender_id: caller.user.id,
        body: cleaned || (hasImages ? 'Shared photo' : ''),
        message_type: 'user',
        metadata: msgMetadata,
      })
      .select('*')
      .single();

    if (insertErr || !inserted) {
      return jsonResponse({ success: false, error: insertErr?.message || 'Failed to send reply.' }, 500);
    }

    await emitConversationRealtime(conversationId, caller.user.id, inserted as ChatMessage, adminIds);

    return jsonResponse({ success: true, message: inserted });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Internal server error.' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: false, error: 'Unauthorized: please sign in.' }, 401);
    }
    if (caller.isBanned || !caller.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden: admin access required.' }, 403);
    }

    const payload = await request.json().catch(() => null);
    const action = String(payload?.action || '').trim();

    if (action === 'open_customer_thread' && payload?.customer_id) {
      const { storeOwnerId } = await getAdminContext();
      const conversationId = await getOrCreateConversation(String(payload.customer_id), storeOwnerId);
      if (!conversationId) {
        return jsonResponse({ success: false, error: 'Failed to initialize customer conversation.' }, 500);
      }
      return jsonResponse({ success: true, conversation_id: conversationId });
    }

    return jsonResponse({ success: false, error: 'Unsupported action.' }, 400);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Internal server error.' }, 500);
  }
};
