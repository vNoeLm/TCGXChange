import type { APIRoute } from 'astro';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../lib/supabaseServer';
import { logOrderEvent } from '../../lib/orderLogs';
import { persistOrderItemsSnapshot } from '../../lib/orderItems';
import type { Order } from '../../types';
import { getRequestUser, jsonResponse } from '../../lib/requestAuth';
import { sanitizePlainText } from '../../lib/sanitize';
import { notifyOwnerStoreOrder } from '../../lib/emailNotifications';
import { getOrCreateConversation, postSystemMessage } from '../../lib/conversationsServer';
import { customerLimitFor, unitsPurchasedInWindow } from '../../lib/purchaseLimits';

export const prerender = false;

const SETTINGS_KEY = 'store_orders';

function getSupabaseClient(request: Request): SupabaseClient {
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const url = process.env.PUBLIC_SUPABASE_URL || (import.meta as any).env?.PUBLIC_SUPABASE_URL || '';
    const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY || '';
    if (url && anonKey) {
      return createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }
  return supabaseAdmin;
}

async function getStoredOrders(
  client: SupabaseClient = supabaseAdmin,
  scope: 'store' | 'marketplace' | 'all' = 'all'
): Promise<Order[]> {
  const map = new Map<string, Order>();

  // 1. Primary: settings.store_orders
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();

    if (!error && data?.value) {
      const parsed = JSON.parse(data.value);
      if (Array.isArray(parsed)) {
        parsed.forEach((o: Order) => {
          if (o.order_number) map.set(o.order_number, o);
        });
      }
    }
  } catch (e) {
    console.error('Failed to parse store_orders JSON in orders.ts:', e);
  }

  // 2. Supplemental: public.orders table
  try {
    const { data: tableRows, error: tableErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (!tableErr && Array.isArray(tableRows)) {
      tableRows.forEach((row: any) => {
        if (row.order_number) {
          if (!map.has(row.order_number)) {
            map.set(row.order_number, row as Order);
          } else {
            map.set(row.order_number, { ...row, ...map.get(row.order_number)! });
          }
        }
      });
    }
  } catch (e) {}

  // 3. For marketplace scope, also query hold_requests (active and completed)
  if (scope === 'marketplace' || scope === 'all') {
    try {
      const { data: holds } = await supabaseAdmin
        .from('hold_requests')
        .select('*');

      const allHolds: any[] = Array.isArray(holds) ? [...holds] : [];

      // Also check fallback hold requests from settings if present
      try {
        const { data: fallbackHolds } = await supabaseAdmin
          .from('settings')
          .select('value')
          .eq('key', 'hold_requests')
          .maybeSingle();
        if (fallbackHolds?.value) {
          const parsed = typeof fallbackHolds.value === 'string' ? JSON.parse(fallbackHolds.value) : fallbackHolds.value;
          if (Array.isArray(parsed)) {
            parsed.forEach((h: any) => {
              if (h && h.id && !allHolds.some(existing => existing.id === h.id)) {
                allHolds.push(h);
              }
            });
          }
        }
      } catch (err) {}

      if (allHolds.length > 0) {
        // Collect seller ids to fetch their display names
        const sellerIds = Array.from(new Set(allHolds.map((h: any) => h.seller_id).filter(Boolean)));
        const sellerNameMap = new Map<string, string>();
        if (sellerIds.length > 0) {
          try {
            const { data: profs } = await supabaseAdmin
              .from('profiles')
              .select('id, display_name')
              .in('id', sellerIds);
            if (profs) {
              profs.forEach((p: any) => {
                if (p.id && p.display_name) sellerNameMap.set(p.id, p.display_name);
              });
            }
          } catch {}
        }

        for (const h of allHolds) {
          if (!h.seller_id) continue;
          const orderNum = h.order_number || `P2P-${String(h.id).slice(0, 8).toUpperCase()}`;
          if (map.has(orderNum)) continue;

          const unitPrice = Number(h.negotiated_price_huf ?? h.price_huf ?? 0);
          const qty = Number(h.quantity || 1);
          const lineItems = Array.isArray(h.items) && h.items.length
            ? h.items.map((it: any) => ({
                inventory_id: it.inventory_id,
                card_name: it.card_name || 'Card',
                card_number: it.card_number || '',
                condition: it.condition || 'Near Mint',
                is_foil: Boolean(it.is_foil),
                price_huf: Number(it.price_huf) || unitPrice,
                quantity: Number(it.quantity) || 1,
                image_path: it.image_path || '',
              }))
            : [{
                inventory_id: h.inventory_id,
                card_name: h.card_name || 'Card',
                card_number: h.card_number || '',
                condition: h.condition || 'Near Mint',
                is_foil: Boolean(h.is_foil),
                price_huf: unitPrice,
                quantity: qty,
                image_path: h.image_path || '',
              }];
          const shippingHuf = Number(h.shipping_huf) || 0;
          const orderTotal = lineItems.reduce((sum: number, it: any) => sum + (Number(it.price_huf) || 0) * (Number(it.quantity) || 1), 0) + shippingHuf;

          const holdStatus = String(h.status || 'pending').toLowerCase();
          const orderStatus =
            holdStatus === 'completed' || holdStatus === 'delivered' ? 'Delivered'
            : holdStatus === 'handed_over' ? 'Shipped'
            : holdStatus === 'held' || holdStatus === 'buyer_received' ? 'Processing'
            : holdStatus === 'cancelled' || holdStatus === 'rejected' || holdStatus === 'expired' ? 'Cancelled'
            : 'Pending';

          const isPaid = holdStatus === 'completed' || holdStatus === 'delivered';
          const isFailed = holdStatus === 'cancelled' || holdStatus === 'rejected' || holdStatus === 'expired';
          const paymentStatus = isPaid ? 'paid' : (isFailed ? 'failed' : 'pending');

          map.set(orderNum, {
            id: h.id,
            order_number: orderNum,
            hold_request_id: h.id,
            conversation_id: h.conversation_id || null,
            user_id: h.buyer_id || null,
            seller_id: h.seller_id,
            seller_name: h.seller_name || sellerNameMap.get(h.seller_id) || 'Community Seller',
            status: orderStatus,
            total_price_huf: orderTotal,
            total_huf: orderTotal,
            shipping_huf: shippingHuf,
            shipping_name: h.buyer_name || null,
            shipping_method: h.preferred_handover || 'Standard Shipping',
            shipping_address: h.handover_details || undefined,
            tracking_number: h.tracking_number || null,
            courier_name: (h as any).courier_name || null,
            payment_method: 'cash_or_transfer',
            payment_status: paymentStatus,
            customer_info: {
              name: h.buyer_name,
              email: h.buyer_email,
              phone: h.buyer_phone || '',
            },
            items: lineItems,
            created_at: h.created_at || new Date().toISOString(),
            updated_at: h.updated_at || new Date().toISOString(),
          } as Order);
        }
      }
    } catch (e) {
      console.warn('Failed to load hold_requests into marketplace orders:', e);
    }
  }

  const allOrders = Array.from(map.values());
  if (scope === 'marketplace') {
    // Only P2P marketplace orders
    return allOrders.filter(
      (o) =>
        String(o.order_number || '').startsWith('P2P-') ||
        (o.seller_id && o.seller_id !== 'platform-owner' && !String(o.order_number || '').startsWith('ORD-'))
    );
  }
  if (scope === 'store') {
    // Only official retail store orders (ORD-...)
    return allOrders.filter(
      (o) =>
        !String(o.order_number || '').startsWith('P2P-') &&
        (!o.seller_id || o.seller_id === 'platform-owner' || String(o.order_number || '').startsWith('ORD-'))
    );
  }
  return allOrders;
}

async function saveStoredOrders(
  orders: Order[],
  client: SupabaseClient = supabaseAdmin,
  updatedOrder?: Order
): Promise<boolean> {
  let settingsSaved = false;

  // 1. Save to settings table using supabaseAdmin
  try {
    const { error } = await supabaseAdmin
      .from('settings')
      .upsert({
        key: SETTINGS_KEY,
        value: JSON.stringify(orders),
      });

    if (!error) {
      settingsSaved = true;
    } else {
      console.warn('saveStoredOrders settings error:', error);
    }
  } catch (e) {
    console.error('Failed to upsert store_orders in settings:', e);
  }

  // 2. Also sync to public.orders table if it exists
  try {
    if (updatedOrder) {
      const isUuid = (val?: string | null) => Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));
      const validUserId = isUuid(updatedOrder.user_id) ? updatedOrder.user_id : null;
      const validOrderId = isUuid(updatedOrder.id) ? updatedOrder.id : undefined;

      await supabaseAdmin.from('orders').upsert({
        ...(validOrderId ? { id: validOrderId } : {}),
        order_number: updatedOrder.order_number,
        user_id: validUserId,
        status: updatedOrder.status,
        total_price_huf: updatedOrder.total_price_huf ?? updatedOrder.total_huf ?? 0,
        shipping_name: updatedOrder.shipping_name || null,
        shipping_address: updatedOrder.shipping_address || null,
        tracking_number: updatedOrder.tracking_number || null,
        payment_method: updatedOrder.payment_method || 'stripe',
        payment_status: updatedOrder.payment_status || 'pending',
        payment_id: updatedOrder.payment_id || null,
        notes: updatedOrder.notes || null,
        items: updatedOrder.items || [],
        customer_info: updatedOrder.customer_info || {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'order_number' });
    }
  } catch (e) {
    // public.orders table might not exist yet, safe to ignore
  }

  return settingsSaved;
}

async function restockOrderItems(items: any[]) {
  if (!Array.isArray(items)) return;
  for (const it of items) {
    const qty = typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1;
    if (!it.inventory_id) continue;

    try {
      const { data: product } = await supabaseAdmin
        .from('store_products')
        .select('id, stock_quantity, status')
        .eq('id', it.inventory_id)
        .maybeSingle();

      if (product) {
        const newQty = (typeof product.stock_quantity === 'number' ? product.stock_quantity : 0) + qty;
        await supabaseAdmin
          .from('store_products')
          .update({ stock_quantity: newQty, status: product.status === 'archived' ? 'archived' : 'active' })
          .eq('id', it.inventory_id);
      }
    } catch (err) {
      console.warn('Error restocking store product:', it.inventory_id, err);
    }
  }
}

/**
 * Orders hold buyers' names, addresses and contact details, and this route reads them with the
 * service role, so every handler below checks who is asking first. Someone can see an order if
 * they are its buyer or its seller; admins can see and change all of them.
 */
function isParticipant(order: Order, userId: string, email: string | null | undefined): boolean {
  const o = order as any;
  if (o.user_id === userId || o.seller_id === userId) return true;
  const buyerEmail = o.customer_info?.email;
  return Boolean(email && typeof buyerEmail === 'string' && buyerEmail.toLowerCase() === email.toLowerCase());
}

// GET: the orders the caller is a buyer or seller of (all of them for an admin), newest first
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);

    const scopeParam = url.searchParams.get('scope') || 'all';
    const scope = (scopeParam === 'marketplace' || scopeParam === 'store') ? scopeParam : 'all';
    const sellerId = url.searchParams.get('seller_id');
    const role = url.searchParams.get('role');

    const all = await getStoredOrders(supabaseAdmin, scope);
    let orders = caller.isAdmin ? all : all.filter((o) => isParticipant(o, caller.user.id, caller.user.email));
    if (sellerId) {
      orders = orders.filter((o) => (o as any).seller_id === sellerId);
    }
    if (role === 'buyer') {
      // Strictly only orders where the user was the buyer, never the seller
      orders = orders.filter((o: any) => o.seller_id !== caller.user.id);
    } else if (role === 'seller') {
      // Strictly orders where the user was the seller
      orders = orders.filter((o: any) => o.seller_id === caller.user.id);
    }
    // For non-admin buyers/sellers, filter out soft-deleted orders from personal history view
    if (!caller.isAdmin) {
      orders = orders.filter((o: any) => !o.deleted);
    }
    orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return new Response(JSON.stringify({ success: true, orders }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST: Add a new order or process dynamic store checkout.
// If body.items is present: dynamically verifies product prices and stock against database,
// calculates total strictly on the server (Worker-side verification), and prevents client price manipulation.
// If body.order is present: admin-only order import / manual entry.
export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    const body = await request.json().catch(() => null);
    if (!body) {
      return jsonResponse({ success: false, error: 'Invalid JSON body.' }, 400);
    }

    const client = getSupabaseClient(request);

    // ─── Branch A: Dynamic Server Price Verification (Store / Customer Checkout) ───
    if (Array.isArray(body.items) && body.items.length > 0) {
      // Store checkout is account-only: the account is the identity a purchase limit follows, and
      // it keeps guest orders from being an unlimited second channel.
      if (!caller) {
        return jsonResponse({ success: false, error: 'Sign in to place an order.' }, 401);
      }

      const shippingName = sanitizePlainText(body.shipping_name || body.shippingName, 100);
      const contactEmail = sanitizePlainText(body.contact_email || body.contactEmail, 100);
      const contactPhone = sanitizePlainText(body.contact_phone || body.contactPhone, 50);
      const shippingAddress = sanitizePlainText(body.shipping_address || body.shippingAddress, 300);
      const userNotes = sanitizePlainText(body.notes, 500);

      if (!shippingName) {
        return jsonResponse({ success: false, error: 'Full name is required.' }, 400);
      }
      if (!contactEmail || !contactEmail.includes('@')) {
        return jsonResponse({ success: false, error: 'Valid email address is required.' }, 400);
      }

      const itemRequests: Array<{ inventory_id: string; quantity: number }> = body.items
        .map((it: any) => ({
          inventory_id: String(it.inventory_id || it.inventoryId || ''),
          quantity: Math.max(1, parseInt(String(it.quantity), 10) || 1),
        }))
        .filter((it: any) => Boolean(it.inventory_id));

      if (itemRequests.length === 0) {
        return jsonResponse({ success: false, error: 'No valid items in order.' }, 400);
      }

      // The person a per-customer limit follows: the account, plus the email and phone on this
      // order, so a second account using the same contact details is the same customer.
      const buyer = {
        userId: caller.user.id,
        emails: [caller.user.email, contactEmail],
        phones: [contactPhone],
      };
      const currentOrders = await getStoredOrders(client, 'store');

      // 1. Fetch real Store product prices and available stock from store_products.
      const productIds = itemRequests.map(it => it.inventory_id);
      const { data: productRows, error: productErr } = await supabaseAdmin
        .from('store_products')
        .select('id, name, brand, sku, price_huf, stock_quantity, status, images, attributes')
        .in('id', productIds);

      if (productErr || !productRows) {
        return jsonResponse({ success: false, error: 'Failed to verify store products.' }, 500);
      }

      const productMap = new Map<string, any>(productRows.map((r: any) => [r.id, r]));
      const qtyByProductId = new Map<string, number>();
      for (const reqIt of itemRequests) {
        qtyByProductId.set(reqIt.inventory_id, (qtyByProductId.get(reqIt.inventory_id) || 0) + reqIt.quantity);
      }

      const verifiedItems: any[] = [];
      let calculatedSubtotalHuf = 0;

      for (const reqIt of itemRequests) {
        const product = productMap.get(reqIt.inventory_id);
        if (!product) {
          return jsonResponse({ success: false, error: `Product item ${reqIt.inventory_id} no longer exists.` }, 404);
        }
        const releaseAt = product.attributes?.release_at;
        if (typeof releaseAt === 'string' && releaseAt.trim() && Date.parse(releaseAt) > Date.now()) {
          return jsonResponse({ success: false, error: `Item "${product.name || 'product'}" has not been released yet.` }, 409);
        }
        const totalRequestedForProduct = qtyByProductId.get(reqIt.inventory_id) || reqIt.quantity;

        // The single per-customer limit (units over a rolling window, or lifetime when the window
        // is 0). It caps one basket too, because the requested quantity is part of the count. It
        // follows this buyer's other accounts when they share an email or phone. Basic
        // read-then-write: good enough for normal drops, not a guarantee against simultaneous
        // checkout requests.
        const customerLimit = customerLimitFor(product.attributes);
        if (customerLimit.maxPerCustomer !== null) {
          const already = unitsPurchasedInWindow(currentOrders, buyer, product.id, customerLimit.windowDays);
          if (already + totalRequestedForProduct > customerLimit.maxPerCustomer) {
            const period = customerLimit.windowDays > 0
              ? `per customer per ${customerLimit.windowDays} day${customerLimit.windowDays === 1 ? '' : 's'}`
              : 'per customer in total';
            const bought = already > 0 ? ` You already bought ${already}.` : '';
            return jsonResponse({
              success: false,
              error: `Item "${product.name || 'product'}" is limited to ${customerLimit.maxPerCustomer} ${period}.${bought}`,
            }, 400);
          }
        }

        if (product.status !== 'active' || (typeof product.stock_quantity === 'number' && product.stock_quantity < totalRequestedForProduct)) {
          return jsonResponse({ success: false, error: `Item ${product.name || 'product'} is out of stock or does not have enough copies.` }, 409);
        }

        // Price is read strictly from the database, ignoring any client-sent price.
        const verifiedPriceHuf = Math.max(0, Math.round(Number(product.price_huf) || 0));
        calculatedSubtotalHuf += (verifiedPriceHuf * reqIt.quantity);

        const images = Array.isArray(product.images) ? product.images : [];
        verifiedItems.push({
          inventory_id: product.id,
          card_id: '',
          card_name: product.name || 'Store Product',
          card_number: product.sku || '',
          set_name: product.brand || '',
          condition: 'Sealed',
          is_foil: false,
          price_huf: verifiedPriceHuf, // DATABASE TRUTH
          quantity: reqIt.quantity,
          image_path: images[0] || '',
        });
      }

      const shippingHuf = Math.max(0, parseInt(String(body.shipping_huf || body.shippingHuf || 0), 10) || 0);
      const totalHuf = calculatedSubtotalHuf + shippingHuf;

      // 2. Decrement Store stock in the database.
      for (const reqIt of itemRequests) {
        const product = productMap.get(reqIt.inventory_id)!;
        const remaining = Math.max(0, (Number(product.stock_quantity) || 0) - reqIt.quantity);
        await supabaseAdmin
          .from('store_products')
          .update({ stock_quantity: remaining, status: remaining > 0 ? 'active' : 'out_of_stock', updated_at: new Date().toISOString() })
          .eq('id', product.id);
      }

      // 3. Assemble verified order
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
      const orderNumber = `ORD-${datePart}-${randPart}`;
      const orderId = crypto.randomUUID();

      const newOrder: Order = {
        id: orderId,
        order_number: orderNumber,
        user_id: caller.user.id,
        status: 'Pending',
        total_price_huf: totalHuf,
        shipping_name: shippingName,
        shipping_address: shippingAddress || 'Standard Delivery',
        tracking_number: null,
        payment_method: body.payment_method || 'stripe',
        payment_status: 'pending',
        notes: [
          contactPhone ? `Phone: ${contactPhone}` : '',
          contactEmail ? `Email: ${contactEmail}` : '',
          userNotes ? `Notes: ${userNotes}` : '',
        ].filter(Boolean).join(' | ') || null,
        customer_info: {
          name: shippingName,
          email: contactEmail || caller.user.email || undefined,
          phone: contactPhone || undefined,
          address: shippingAddress || undefined,
        },
        items: verifiedItems,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };

      const updated = [newOrder, ...currentOrders.filter(o => o.order_number !== newOrder.order_number)];
      await saveStoredOrders(updated, client, newOrder);

      await persistOrderItemsSnapshot(orderId, orderNumber, verifiedItems);
      notifyOwnerStoreOrder({
        orderNumber,
        customerName: shippingName,
        customerEmail: contactEmail || caller?.user?.email || 'guest',
        totalHuf,
        shippingMethod: shippingAddress || 'Standard Delivery',
        itemCount: verifiedItems.reduce((sum, i) => sum + i.quantity, 0),
      }).catch(() => {});
      await logOrderEvent({
        orderNumber,
        orderId,
        eventType: 'order_created',
        message: `Order #${orderNumber} placed dynamically with ${verifiedItems.length} items. Total: ${totalHuf} HUF.`,
        severity: 'info',
        metadata: {
          subtotalHuf: calculatedSubtotalHuf,
          shippingHuf,
          totalPriceHuf: totalHuf,
          paymentMethod: newOrder.payment_method,
        },
      });

      if (caller?.user?.id && caller.user.id !== 'guest') {
        try {
          const { data: owners } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .or('role.eq.owner,is_admin.eq.true')
            .order('created_at', { ascending: true })
            .limit(1);
          const storeOwnerId = owners?.[0]?.id || 'd47ca466-6520-46ec-aff2-718732f1baf7';
          const convoId = await getOrCreateConversation(caller.user.id, storeOwnerId);
          if (convoId) {
            const itemCount = verifiedItems.reduce((sum, i) => sum + i.quantity, 0);
            await postSystemMessage(
              convoId,
              storeOwnerId,
              `Store Order #${orderNumber} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'} · ${Number(totalHuf).toLocaleString('hu-HU')} Ft`,
              {
                metadata: {
                  store_order: true,
                  order_number: orderNumber,
                  order_id: orderId,
                  total_price_huf: totalHuf,
                  status: newOrder.status,
                  item_count: itemCount,
                  items: verifiedItems.slice(0, 10).map((i) => ({
                    name: i.card_name,
                    sku: i.card_number,
                    quantity: i.quantity,
                    price_huf: i.price_huf,
                    image: i.image_path,
                  })),
                  shipping_name: shippingName,
                  shipping_address: shippingAddress,
                },
              }
            );
          }
        } catch (chatErr) {
          console.warn('Failed to start chat thread for new store order:', chatErr);
        }
      }

      return jsonResponse({ success: true, order: newOrder }, 201);
    }

    // ─── Branch B: Admin Direct Order Import / Manual Entry ───
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    if (!caller.isAdmin) return jsonResponse({ success: false, error: 'Forbidden: admin access required.' }, 403);

    const newOrder = body.order as Order;
    if (!newOrder || !newOrder.order_number) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid order payload.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const currentOrders = await getStoredOrders(client);
    const updated = [newOrder, ...currentOrders.filter(o => o.order_number !== newOrder.order_number)];
    const saved = await saveStoredOrders(updated, client, newOrder);

    if (!saved) {
      return new Response(JSON.stringify({ success: false, error: 'Failed to persist order in cloud database.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const orderId = newOrder.id || `ord_${newOrder.order_number}`;
    await persistOrderItemsSnapshot(orderId, newOrder.order_number, newOrder.items || []);

    await logOrderEvent({
      orderNumber: newOrder.order_number,
      orderId: newOrder.id,
      eventType: 'order_created',
      message: `Order #${newOrder.order_number} created with ${(newOrder.items || []).length} items.`,
      severity: 'info',
      metadata: {
        totalPriceHuf: newOrder.total_price_huf ?? newOrder.total_huf,
        paymentMethod: newOrder.payment_method,
        paymentStatus: newOrder.payment_status,
      },
    });

    return new Response(JSON.stringify({ success: true, order: newOrder }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// PATCH: Update order status (e.g. mark as 'Shipped', tracking number, notes, payment status)
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);

    const client = getSupabaseClient(request);
    const body = await request.json();
    const orderNumber = body.orderNumber || body.order_number;
    const status = body.status;
    const trackingNumber = body.trackingNumber !== undefined ? body.trackingNumber : body.tracking_number;
    const courierName = body.courierName !== undefined ? body.courierName : body.courier_name;
    const notes = body.notes;
    const payment_status = body.payment_status;
    const paymentStatus = body.paymentStatus;
    const payment_method = body.payment_method;
    const paymentMethod = body.paymentMethod;
    const payment_id = body.payment_id;
    const paymentId = body.paymentId;
    const cancellationReason = body.cancellationReason;
    const cancellation_reason = body.cancellation_reason;
    // Full order object sent when upsert is needed (order not yet in store_orders)
    const orderData = body.orderData;

    if (!orderNumber) {
      return new Response(JSON.stringify({ success: false, error: 'Order number is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const currentOrders = await getStoredOrders(client);
    let targetIdx = currentOrders.findIndex(o => o.order_number === orderNumber);

    if (!caller.isAdmin) {
      // Only the buyer or seller of an existing order can change it, and only its status and notes:
      // payment details are set by the server side of a sale.
      if (targetIdx === -1 || !isParticipant(currentOrders[targetIdx], caller.user.id, caller.user.email)) {
        return jsonResponse({ success: false, error: 'Order not found.' }, 404);
      }
      const touchesPayment = [payment_status, paymentStatus, payment_method, paymentMethod, payment_id, paymentId].some((v) => v !== undefined);
      if (touchesPayment) return jsonResponse({ success: false, error: 'Forbidden: admin access required.' }, 403);
    }

    // ── Upsert: if order not in store_orders, add it so the update can proceed (admins only) ──
    if (targetIdx === -1) {
      const stub: Order = (orderData && orderData.order_number === orderNumber)
        ? { ...orderData }
        : {
            id: orderNumber,
            order_number: orderNumber,
            status: status || 'Pending',
            payment_status: payment_status || paymentStatus || 'pending',
            payment_method: payment_method || paymentMethod || 'stripe',
            payment_id: payment_id || paymentId || '',
            items: [],
            total_price_huf: 0,
            total_huf: 0,
            shipping_name: '',
            shipping_address: '',
            customer_info: {},
            notes: notes || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as unknown as Order;

      currentOrders.unshift(stub);
      targetIdx = 0;
    }

    const previousOrder = currentOrders[targetIdx];
    const newPaymentStatus = payment_status || paymentStatus || previousOrder.payment_status;
    const newPaymentMethod = payment_method || paymentMethod || previousOrder.payment_method || 'stripe';
    const newPaymentId = payment_id || paymentId || previousOrder.payment_id;

    // Determine next order status
    let nextStatus = status || previousOrder.status;
    if (!status && (newPaymentStatus === 'paid' && previousOrder.status === 'Pending')) {
      nextStatus = 'Processing';
    }

    // If cancelling an active order, return items back to stock
    if (nextStatus === 'Cancelled' && previousOrder.status !== 'Cancelled') {
      await restockOrderItems(previousOrder.items);
    }

    const updatedOrder: Order = {
      ...previousOrder,
      status: nextStatus,
      payment_status: newPaymentStatus,
      payment_method: newPaymentMethod,
      payment_id: newPaymentId,
      cancelled_at: nextStatus === 'Cancelled' ? (previousOrder.cancelled_at || new Date().toISOString()) : previousOrder.cancelled_at,
      cancellation_reason: nextStatus === 'Cancelled' ? (cancellationReason || cancellation_reason || previousOrder.cancellation_reason) : previousOrder.cancellation_reason,
      tracking_number: trackingNumber !== undefined ? trackingNumber : previousOrder.tracking_number,
      courier_name: courierName !== undefined ? courierName : (previousOrder as any).courier_name,
      notes: notes !== undefined ? notes : previousOrder.notes,
      updated_at: new Date().toISOString(),
    };

    currentOrders[targetIdx] = updatedOrder;
    const saved = await saveStoredOrders(currentOrders, client, updatedOrder);

    if (!saved) {
      return new Response(JSON.stringify({ success: false, error: 'Failed to update order in cloud database.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await logOrderEvent({
      orderNumber,
      orderId: updatedOrder.id,
      eventType: nextStatus === 'Cancelled' ? 'order_cancelled' : 'order_updated',
      message: `Order #${orderNumber} updated: status=${nextStatus}, payment_status=${newPaymentStatus}.`,
      severity: nextStatus === 'Cancelled' ? 'warn' : 'info',
      metadata: {
        previousStatus: previousOrder.status,
        newStatus: nextStatus,
        paymentStatus: newPaymentStatus,
        cancellationReason: updatedOrder.cancellation_reason,
        trackingNumber: updatedOrder.tracking_number,
      },
    });

    // Notify customer in chat if tracking number was updated or order was completed
    const isNewTracking = Boolean(trackingNumber && trackingNumber !== previousOrder.tracking_number);
    const isNowDelivered = Boolean(nextStatus === 'Delivered' && previousOrder.status !== 'Delivered');

    if (updatedOrder.user_id && updatedOrder.user_id !== 'guest' && (isNewTracking || isNowDelivered)) {
      try {
        const { data: owners } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .or('role.eq.owner,is_admin.eq.true')
          .order('created_at', { ascending: true })
          .limit(1);
        const storeOwnerId = owners?.[0]?.id || 'd47ca466-6520-46ec-aff2-718732f1baf7';
        const convoId = await getOrCreateConversation(updatedOrder.user_id, storeOwnerId);
        if (convoId) {
          if (isNewTracking) {
            const courierStr = courierName || (updatedOrder as any).courier_name || 'Courier';
            await postSystemMessage(
              convoId,
              storeOwnerId,
              `Order #${orderNumber} updated · Tracking number: ${trackingNumber} (${courierStr})`,
              {
                metadata: {
                  store_order: true,
                  is_tracking_update: true,
                  order_number: orderNumber,
                  tracking_number: trackingNumber,
                  courier_name: courierStr,
                  status: nextStatus,
                },
              }
            );
          }
          if (isNowDelivered) {
            await postSystemMessage(
              convoId,
              storeOwnerId,
              `Order #${orderNumber} completed`,
              {
                metadata: {
                  store_order: true,
                  order_number: orderNumber,
                  status: 'Delivered',
                },
              }
            );
          }
        }
      } catch (chatUpdateErr) {
        console.warn('Failed to post order update chat message:', chatUpdateErr);
      }
    }

    return new Response(JSON.stringify({ success: true, order: updatedOrder }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE: Remove one or more orders (by orderNumber comma list) or purge all test orders
export const DELETE: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);

    const url = new URL(request.url);
    const orderNumberParam = url.searchParams.get('orderNumber') || '';
    const purgeAll = url.searchParams.get('all') === 'true' || orderNumberParam === 'all';
    const scope = url.searchParams.get('scope') || (caller.isAdmin ? 'global' : 'mine');

    const isUsersOrder = (o: Order) => {
      if (o.user_id && o.user_id === caller.user.id) return true;
      const email = caller.user.email?.toLowerCase();
      if (email && o.customer_info?.email && o.customer_info.email.toLowerCase() === email) return true;
      return false;
    };

    if (purgeAll) {
      if (scope === 'global' && caller.isAdmin) {
        await saveStoredOrders([], supabaseAdmin);
        try {
          await supabaseAdmin.from('orders').delete().neq('order_number', '__dummy__');
        } catch (e) {}
      } else {
        const currentOrders = await getStoredOrders(supabaseAdmin);
        // Soft delete: keep store records for accounting, mark deleted = true for user history
        const updated = currentOrders.map((o: any) => {
          if (isUsersOrder(o)) {
            return { ...o, deleted: true, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          }
          return o;
        });
        await saveStoredOrders(updated, supabaseAdmin);
        try {
          await supabaseAdmin.from('orders').update({ deleted: true, updated_at: new Date().toISOString() }).eq('user_id', caller.user.id);
        } catch (e) {}
      }

      try {
        await supabaseAdmin.auth.admin.updateUserById(caller.user.id, {
          user_metadata: {
            ...(caller.user.user_metadata || {}),
            saved_orders: [],
          },
        });
      } catch (e) {}

      return jsonResponse({ success: true, purged: true });
    }

    const targets = orderNumberParam
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (targets.length === 0) {
      return jsonResponse({ success: false, error: 'orderNumber parameter required' }, 400);
    }

    const targetSet = new Set(targets);
    const currentOrders = await getStoredOrders(supabaseAdmin);

    // Non-admins can only delete orders belonging to their own account/email
    const removableSet = new Set<string>();
    for (const num of targetSet) {
      const found = currentOrders.find(o => o.order_number === num || o.id === num);
      if (caller.isAdmin) {
        removableSet.add(num);
      } else if (found && isUsersOrder(found)) {
        removableSet.add(num);
      }
    }

    if (removableSet.size === 0) {
      return jsonResponse({ success: false, error: 'Forbidden: you can only delete your own orders.' }, 403);
    }

    // Soft delete: keep order records in database for accounting, mark deleted = true
    const updated = currentOrders.map((o: any) => {
      if (removableSet.has(o.order_number) || (o.id && removableSet.has(o.id))) {
        return {
          ...o,
          deleted: true,
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      return o;
    });
    const saved = await saveStoredOrders(updated, supabaseAdmin);

    try {
      await supabaseAdmin
        .from('orders')
        .update({ deleted: true, updated_at: new Date().toISOString() })
        .in('order_number', [...removableSet]);
    } catch (e) {}

    // Also clean caller's user_metadata.saved_orders so deleted orders don't resurrect on reload
    try {
      const existingMeta = caller.user.user_metadata || {};
      if (Array.isArray(existingMeta.saved_orders)) {
        const nextSaved = existingMeta.saved_orders.filter(
          (o: any) => !removableSet.has(o?.order_number) && !removableSet.has(o?.id)
        );
        await supabaseAdmin.auth.admin.updateUserById(caller.user.id, {
          user_metadata: {
            ...existingMeta,
            saved_orders: nextSaved,
          },
        });
      }
    } catch (e) {}

    return jsonResponse({ success: saved, deleted: [...removableSet] }, saved ? 200 : 500);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};
