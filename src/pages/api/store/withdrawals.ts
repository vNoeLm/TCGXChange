import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText, escapeSqlLike } from '../../../lib/sanitize';

export const prerender = false;

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'refunded'] as const;

const lookupRateMap = new Map<string, { count: number; resetAt: number }>();
const submitRateMap = new Map<string, number>();

function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function checkLookupRateLimit(ip: string): boolean {
  const now = Date.now();
  if (lookupRateMap.size > 2000) {
    for (const [k, v] of lookupRateMap.entries()) {
      if (v.resetAt < now) lookupRateMap.delete(k);
    }
  }
  const entry = lookupRateMap.get(ip);
  if (!entry || entry.resetAt < now) {
    lookupRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count += 1;
  return true;
}

/** Fallback to store withdrawals in settings JSON if migration hasn't been run yet */
async function fallbackSaveWithdrawal(entry: any) {
  try {
    const { data } = await supabaseAdmin.from('settings').select('value').eq('key', 'store_withdrawals').maybeSingle();
    const existing = Array.isArray(data?.value) ? data.value : [];
    const updated = [entry, ...existing].slice(0, 1000);
    await supabaseAdmin.from('settings').upsert({ key: 'store_withdrawals', value: updated });
    return true;
  } catch (e) {
    console.error('Fallback save withdrawal error:', e);
    return false;
  }
}

async function fallbackGetWithdrawals() {
  try {
    const { data } = await supabaseAdmin.from('settings').select('value').eq('key', 'store_withdrawals').maybeSingle();
    return Array.isArray(data?.value) ? data.value : [];
  } catch (e) {
    return [];
  }
}

async function fallbackUpdateWithdrawal(id: string, updates: any) {
  try {
    const { data } = await supabaseAdmin.from('settings').select('value').eq('key', 'store_withdrawals').maybeSingle();
    const existing = Array.isArray(data?.value) ? data.value : [];
    const updated = existing.map((w: any) => (w.id === id ? { ...w, ...updates, updated_at: new Date().toISOString() } : w));
    await supabaseAdmin.from('settings').upsert({ key: 'store_withdrawals', value: updated });
    return true;
  } catch (e) {
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const ip = getClientIp(request);
    const now = Date.now();
    const lastSub = submitRateMap.get(ip) || 0;
    if (now - lastSub < 5000) {
      return jsonResponse({ success: false, error: 'Please wait a few seconds before submitting again.' }, 429);
    }
    submitRateMap.set(ip, now);
    if (submitRateMap.size > 2000) {
      for (const [k, v] of submitRateMap.entries()) {
        if (now - v > 60_000) submitRateMap.delete(k);
      }
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ success: false, error: 'Invalid request body.' }, 400);
    }

    const order_number = sanitizePlainText(body.order_number, 60);
    const customer_name = sanitizePlainText(body.customer_name, 120);
    const customer_email = sanitizePlainText(body.customer_email, 120).trim().toLowerCase();
    const customer_phone = body.customer_phone ? sanitizePlainText(body.customer_phone, 40) : null;
    const order_date = sanitizePlainText(body.order_date, 60);
    const items_summary = sanitizePlainText(body.items_summary, 2000);
    const bank_account = sanitizePlainText(body.bank_account, 80);
    const reason = body.reason ? sanitizePlainText(body.reason, 1000) : null;

    if (!order_number || !customer_name || !customer_email || !order_date || !items_summary || !bank_account) {
      return jsonResponse({ success: false, error: 'Please fill in all mandatory fields.' }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
      return jsonResponse({ success: false, error: 'Please provide a valid email address.' }, 400);
    }

    const newRecord = {
      id: crypto.randomUUID(),
      order_number,
      customer_name,
      customer_email,
      customer_phone,
      order_date,
      items_summary,
      bank_account,
      reason,
      status: 'pending',
      admin_notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let insertedId = newRecord.id;

    // Try direct insert into store_withdrawals table
    const { data: dbData, error: dbErr } = await supabaseAdmin
      .from('store_withdrawals')
      .insert(newRecord)
      .select('id')
      .maybeSingle();

    if (dbErr) {
      console.warn('Direct store_withdrawals table insert failed, using fallback:', dbErr.message);
      await fallbackSaveWithdrawal(newRecord);
    } else if (dbData?.id) {
      insertedId = dbData.id;
    }

    return jsonResponse({
      success: true,
      id: insertedId,
      message: 'Withdrawal declaration recorded successfully.',
    }, 201);
  } catch (err: any) {
    console.error('Error handling withdrawal request:', err);
    return jsonResponse({ success: false, error: 'Server error.' }, 500);
  }
};

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const lookupOrder = url.searchParams.get('lookup_order') || url.searchParams.get('order_number');

  if (lookupOrder) {
    const ip = getClientIp(request);
    if (!checkLookupRateLimit(ip)) {
      return jsonResponse({ success: false, error: 'Too many lookup requests. Please wait a moment.' }, 429);
    }

    const cleanNum = sanitizePlainText(lookupOrder, 80).trim().replace(/^#/, '');
    if (!cleanNum || !/^[A-Za-z0-9_-]{6,60}$/.test(cleanNum)) {
      return jsonResponse({
        success: true,
        found: false,
        message: 'Order not found.',
      });
    }

    try {
      const target = cleanNum.toLowerCase();

      // 1. Primary: check settings.store_orders
      let foundOrder: any = null;
      try {
        const { data: settingsData } = await supabaseAdmin
          .from('settings')
          .select('value')
          .eq('key', 'store_orders')
          .maybeSingle();

        if (settingsData?.value) {
          const parsed = typeof settingsData.value === 'string' ? JSON.parse(settingsData.value) : settingsData.value;
          if (Array.isArray(parsed)) {
            foundOrder = parsed.find(
              (o: any) =>
                String(o.order_number || '').trim().replace(/^#/, '').toLowerCase() === target
            );
          }
        }
      } catch (err) {
        console.warn('Error reading store_orders for withdrawal lookup:', err);
      }

      // 2. Check public.orders table if not found yet (strictly escaped exact case-insensitive match, no fallback to dbOrders[0])
      if (!foundOrder) {
        try {
          const safePattern = escapeSqlLike(cleanNum, 60);
          const { data: dbOrders } = await supabaseAdmin
            .from('orders')
            .select('*')
            .ilike('order_number', safePattern)
            .limit(5);

          if (Array.isArray(dbOrders) && dbOrders.length > 0) {
            foundOrder = dbOrders.find(
              (o: any) =>
                String(o.order_number || '').trim().replace(/^#/, '').toLowerCase() === target
            ) || null;
          }
        } catch (err) {
          console.warn('Error querying orders table for withdrawal lookup:', err);
        }
      }

      if (!foundOrder) {
        return jsonResponse({
          success: true,
          found: false,
          message: 'Order not found.',
        });
      }

      // Only reveal customer PII if the caller is authenticated as the order's buyer or an admin
      const caller = await getRequestUser(request);
      const cust = foundOrder.customer_info || {};
      const rawCustomerName = cust.billing_name || cust.name || foundOrder.shipping_name || '';
      const rawCustomerEmail = cust.email || '';
      const rawCustomerPhone = cust.phone || '';
      const isAuthorizedOwner = Boolean(
        caller &&
        (caller.isAdmin ||
          (foundOrder.user_id && caller.user.id === foundOrder.user_id) ||
          (rawCustomerEmail && caller.user.email && caller.user.email.toLowerCase() === String(rawCustomerEmail).toLowerCase()))
      );

      const orderDate = foundOrder.created_at ? String(foundOrder.created_at).slice(0, 10) : '';

      let rawItems = foundOrder.items;
      if (typeof rawItems === 'string') {
        try {
          rawItems = JSON.parse(rawItems);
        } catch {}
      }

      const items = Array.isArray(rawItems)
        ? rawItems.map((it: any, idx: number) => ({
            id: it.inventory_id || it.card_id || `item-${idx}`,
            inventory_id: it.inventory_id || null,
            name: it.card_name || it.name || 'Termék',
            quantity: typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1,
            price_huf: Number(it.price_huf || 0),
            image_path: it.image_path || null,
            condition: it.condition || null,
            set_name: it.set_name || null,
          }))
        : [];

      return jsonResponse({
        success: true,
        found: true,
        order: {
          order_number: foundOrder.order_number,
          customer_name: isAuthorizedOwner ? rawCustomerName : '',
          customer_email: isAuthorizedOwner ? rawCustomerEmail : '',
          customer_phone: isAuthorizedOwner ? rawCustomerPhone : '',
          order_date: orderDate,
          total_price_huf: foundOrder.total_price_huf ?? foundOrder.total_huf ?? 0,
          items,
        },
      });
    } catch (err: any) {
      console.error('Error during order lookup for withdrawal:', err);
      return jsonResponse({ success: false, error: 'Lookup failed.' }, 500);
    }
  }

  const caller = await getRequestUser(request);
  if (!caller?.isAdmin) {
    return jsonResponse({ success: false, error: 'Unauthorized.' }, 403);
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('store_withdrawals')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('store_withdrawals query failed, using fallback:', error.message);
      const fallbackList = await fallbackGetWithdrawals();
      return jsonResponse({ success: true, withdrawals: fallbackList });
    }

    return jsonResponse({ success: true, withdrawals: data || [] });
  } catch (err: any) {
    console.error('Error fetching withdrawals:', err);
    const fallbackList = await fallbackGetWithdrawals();
    return jsonResponse({ success: true, withdrawals: fallbackList });
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller?.isAdmin) {
    return jsonResponse({ success: false, error: 'Unauthorized.' }, 403);
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return jsonResponse({ success: false, error: 'Missing withdrawal ID.' }, 400);
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.status) {
      if (!VALID_STATUSES.includes(body.status)) {
        return jsonResponse({ success: false, error: 'Invalid status.' }, 400);
      }
      updates.status = body.status;
    }

    if (body.admin_notes !== undefined) {
      updates.admin_notes = sanitizePlainText(body.admin_notes, 2000) || null;
    }

    const { error } = await supabaseAdmin
      .from('store_withdrawals')
      .update(updates)
      .eq('id', body.id);

    if (error) {
      console.warn('store_withdrawals update failed, using fallback:', error.message);
      await fallbackUpdateWithdrawal(body.id, updates);
    }

    return jsonResponse({ success: true });
  } catch (err: any) {
    console.error('Error updating withdrawal:', err);
    return jsonResponse({ success: false, error: 'Server error.' }, 500);
  }
};
