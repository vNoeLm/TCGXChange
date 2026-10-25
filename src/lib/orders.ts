import type { Order, OrderItem, CatalogCard } from '../types';
import { supabase } from './supabase';
import { getCurrentUser } from './auth';
import { clearStoreCache, clearApiCache } from './api';

const ORDERS_STORAGE_KEY = 'tcg_user_orders';

export interface OrderItemInput {
  inventoryId?: string;
  card: CatalogCard;
  condition?: string;
  isFoil?: boolean;
  priceHuf: number;
  quantity: number;
}

export interface CreateOrderParams {
  items?: OrderItemInput[];
  // Backwards compatibility for single-card checkout:
  inventoryId?: string;
  card?: CatalogCard;
  condition?: string;
  isFoil?: boolean;
  priceHuf?: number;
  quantity?: number;

  // Detailed Customer & Shipping Information
  shippingName: string;
  contactEmail: string;
  contactPhone?: string;
  postalCode?: string;
  city?: string;
  streetAddress?: string;
  houseNumber?: string;
  shippingAddress?: string;
  notes?: string;
  paymentMethod?: string;
  paymentStatus?: 'pending' | 'paid' | 'refunded';
  paymentId?: string;
}

/**
 * Generate a clean human-readable order number, e.g. ORD-849201-382
 */
export function generateOrderNumber(): string {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(100 + Math.random() * 900);
  return `ORD-${timestamp}-${random}`;
}

/**
 * The orders the server says the signed-in user can see (their own, or all for an admin). The
 * server checks who is asking; orders are not readable straight from the database.
 */
async function fetchVisibleOrders(): Promise<{ ok: boolean; orders: Order[] }> {
  if (typeof window === 'undefined') return { ok: false, orders: [] };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return { ok: false, orders: [] };
  const res = await fetch('/api/orders', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, orders: [] };
  const json = await res.json().catch(() => null);
  return json?.success && Array.isArray(json.orders)
    ? { ok: true, orders: json.orders }
    : { ok: false, orders: [] };
}

/**
 * Get all orders for the current user or guest session.
 * Strictly isolates orders by user ID and email to prevent cross-account contamination.
 */
export async function fetchUserOrders(): Promise<Order[]> {
  const user = await getCurrentUser();
  const userStorageKey = user ? `${ORDERS_STORAGE_KEY}_${user.id}` : ORDERS_STORAGE_KEY;

  const localOrders: Order[] = [];
  if (typeof window !== 'undefined') {
    try {
      // 1. Try user-scoped storage key first
      let raw = localStorage.getItem(userStorageKey);
      // Fallback to shared legacy key if user-scoped key is empty
      if (!raw && user) {
        raw = localStorage.getItem(ORDERS_STORAGE_KEY);
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          localOrders.push(...parsed);
        }
      }
    } catch (e) {
      console.warn('Failed to parse local orders:', e);
    }
  }

  const orderMap = new Map<string, Order>();

  // Filter localOrders strictly for this user
  localOrders.forEach(ord => {
    if (user) {
      const isMyUserId = ord.user_id === user.id;
      const isMyEmail = Boolean(user.email && ord.customer_info?.email && ord.customer_info.email.toLowerCase() === user.email.toLowerCase());
      // ONLY add if it belongs to this user or is an unassociated guest order with matching email
      if (isMyUserId || isMyEmail) {
        const key = ord.order_number || ord.id;
        if (key) orderMap.set(key, { ...ord, user_id: ord.user_id || user.id });
      }
    } else {
      // Guest session: only orders with no user_id
      if (!ord.user_id) {
        const key = ord.order_number || ord.id;
        if (key) orderMap.set(key, ord);
      }
    }
  });

  // If user is authenticated, merge cloud orders from user_metadata
  if (user && user.user_metadata?.saved_orders && Array.isArray(user.user_metadata.saved_orders)) {
    const cloudOrders: Order[] = user.user_metadata.saved_orders;
    cloudOrders.forEach(ord => {
      const isMyUserId = !ord.user_id || ord.user_id === user.id;
      const isMyEmail = Boolean(user.email && ord.customer_info?.email && ord.customer_info.email.toLowerCase() === user.email.toLowerCase());
      if (isMyUserId || isMyEmail) {
        const key = ord.order_number || ord.id;
        if (key) orderMap.set(key, { ...ord, user_id: user.id });
      }
    });
  }

  // Sync latest statuses from store_orders in Supabase settings
  try {
    const { ok: serverOk, orders: allStoreOrders } = await fetchVisibleOrders();
    if (serverOk && user) {
      const serverKeys = new Set(allStoreOrders.map(o => o.order_number || o.id).filter(Boolean));
      const now = Date.now();
      for (const [key, ord] of orderMap.entries()) {
        const ageMs = now - new Date(ord.created_at || 0).getTime();
        // If order is older than 30s and no longer exists on the server, it was deleted
        if (!serverKeys.has(key) && ageMs > 30_000) {
          orderMap.delete(key);
        }
      }
    }
    if (Array.isArray(allStoreOrders)) {
      allStoreOrders.forEach(stOrd => {
        const key = stOrd.order_number || stOrd.id;
        if (user) {
          const isMyUserId = stOrd.user_id === user.id;
          const isMyEmail = Boolean(user.email && stOrd.customer_info?.email && stOrd.customer_info.email.toLowerCase() === user.email.toLowerCase());
          if (isMyUserId || isMyEmail) {
            const existing = orderMap.get(key) || stOrd;
            const isPaid = stOrd.payment_status === 'paid' || existing.payment_status === 'paid';
            const resolvedPaymentStatus = isPaid ? 'paid' : (stOrd.payment_status || existing.payment_status);
            const resolvedStatus = isPaid && (stOrd.status === 'Pending' || existing.status === 'Pending')
              ? 'Processing'
              : (stOrd.status !== 'Pending' ? stOrd.status : existing.status);

            orderMap.set(key, {
              ...existing,
              ...stOrd,
              user_id: user.id,
              payment_status: resolvedPaymentStatus,
              status: resolvedStatus,
            });
          }
        } else if (orderMap.has(key)) {
          const existing = orderMap.get(key)!;
          orderMap.set(key, { ...existing, ...stOrd });
        }
      });
    }
  } catch (e) {
    console.warn('Could not sync store_orders latest statuses:', e);
  }

  const merged = Array.from(orderMap.values()).filter((o: any) => !o.deleted);
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Save back only this user's verified orders to their user-scoped storage key
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(userStorageKey, JSON.stringify(merged));
      // If user is logged in, purge legacy shared key if it had cross-user data
      if (user && localStorage.getItem(ORDERS_STORAGE_KEY)) {
        localStorage.removeItem(ORDERS_STORAGE_KEY);
      }
    } catch (e) {}
  }

  return merged;
}

/**
 * Place a new multi-item or single-item order:
 * 1. Decrements database inventory quantity for each item (marking 'Sold' if 0).
 * 2. Persists order in localStorage and user_metadata.
 * 3. Dispatches order and inventory change events.
 */
export async function createOrder(params: CreateOrderParams): Promise<{ success: boolean; order?: Order; error?: string }> {
  try {
    const {
      shippingName,
      contactEmail,
      contactPhone,
      postalCode,
      city,
      streetAddress,
      houseNumber,
      shippingAddress,
      notes,
    } = params;

    if (!shippingName.trim()) {
      return { success: false, error: 'Please enter your full name.' };
    }

    if (!contactEmail.trim()) {
      return { success: false, error: 'Please enter your email address.' };
    }

    // Build normalized order items
    const orderItems: OrderItem[] = [];
    const inventoryDeductions: Array<{ inventoryId?: string; quantity: number }> = [];

    if (params.items && params.items.length > 0) {
      params.items.forEach(it => {
        if (it.quantity > 0) {
          orderItems.push({
            inventory_id: it.inventoryId,
            card_id: it.card.id,
            card_name: it.card.name,
            card_number: it.card.card_number,
            set_name: it.card.set_name,
            condition: it.condition || 'Near Mint',
            is_foil: Boolean(it.isFoil),
            price_huf: it.priceHuf,
            quantity: it.quantity,
            image_path: it.card.image_path,
          });
          if (it.inventoryId) {
            inventoryDeductions.push({ inventoryId: it.inventoryId, quantity: it.quantity });
          }
        }
      });
    } else if (params.card && typeof params.priceHuf === 'number' && typeof params.quantity === 'number') {
      if (params.quantity > 0) {
        orderItems.push({
          inventory_id: params.inventoryId,
          card_id: params.card.id,
          card_name: params.card.name,
          card_number: params.card.card_number,
          set_name: params.card.set_name,
          condition: params.condition || 'Near Mint',
          is_foil: Boolean(params.isFoil),
          price_huf: params.priceHuf,
          quantity: params.quantity,
          image_path: params.card.image_path,
        });
        if (params.inventoryId) {
          inventoryDeductions.push({ inventoryId: params.inventoryId, quantity: params.quantity });
        }
      }
    }

    if (orderItems.length === 0) {
      return { success: false, error: 'No items in order.' };
    }

    const totalHuf = orderItems.reduce((sum, it) => sum + (it.price_huf * it.quantity), 0);

    const user = await getCurrentUser();
    const orderNumber = generateOrderNumber();
    const now = new Date().toISOString();

    // Compile detailed address
    const compiledAddress = [
      postalCode ? postalCode.trim() : '',
      city ? city.trim() : '',
      streetAddress ? (houseNumber ? `${streetAddress.trim()} ${houseNumber.trim()}` : streetAddress.trim()) : '',
    ].filter(Boolean).join(', ') || shippingAddress?.trim() || 'Pickup / Contact provided';

    const fullContactNotes = [
      contactPhone ? `Phone: ${contactPhone.trim()}` : '',
      contactEmail ? `Email: ${contactEmail.trim()}` : '',
      notes ? `Notes: ${notes.trim()}` : '',
    ].filter(Boolean).join(' | ');

    const newOrder: Order = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `order-${Date.now()}`,
      order_number: orderNumber,
      user_id: user?.id || 'guest',
      status: 'Pending',
      total_price_huf: totalHuf,
      shipping_name: shippingName.trim(),
      shipping_address: compiledAddress,
      tracking_number: null,
      payment_method: params.paymentMethod || 'manual',
      payment_status: params.paymentStatus || (params.paymentMethod === 'manual' ? 'pending' : 'pending'),
      payment_id: params.paymentId || null,
      notes: fullContactNotes || null,
      items: orderItems,
      created_at: now,
      updated_at: now,
    };

    // ── 1. Decrement Store stock in the database for all items ──
    for (const deduction of inventoryDeductions) {
      if (!deduction.inventoryId) continue;
      try {
        const { data: product } = await supabase
          .from('store_products')
          .select('id, stock_quantity, status')
          .eq('id', deduction.inventoryId)
          .maybeSingle();

        if (product) {
          const currentQty = typeof product.stock_quantity === 'number' ? product.stock_quantity : 1;
          const remainingQty = Math.max(0, currentQty - deduction.quantity);

          await supabase
            .from('store_products')
            .update({
              stock_quantity: remainingQty,
              status: remainingQty > 0 ? 'active' : 'out_of_stock',
              updated_at: new Date().toISOString(),
            })
            .eq('id', deduction.inventoryId);
        }
      } catch (invErr) {
        console.warn('Could not decrement store product:', deduction.inventoryId, invErr);
      }
    }

    // ── 2. Persist in Local Storage (User-scoped) ──
    if (typeof window !== 'undefined') {
      try {
        const userKey = user ? `${ORDERS_STORAGE_KEY}_${user.id}` : ORDERS_STORAGE_KEY;
        const raw = localStorage.getItem(userKey);
        const existing: Order[] = raw ? JSON.parse(raw) : [];
        const updated = [newOrder, ...existing.filter(o => o.order_number !== newOrder.order_number)];
        localStorage.setItem(userKey, JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save order to localStorage:', e);
      }
    }

    // ── 3. Persist in User Cloud Metadata if Logged In ──
    if (user) {
      try {
        const existingCloud: Order[] = (user.user_metadata?.saved_orders as Order[]) || [];
        const updatedCloud = [newOrder, ...existingCloud.filter(o => o.order_number !== newOrder.order_number)];
        await supabase.auth.updateUser({
          data: {
            saved_orders: updatedCloud,
          },
        });
      } catch (cloudErr) {
        console.warn('Failed to sync order to user_metadata:', cloudErr);
      }
    }

    // ── 4. Persist in Store-Wide Central Orders Database via /api/orders & direct client fallback ──
    if (typeof window !== 'undefined') {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (sessionData?.session?.access_token) {
          headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
        }
        await fetch('/api/orders', {
          method: 'POST',
          headers,
          body: JSON.stringify({ order: newOrder }),
        });
      } catch (e) {
        console.warn('Could not post order to /api/orders:', e);
      }

      // Direct client fallback to sync settings.store_orders & orders table
      try {
        const { data: storeRow } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'store_orders')
          .maybeSingle();

        let list: Order[] = storeRow?.value ? JSON.parse(storeRow.value) : [];
        if (!list.some(o => o.order_number === newOrder.order_number)) {
          list.unshift(newOrder);
          await supabase.from('settings').upsert({
            key: 'store_orders',
            value: JSON.stringify(list),
          });
        }

        // Also sync to public.orders table if it exists
        try {
          const isUuid = (val?: string | null) => Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));
          const validUserId = isUuid(newOrder.user_id) ? newOrder.user_id : null;
          const validOrderId = isUuid(newOrder.id) ? newOrder.id : undefined;

          await supabase.from('orders').upsert({
            ...(validOrderId ? { id: validOrderId } : {}),
            order_number: newOrder.order_number,
            user_id: validUserId,
            status: newOrder.status,
            total_price_huf: newOrder.total_price_huf,
            shipping_name: newOrder.shipping_name,
            shipping_address: newOrder.shipping_address,
            payment_method: newOrder.payment_method,
            payment_status: newOrder.payment_status,
            notes: newOrder.notes,
            items: newOrder.items,
            created_at: newOrder.created_at,
            updated_at: newOrder.updated_at,
          }, { onConflict: 'order_number' });
        } catch (e) {}
      } catch (directErr) {
        console.warn('Direct store_orders sync in createOrder failed:', directErr);
      }
    }

    // ── 5. Clear Caches & Dispatch Notification Events ──
    clearStoreCache();
    clearApiCache();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tcg-orders-changed', { detail: { order: newOrder } }));
      window.dispatchEvent(new CustomEvent('tcg-store-inventory-change'));
    }

    return { success: true, order: newOrder };
  } catch (err: any) {
    console.error('Failed to create order:', err);
    return { success: false, error: err?.message || 'Failed to place order.' };
  }
}

/**
 * Fetch all store orders for Admin / Owner order management.
 * Queries /api/orders with fallback to Supabase settings table.
 */
export async function fetchStoreOrders(): Promise<Order[]> {
  const storeMap = new Map<string, Order>();

  try {
    if (typeof window !== 'undefined') {
      const res = await fetchVisibleOrders();
      (res.orders || []).forEach((o: Order) => {
        const key = o.order_number || o.id;
        if (key) storeMap.set(key, o);
      });
    }

    // Direct check to public.orders table if it exists
    try {
      const { data: tableOrders } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (Array.isArray(tableOrders)) {
        tableOrders.forEach((o: any) => {
          const key = o.order_number || o.id;
          if (key) {
            if (storeMap.has(key)) {
              storeMap.set(key, { ...storeMap.get(key)!, ...o });
            } else {
              storeMap.set(key, o as Order);
            }
          }
        });
      }
    } catch (e) {}

    // Direct check to Supabase settings table
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'store_orders')
      .maybeSingle();

    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (Array.isArray(parsed)) {
        parsed.forEach((stOrd: Order) => {
          const key = stOrd.order_number || stOrd.id;
          if (key) {
            if (storeMap.has(key)) {
              storeMap.set(key, { ...storeMap.get(key)!, ...stOrd });
            } else {
              storeMap.set(key, stOrd);
            }
          }
        });
      }
      // If store_orders was explicitly purged to empty array in cloud, wipe local storage on this machine
      if (parsed.length === 0 && typeof window !== 'undefined') {
        localStorage.removeItem(ORDERS_STORAGE_KEY);
      }
    }

    // Direct check to authenticated user's saved_orders in metadata
    try {
      const currentUser = await getCurrentUser();
      if (currentUser?.user_metadata?.saved_orders && Array.isArray(currentUser.user_metadata.saved_orders)) {
        currentUser.user_metadata.saved_orders.forEach((ord: Order) => {
          const key = ord.order_number || ord.id;
          if (key && !storeMap.has(key)) {
            storeMap.set(key, ord);
          }
        });
      }
    } catch (e) {}
  } catch (e) {
    console.warn('Failed to fetch store orders:', e);
  }

  // Include any unsynced orders stored locally only if cloud isn't explicitly empty
  if (typeof window !== 'undefined') {
    try {
      const rawLocal = localStorage.getItem(ORDERS_STORAGE_KEY);
      if (rawLocal && storeMap.size > 0) {
        const localList: Order[] = JSON.parse(rawLocal);
        if (Array.isArray(localList)) {
          localList.forEach(lo => {
            const key = lo.order_number || lo.id;
            if (key && !storeMap.has(key)) {
              storeMap.set(key, lo);
            }
          });
        }
      }
    } catch (e) {}
  }

  const merged = Array.from(storeMap.values());
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return merged;
}

/**
 * Update an order's status (e.g. from 'Pending' to 'Shipped').
 * Acts as delivery confirmation for store owner.
 */
export async function updateOrderStatus(
  orderNumber: string,
  status: Order['status'],
  trackingNumber?: string | null,
  notes?: string | null,
  orderData?: Order | null
): Promise<{ success: boolean; order?: Order; error?: string }> {
  try {
    let updatedOrder: Order | null = null;

    if (typeof window !== 'undefined') {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionData?.session?.access_token) {
        headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
      }

      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ orderNumber, status, trackingNumber, notes, orderData: orderData || undefined }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.order) {
          updatedOrder = json.order;
        }
      } else {
        const json = await res.json().catch(() => null);
        return { success: false, error: json?.error || 'Failed to update payment status.' };
      }
    }

    // Direct client fallback using authenticated Supabase session if API was unreachable or failed
    if (!updatedOrder) {
      try {
        // 1. Try public.orders table
        await supabase
          .from('orders')
          .update({
            status,
            tracking_number: trackingNumber !== undefined ? trackingNumber : undefined,
            notes: notes !== undefined ? notes : undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('order_number', orderNumber);

        // 2. Direct settings.store_orders update
        const { data: storeRow } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'store_orders')
          .maybeSingle();

        let list: Order[] = storeRow?.value ? JSON.parse(storeRow.value) : [];
        const idx = list.findIndex(o => o.order_number === orderNumber);
        if (idx !== -1) {
          list[idx] = {
            ...list[idx],
            status,
            ...(trackingNumber !== undefined ? { tracking_number: trackingNumber } : {}),
            ...(notes !== undefined ? { notes } : {}),
            updated_at: new Date().toISOString(),
          };
          updatedOrder = list[idx];
        } else if (orderData) {
          updatedOrder = {
            ...orderData,
            status,
            ...(trackingNumber !== undefined ? { tracking_number: trackingNumber } : {}),
            ...(notes !== undefined ? { notes } : {}),
            updated_at: new Date().toISOString(),
          };
          list.unshift(updatedOrder);
        }

        if (updatedOrder) {
          await supabase.from('settings').upsert({
            key: 'store_orders',
            value: JSON.stringify(list),
          });
        }
      } catch (fallbackErr) {
        console.warn('Client fallback update failed:', fallbackErr);
      }
    }

    if (!updatedOrder) {
      return { success: false, error: 'Failed to update order status.' };
    }

    // Sync in local storage if present on this device
    if (typeof window !== 'undefined' && updatedOrder) {
      try {
        const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
        if (raw) {
          const orders: Order[] = JSON.parse(raw);
          const idx = orders.findIndex(o => o.order_number === orderNumber);
          if (idx !== -1) {
            orders[idx] = updatedOrder;
            localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
          }
        }
      } catch (e) {}

      // Sync in user_metadata if order belongs to current user
      try {
        const currentUser = await getCurrentUser();
        if (currentUser?.user_metadata?.saved_orders && Array.isArray(currentUser.user_metadata.saved_orders)) {
          const userOrders: Order[] = currentUser.user_metadata.saved_orders;
          const uIdx = userOrders.findIndex(o => o.order_number === orderNumber);
          if (uIdx !== -1) {
            userOrders[uIdx] = updatedOrder;
            await supabase.auth.updateUser({
              data: { saved_orders: userOrders }
            });
          }
        }
      } catch (e) {}

      window.dispatchEvent(new CustomEvent('tcg-orders-changed', { detail: { order: updatedOrder } }));
    }

    return { success: true, order: updatedOrder };
  } catch (err: any) {
    console.error('Failed to update order status:', err);
    return { success: false, error: err?.message || 'Failed to update order status.' };
  }
}

/**
 * Cancel an active customer order before shipment.
 * Updates order status to 'Cancelled', restocks inventory automatically on server,
 * and clears cache + dispatches events.
 */
export async function cancelOrder(orderNumber: string): Promise<{ success: boolean; error?: string; order?: Order }> {
  const result = await updateOrderStatus(orderNumber, 'Cancelled');
  if (result.success) {
    clearStoreCache();
    clearApiCache();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tcg-inventory-changed'));
    }
  }
  return result;
}

/**
 * Update an order's payment status, method, and transaction/session ID.
 */
export async function updateOrderPayment(
  orderNumber: string,
  paymentStatus: 'pending' | 'paid' | 'refunded',
  paymentMethod?: string,
  paymentId?: string,
  orderData?: Order | null
): Promise<{ success: boolean; order?: Order; error?: string }> {
  try {
    let updatedOrder: Order | null = null;

    if (typeof window !== 'undefined') {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionData?.session?.access_token) {
        headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
      }

      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          orderNumber,
          payment_status: paymentStatus,
          payment_method: paymentMethod || 'stripe',
          payment_id: paymentId,
          orderData: orderData || undefined,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.order) {
          updatedOrder = json.order;
        }
      } else {
        const json = await res.json().catch(() => null);
        return { success: false, error: json?.error || 'Failed to update payment status.' };
      }
    }

    if (!updatedOrder) {
      return { success: false, error: 'Failed to update payment status.' };
    }


    // Sync in local storage if present on this device
    if (typeof window !== 'undefined' && updatedOrder) {
      try {
        const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
        if (raw) {
          const orders: Order[] = JSON.parse(raw);
          const idx = orders.findIndex(o => o.order_number === orderNumber);
          if (idx !== -1) {
            orders[idx] = updatedOrder;
            localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
          }
        }
      } catch (e) {}

      // Sync in user_metadata if order belongs to current user
      try {
        const currentUser = await getCurrentUser();
        if (currentUser?.user_metadata?.saved_orders && Array.isArray(currentUser.user_metadata.saved_orders)) {
          const userOrders: Order[] = currentUser.user_metadata.saved_orders;
          const uIdx = userOrders.findIndex(o => o.order_number === orderNumber);
          if (uIdx !== -1) {
            userOrders[uIdx] = updatedOrder;
            await supabase.auth.updateUser({
              data: { saved_orders: userOrders }
            });
          }
        }
      } catch (e) {}

      window.dispatchEvent(new CustomEvent('tcg-orders-changed', { detail: { order: updatedOrder } }));
    }

    return { success: true, order: updatedOrder };
  } catch (err: any) {
    console.error('Failed to update payment status:', err);
    return { success: false, error: err?.message || 'Failed to update payment status.' };
  }
}

/**
 * Delete one or more orders by order_number from server, user_metadata, and localStorage.
 */
export async function deleteOrders(orderNumbers: string[]): Promise<{ success: boolean; error?: string }> {
  const clean = orderNumbers.map(s => s.trim()).filter(Boolean);
  if (clean.length === 0) return { success: true };
  const targetSet = new Set(clean);

  try {
    const user = await getCurrentUser();
    const { data: sessionData } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionData?.session?.access_token) {
      headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
    }

    const res = await fetch(`/api/orders?orderNumber=${encodeURIComponent(clean.join(','))}`, {
      method: 'DELETE',
      headers,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.success === false) {
      return { success: false, error: json?.error || 'Could not delete order.' };
    }

    if (typeof window !== 'undefined') {
      const keysToClean = [ORDERS_STORAGE_KEY];
      if (user?.id) keysToClean.push(`${ORDERS_STORAGE_KEY}_${user.id}`);
      for (const k of keysToClean) {
        try {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const next = parsed.filter((o: any) => !targetSet.has(o?.order_number) && !targetSet.has(o?.id));
              localStorage.setItem(k, JSON.stringify(next));
            }
          }
        } catch {}
      }
    }

    if (user?.user_metadata?.saved_orders && Array.isArray(user.user_metadata.saved_orders)) {
      try {
        const nextSaved = user.user_metadata.saved_orders.filter(
          (o: any) => !targetSet.has(o?.order_number) && !targetSet.has(o?.id)
        );
        await supabase.auth.updateUser({
          data: { saved_orders: nextSaved },
        });
      } catch {}
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tcg-orders-changed'));
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete order.' };
  }
}

export async function deleteOrder(orderNumber: string): Promise<{ success: boolean; error?: string }> {
  return deleteOrders([orderNumber]);
}

/**
 * Completely purge all test orders from Cloud DB, localStorage, and User Auth Metadata.
 */
export async function purgeAllOrders(scope: 'mine' | 'global' = 'mine'): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    // 1. Wipe local device storage
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ORDERS_STORAGE_KEY);
      if (user?.id) localStorage.removeItem(`${ORDERS_STORAGE_KEY}_${user.id}`);
    }

    // 2. Call DELETE /api/orders?all=true with auth header
    const { data: sessionData } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionData?.session?.access_token) {
      headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
    }

    await fetch(`/api/orders?all=true&scope=${scope}`, { method: 'DELETE', headers }).catch(() => null);

    // 3. Clear current user saved_orders in auth metadata
    if (user) {
      try {
        await supabase.auth.updateUser({
          data: {
            ...user.user_metadata,
            saved_orders: [],
          },
        });
      } catch (e) {}
    }

    // 4. Notify application
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tcg-orders-changed'));
    }

    return { success: true };
  } catch (err: any) {
    console.error('Failed to purge orders:', err);
    return { success: false, error: err?.message || 'Failed to purge orders.' };
  }
}


