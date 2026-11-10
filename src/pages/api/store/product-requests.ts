import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';

export const prerender = false;

const SETTINGS_KEY = 'store_product_requests';
const requestRateMap = new Map<string, number>();

export interface ProductRequestEntry {
  id: string;
  product_name: string;
  game_or_brand: string;
  email: string;
  notes: string;
  status: 'open' | 'reviewed' | 'fulfilled';
  created_at: string;
}

async function readRequests(): Promise<ProductRequestEntry[]> {
  try {
    const { data } = await supabaseAdmin.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

async function writeRequests(entries: ProductRequestEntry[]): Promise<void> {
  await supabaseAdmin.from('settings').upsert({ key: SETTINGS_KEY, value: JSON.stringify(entries) });
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await getRequestUser(request);
  if (!auth?.isAdmin) return jsonResponse({ error: 'Unauthorized' }, 403);
  const requests = await readRequests();
  return jsonResponse({ requests });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const ip =
      request.headers.get('cf-connecting-ip')?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const now = Date.now();
    const lastReq = requestRateMap.get(ip) || 0;
    if (now - lastReq < 5000) {
      return jsonResponse({ error: 'Please wait a few seconds before submitting another product request.' }, 429);
    }
    requestRateMap.set(ip, now);
    if (requestRateMap.size > 2000) {
      for (const [k, v] of requestRateMap.entries()) {
        if (now - v > 60_000) requestRateMap.delete(k);
      }
    }

    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: 'Invalid body' }, 400);

    const productName = sanitizePlainText(body.product_name, 200);
    const gameOrBrand = sanitizePlainText(body.game_or_brand, 120);
    const email = sanitizePlainText(body.email, 120);
    const notes = sanitizePlainText(body.notes, 800);

    if (!productName) {
      return jsonResponse({ error: 'Please specify the product name you are looking for.' }, 400);
    }

    const entries = await readRequests();
    const item: ProductRequestEntry = {
      id: crypto.randomUUID(),
      product_name: productName,
      game_or_brand: gameOrBrand,
      email,
      notes,
      status: 'open',
      created_at: new Date().toISOString(),
    };
    entries.unshift(item);
    await writeRequests(entries.slice(0, 1000));
    return jsonResponse({ success: true, request: item }, 201);
  } catch (err: any) {
    return jsonResponse({ error: 'Internal error' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const auth = await getRequestUser(request);
  if (!auth?.isAdmin) return jsonResponse({ error: 'Unauthorized' }, 403);
  const body = await request.json().catch(() => null);
  if (!body?.id || !body?.status) return jsonResponse({ error: 'Missing id or status' }, 400);

  const entries = await readRequests();
  const next = entries.map((e) => (e.id === body.id ? { ...e, status: body.status } : e));
  await writeRequests(next);
  return jsonResponse({ success: true });
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await getRequestUser(request);
  if (!auth?.isAdmin) return jsonResponse({ error: 'Unauthorized' }, 403);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonResponse({ error: 'Missing id' }, 400);

  const entries = await readRequests();
  await writeRequests(entries.filter((e) => e.id !== id));
  return jsonResponse({ success: true });
};
