import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { getOrCreateConversation, postSystemMessage } from '../../../lib/conversationsServer';
import type { Order } from '../../../types';

export const prerender = false;

const SETTINGS_KEY = 'store_orders';

async function findOrder(orderNumber: string): Promise<Order | null> {
  // 1. Check settings store_orders
  try {
    const { data } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();

    if (data?.value) {
      const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (Array.isArray(parsed)) {
        const match = parsed.find((o: Order) => o.order_number === orderNumber || o.id === orderNumber);
        if (match) return match;
      }
    }
  } catch (e) {
    console.error('Error reading store_orders settings in order-chat:', e);
  }

  // 2. Check public.orders table
  try {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .or(`order_number.eq.${orderNumber},id.eq.${orderNumber}`)
      .maybeSingle();

    if (!error && data) return data as Order;
  } catch (e) {
    console.error('Error reading public.orders in order-chat:', e);
  }

  return null;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: false, error: 'Unauthorized: please sign in.' }, 401);
    }

    const body = await request.json().catch(() => null);
    const orderNumber = String(body?.order_number || body?.orderNumber || '').trim();
    if (!orderNumber) {
      return jsonResponse({ success: false, error: 'Missing order_number parameter.' }, 400);
    }

    const order = await findOrder(orderNumber);
    if (!order) {
      return jsonResponse({ success: false, error: `Order #${orderNumber} not found.` }, 404);
    }

    // Permission check: caller must be an admin OR the customer who placed the order
    const isOwnerOrAdmin = caller.isAdmin;
    const isCustomer =
      caller.user.id === order.user_id ||
      (order.customer_info?.email && order.customer_info.email.toLowerCase() === caller.user.email?.toLowerCase()) ||
      (typeof order.notes === 'string' && order.notes.toLowerCase().includes(caller.user.email?.toLowerCase() || ''));

    if (!isOwnerOrAdmin && !isCustomer) {
      return jsonResponse({ success: false, error: 'Forbidden: you cannot access this order chat.' }, 403);
    }

    // Find Store Owner / Admin user ID
    let storeOwnerId = 'd47ca466-6520-46ec-aff2-718732f1baf7';
    const { data: ownerProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .or('role.eq.owner,is_admin.eq.true')
      .order('created_at', { ascending: true })
      .limit(1);

    if (ownerProfiles && ownerProfiles.length > 0 && ownerProfiles[0]?.id) {
      storeOwnerId = ownerProfiles[0].id;
    }

    // Determine Customer user ID
    let customerId: string | null = null;
    const isUuid = (str?: string | null) => Boolean(str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str));

    if (isUuid(order.user_id) && order.user_id !== 'guest') {
      customerId = order.user_id;
    } else {
      // Look up customer profile by email if available
      const customerEmail =
        order.customer_info?.email ||
        (typeof order.notes === 'string' ? order.notes.match(/Email:\s*([^\s|]+)/i)?.[1] : null);

      if (customerEmail) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .ilike('email', customerEmail.trim())
          .maybeSingle();

        if (profile?.id) {
          customerId = profile.id;
        }
      }
    }

    if (!customerId) {
      return jsonResponse({
        success: false,
        error: 'The buyer placed this order as a guest without a registered account. Site chat requires a registered buyer.',
      }, 400);
    }

    // The two participants are customerId and storeOwnerId
    const conversationId = await getOrCreateConversation(customerId, storeOwnerId);
    if (!conversationId) {
      return jsonResponse({ success: false, error: 'Failed to find or create conversation thread.' }, 500);
    }

    // Check if an intro system message already exists for this order in this conversation
    const { data: existingMsgs } = await supabaseAdmin
      .from('hold_request_messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('message_type', 'system')
      .contains('metadata', { order_number: order.order_number })
      .limit(1);

    if (!existingMsgs || existingMsgs.length === 0) {
      if (order.status === 'Delivered') {
        await postSystemMessage(conversationId, storeOwnerId, `Order #${order.order_number} completed`, {
          metadata: {
            store_order: true,
            order_number: order.order_number,
            order_id: order.id,
            status: 'Delivered',
            tracking_number: order.tracking_number || null,
            courier_name: (order as any).courier_name || null,
          },
        });
      } else {
        const itemCount = (order.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
        const totalHuf = order.total_price_huf ?? order.total_huf ?? 0;
        const formattedTotal = Number(totalHuf).toLocaleString('hu-HU');
        const introBody = `Store Order #${order.order_number} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'} · ${formattedTotal} Ft`;

        await postSystemMessage(conversationId, storeOwnerId, introBody, {
          metadata: {
            store_order: true,
            order_number: order.order_number,
            order_id: order.id,
            total_price_huf: totalHuf,
            status: order.status,
            item_count: itemCount,
            items: (order.items || []).slice(0, 10).map((i) => ({
              name: i.card_name || 'Store Item',
              sku: i.card_number || '',
              quantity: i.quantity || 1,
              price_huf: i.price_huf || 0,
              image: i.image_path || '',
            })),
            shipping_name: order.shipping_name || '',
            shipping_address: order.shipping_address || '',
            tracking_number: order.tracking_number || null,
            courier_name: (order as any).courier_name || null,
          },
        });
      }
    }

    return jsonResponse({
      success: true,
      conversation_id: conversationId,
      order_number: order.order_number,
    });
  } catch (err: any) {
    console.error('Error in POST /api/store/order-chat:', err);
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};
