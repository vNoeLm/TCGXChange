import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import { STORE_SHIPPING_METHODS, type StoreShippingMethod } from '../../../lib/storeCart';

export const prerender = false;

const SETTINGS_KEY = 'store_shipping_methods';

function parseStoredMethods(raw: unknown): StoreShippingMethod[] {
  if (!raw) return STORE_SHIPPING_METHODS;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return STORE_SHIPPING_METHODS;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return STORE_SHIPPING_METHODS;

  const valid: StoreShippingMethod[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = sanitizePlainText(String(obj.id || ''), 60);
    const label = sanitizePlainText(String(obj.label || ''), 120);
    if (!id || !label) continue;
    const description = sanitizePlainText(String(obj.description || ''), 240);
    const feeHuf = Math.max(0, Math.round(Number(obj.feeHuf) || 0));
    const rawFree = obj.freeAboveHuf;
    const freeAboveHuf =
      rawFree === null || rawFree === undefined || rawFree === ''
        ? null
        : Math.max(0, Math.round(Number(rawFree) || 0));
    const enabled = obj.enabled !== false;
    valid.push({ id, label, description, feeHuf, freeAboveHuf, enabled });
  }

  return valid.length > 0 ? valid : STORE_SHIPPING_METHODS;
}

export const GET: APIRoute = async () => {
  try {
    const { data } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();

    const methods = parseStoredMethods(data?.value);
    return jsonResponse({ ok: true, methods });
  } catch (err: any) {
    return jsonResponse({ ok: true, methods: STORE_SHIPPING_METHODS, warning: err?.message });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await getRequestUser(request);
    if (!auth?.isAdmin) {
      return jsonResponse({ error: 'Unauthorized: Admin access required' }, 403);
    }

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.methods)) {
      return jsonResponse({ error: 'Invalid payload: methods array required.' }, 400);
    }

    const cleaned = parseStoredMethods(body.methods);
    if (cleaned.filter((m) => m.enabled !== false).length === 0) {
      return jsonResponse({ error: 'At least one shipping method must remain enabled for the store.' }, 400);
    }

    const { error } = await supabaseAdmin
      .from('settings')
      .upsert(
        {
          key: SETTINGS_KEY,
          value: JSON.stringify(cleaned),
        },
        { onConflict: 'key' }
      );

    if (error) {
      return jsonResponse({ error: error.message || 'Could not save store shipping settings.' }, 500);
    }

    return jsonResponse({ ok: true, methods: cleaned });
  } catch (err: any) {
    return jsonResponse({ error: err?.message || 'Server error.' }, 500);
  }
};
