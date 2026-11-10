import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText, escapeHtml } from '../../../lib/sanitize';

export const prerender = false;

const SETTINGS_KEY = 'store_stock_alerts';
const subscribeRateMap = new Map<string, number>();

export interface StockAlertSubscription {
  id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  email: string;
  created_at: string;
  notified_at?: string | null;
}

async function readAlerts(): Promise<StockAlertSubscription[]> {
  try {
    const { data } = await supabaseAdmin.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

async function writeAlerts(alerts: StockAlertSubscription[]): Promise<void> {
  await supabaseAdmin.from('settings').upsert({ key: SETTINGS_KEY, value: JSON.stringify(alerts) });
}

export async function dispatchBackInStockNotifications(product: { id: string; name: string; slug: string; stock_quantity: number }): Promise<number> {
  if ((product.stock_quantity || 0) <= 0) return 0;
  const alerts = await readAlerts();
  const pending = alerts.filter((a) => a.product_id === product.id && !a.notified_at);
  if (pending.length === 0) return 0;

  const resendKey = process.env.RESEND_API_KEY || (import.meta as any).env?.RESEND_API_KEY;
  const siteUrl = process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://tcgxchange.eu';
  const nowIso = new Date().toISOString();
  const safeName = escapeHtml(product.name);
  const safeSubjectName = sanitizePlainText(product.name, 120);

  for (const sub of pending) {
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'TCG XChange Store <notifications@tcgxchange.eu>',
            to: [sub.email],
            subject: `Back in stock: ${safeSubjectName}`,
            html: `<p>Good news! <strong>${safeName}</strong> is back in stock at TCG XChange Store.</p><p><a href="${siteUrl}/store/product?slug=${encodeURIComponent(product.slug)}">View product in store</a></p>`,
          }),
        });
      } catch (e) {
        console.warn('Failed to send back-in-stock email:', e);
      }
    }
    sub.notified_at = nowIso;
  }

  await writeAlerts(alerts);
  return pending.length;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await getRequestUser(request);
  if (!auth?.isAdmin) return jsonResponse({ error: 'Unauthorized' }, 403);
  const alerts = await readAlerts();
  return jsonResponse({ alerts });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: 'Invalid body' }, 400);

    // Admin dispatch action
    if (body.action === 'dispatch' && body.product_id) {
      const auth = await getRequestUser(request);
      if (!auth?.isAdmin) return jsonResponse({ error: 'Unauthorized' }, 403);
      const { data: prod } = await supabaseAdmin
        .from('store_products')
        .select('id, name, slug, stock_quantity')
        .eq('id', String(body.product_id))
        .maybeSingle();
      if (!prod) return jsonResponse({ error: 'Product not found' }, 404);
      const count = await dispatchBackInStockNotifications(prod);
      return jsonResponse({ success: true, notified: count });
    }

    const ip =
      request.headers.get('cf-connecting-ip')?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const now = Date.now();
    const lastSub = subscribeRateMap.get(ip) || 0;
    if (now - lastSub < 3000) {
      return jsonResponse({ error: 'Please wait a moment before subscribing again.' }, 429);
    }
    subscribeRateMap.set(ip, now);
    if (subscribeRateMap.size > 2000) {
      for (const [k, v] of subscribeRateMap.entries()) {
        if (now - v > 60_000) subscribeRateMap.delete(k);
      }
    }

    // Shopper subscribe action
    const email = sanitizePlainText(body.email, 120).toLowerCase();
    const productId = sanitizePlainText(body.product_id, 80);
    const productName = sanitizePlainText(body.product_name, 200);
    const productSlug = sanitizePlainText(body.product_slug, 150);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'Please enter a valid email address.' }, 400);
    }
    if (!productId) {
      return jsonResponse({ error: 'Product ID is required.' }, 400);
    }

    const alerts = await readAlerts();
    const existing = alerts.find((a) => a.product_id === productId && a.email === email && !a.notified_at);
    if (existing) {
      return jsonResponse({ success: true, alreadySubscribed: true });
    }

    alerts.unshift({
      id: crypto.randomUUID(),
      product_id: productId,
      product_name: productName || 'Store Product',
      product_slug: productSlug || '',
      email,
      created_at: new Date().toISOString(),
      notified_at: null,
    });
    await writeAlerts(alerts.slice(0, 2000));
    return jsonResponse({ success: true }, 201);
  } catch (err: any) {
    return jsonResponse({ error: 'Internal error' }, 500);
  }
};
